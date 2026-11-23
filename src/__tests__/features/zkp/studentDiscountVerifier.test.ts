/**
 * Unit tests for studentDiscountVerifier (#9615).
 */

import {
  generateStudentDiscountProof,
  generateStudentProofFallback,
  generateStudentProofWithWorker,
  verifyStudentDiscountProof,
  StudentDiscountVerifier,
  isWebWorkerSupported,
  STUDENT_DISCOUNT_SCOPE,
} from "@/features/zkp/studentDiscountVerifier";
import * as proofCache from "@/lib/zkp/proofCache";
import * as snarkjs from "snarkjs";

jest.mock("snarkjs", () => ({
  groth16: {
    fullProve: jest.fn(),
    verify: jest.fn(),
  },
}));

jest.mock("@/lib/zkp/proofCache", () => {
  const original = jest.requireActual("@/lib/zkp/proofCache");
  return {
    ...original,
    getCachedProof: jest.fn(),
    storeProof: jest.fn(),
    invalidateProof: jest.fn(),
  };
});

// Mock Web Worker implementation for testing
class MockWorker {
  static instances: MockWorker[] = [];
  public listeners: Record<string, ((event: any) => void)[]> = {};
  public terminated = false;
  public postedMessages: any[] = [];

  constructor() {
    MockWorker.instances.push(this);
  }

  addEventListener(type: string, listener: (event: any) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: (event: any) => void) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
  }

  postMessage(message: any) {
    this.postedMessages.push(message);

    if (message.type === "GENERATE_PROOF") {
      setTimeout(() => {
        // Emit progress
        this.emit("message", {
          data: {
            type: "PROOF_PROGRESS",
            percent: 25,
            stage: "witness",
            details: "Computing witness",
          },
        });
        this.emit("message", {
          data: {
            type: "PROOF_PROGRESS",
            percent: 75,
            stage: "polynomial_multiplication",
            details: "Multiplying polynomials",
          },
        });
        // Emit success
        this.emit("message", {
          data: {
            type: "PROOF_SUCCESS",
            proof: {
              pi_a: ["1", "2"],
              pi_b: [["3", "4"]],
              pi_c: ["5", "6"],
              protocol: "groth16",
              curve: "bn128",
            },
            publicSignals: ["1849102948", "2026"],
            durationMs: 120,
          },
        });
      }, 10);
    }
  }

  terminate() {
    this.terminated = true;
  }

  emit(type: string, event: any) {
    const list = this.listeners[type] || [];
    for (const l of list) l(event);
  }
}

describe("Student Discount Verifier (#9615)", () => {
  const mockFullProve = snarkjs.groth16.fullProve as jest.Mock;
  const mockVerify = snarkjs.groth16.verify as jest.Mock;
  const mockGetCachedProof = proofCache.getCachedProof as jest.Mock;
  const mockStoreProof = proofCache.storeProof as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    MockWorker.instances = [];
    mockGetCachedProof.mockResolvedValue(null);
    mockStoreProof.mockResolvedValue(undefined);
  });

  describe("Worker Detection and Support", () => {
    it("reports worker availability correctly", () => {
      // In jsdom environment, Worker may not be defined by default
      expect(typeof isWebWorkerSupported()).toBe("boolean");
    });
  });

  describe("Web Worker Execution Flow", () => {
    it("executes proof generation using Web Worker and tracks progress", async () => {
      const progressEvents: any[] = [];

      const result = await generateStudentProofWithWorker(
        {
          secret: "123456",
          epoch: 2026,
          root: "1849102948",
        },
        {
          createWorker: () => new MockWorker() as any,
          onProgress: (p) => progressEvents.push(p),
        },
      );

      expect(result.proofSource).toBe("worker");
      expect(result.publicSignals).toEqual(["1849102948", "2026"]);
      expect(progressEvents.length).toBeGreaterThanOrEqual(2);
      expect(progressEvents[0].stage).toBe("witness");
      expect(progressEvents[1].stage).toBe("polynomial_multiplication");
    });

    it("handles worker error messages by rejecting with error details", async () => {
      class ErrorWorker extends MockWorker {
        postMessage(message: any) {
          if (message.type === "GENERATE_PROOF") {
            setTimeout(() => {
              this.emit("message", {
                data: {
                  type: "PROOF_ERROR",
                  error: "Proof generation timed out in worker",
                  code: "PROVING_TIMEOUT",
                  isTimeout: true,
                },
              });
            }, 5);
          }
        }
      }

      await expect(
        generateStudentProofWithWorker(
          { secret: "123" },
          { createWorker: () => new ErrorWorker() as any },
        ),
      ).rejects.toThrow("Proof generation timed out in worker");
    });

    it("supports aborting worker proof generation via AbortSignal", async () => {
      const controller = new AbortController();

      class StallingWorker extends MockWorker {
        postMessage(message: any) {
          this.postedMessages.push(message);
          // Do not reply automatically
        }
      }

      const workerInstance = new StallingWorker();

      const promise = generateStudentProofWithWorker(
        { secret: "123" },
        {
          createWorker: () => workerInstance as any,
          signal: controller.signal,
        },
      );

      // Trigger abort
      setTimeout(() => controller.abort(), 10);

      await expect(promise).rejects.toThrow("Proof generation aborted");
      expect(
        workerInstance.postedMessages.some((m) => m.type === "CANCEL"),
      ).toBe(true);
    });
  });

  describe("Fallback Execution for Environments without Workers", () => {
    it("falls back to in-process proof generation when workers are disabled", async () => {
      const progressEvents: any[] = [];

      mockFullProve.mockImplementation(async (inputs, wasm, zkey, logger) => {
        logger.debug("Reading Wtns");
        logger.debug("Building ABC");
        logger.info("OK!");
        return {
          proof: { protocol: "groth16", curve: "bn128" },
          publicSignals: ["1849102948", "2026"],
        };
      });

      const result = await generateStudentProofFallback(
        {
          secret: "98765",
          epoch: 2026,
          root: "1849102948",
        },
        {
          onProgress: (p) => progressEvents.push(p),
        },
      );

      expect(result.proofSource).toBe("fallback");
      expect(result.publicSignals).toEqual(["1849102948", "2026"]);
      expect(mockFullProve).toHaveBeenCalled();

      // Check progress events during fallback
      expect(progressEvents.some((p) => p.stage === "witness")).toBe(true);
      expect(
        progressEvents.some((p) => p.stage === "polynomial_multiplication"),
      ).toBe(true);
      expect(progressEvents.some((p) => p.stage === "complete")).toBe(true);
    });

    it("automatically uses fallback when forceFallback is enabled", async () => {
      mockFullProve.mockResolvedValue({
        proof: { protocol: "groth16" },
        publicSignals: ["root-123", "2026"],
      });

      const result = await generateStudentDiscountProof(
        { secret: "111", root: "root-123" },
        { forceFallback: true },
      );

      expect(result.proofSource).toBe("fallback");
      expect(mockFullProve).toHaveBeenCalled();
    });
  });

  describe("Proof Cache Integration", () => {
    it("returns cached proof immediately without invoking worker or fallback", async () => {
      const cachedProof = {
        proof: { protocol: "groth16" },
        publicSignals: ["root-cached-1", "2026"],
      };

      mockGetCachedProof.mockResolvedValue(cachedProof);

      const progressEvents: any[] = [];

      const result = await generateStudentDiscountProof(
        {
          secret: "123",
          root: "root-cached-1",
        },
        {
          onProgress: (p) => progressEvents.push(p),
        },
      );

      expect(result.proofSource).toBe("cache");
      expect(result.publicSignals).toEqual(["root-cached-1", "2026"]);
      expect(mockFullProve).not.toHaveBeenCalled();
      expect(progressEvents.some((p) => p.stage === "cache")).toBe(true);
    });

    it("stores freshly generated proof into the proofCache", async () => {
      mockFullProve.mockResolvedValue({
        proof: { protocol: "groth16" },
        publicSignals: ["new-root", "2026"],
      });

      await generateStudentDiscountProof(
        { secret: "456", root: "new-root" },
        { forceFallback: true },
      );

      expect(mockStoreProof).toHaveBeenCalledWith(
        STUDENT_DISCOUNT_SCOPE,
        "new-root",
        expect.objectContaining({
          publicSignals: ["new-root", "2026"],
        }),
      );
    });
  });

  describe("Proof Verification", () => {
    it("verifies valid student discount proof successfully", async () => {
      mockVerify.mockResolvedValue(true);

      const mockVKey = { protocol: "groth16", nPublic: 2 };
      const proof = { protocol: "groth16" };
      const signals = ["1849102948", "2026"];

      const verifyResult = await verifyStudentDiscountProof(
        proof,
        signals,
        mockVKey,
      );

      expect(verifyResult.isValid).toBe(true);
      expect(verifyResult.discountEligible).toBe(true);
      expect(mockVerify).toHaveBeenCalledWith(mockVKey, signals, proof);
    });

    it("rejects proof when public signals are missing or verification fails", async () => {
      mockVerify.mockResolvedValue(false);

      const verifyResult = await verifyStudentDiscountProof(
        { protocol: "groth16" },
        [],
      );

      expect(verifyResult.isValid).toBe(false);
      expect(verifyResult.discountEligible).toBe(false);
    });
  });

  describe("StudentDiscountVerifier Orchestrator Class", () => {
    it("manages worker lifecycle and clean termination", async () => {
      const verifier = new StudentDiscountVerifier({
        createWorker: () => new MockWorker() as any,
      });

      const result = await verifier.generateProof({
        secret: "789",
        root: "1849102948",
      });

      expect(result.proofSource).toBe("worker");

      // Clean termination
      await verifier.terminate();
    });

    it("invalidates cache through verifier instance", async () => {
      const verifier = new StudentDiscountVerifier();
      await verifier.invalidateCache("root-to-drop");

      expect(proofCache.invalidateProof).toHaveBeenCalledWith(
        STUDENT_DISCOUNT_SCOPE,
        "root-to-drop",
      );
    });
  });
});
