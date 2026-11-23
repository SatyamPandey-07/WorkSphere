/**
 * @jest-environment node
 *
 * Comprehensive Test Suite for Student Discount ZKP CSP Worker Fallback (#9637)
 */

import {
  generateStudentProofWithFallback,
  generateStudentProofMainThread,
  probeWorkerCapability,
  isCspOrSecurityError,
  resetCspWarningState,
  verifyStudentDiscountProof,
  type StudentProofInputs,
  type MainThreadProver,
} from "../../../features/zkp/studentDiscountVerifier";

// Mock helper compatible with both Vitest and Jest
const testFn = (impl?: (...args: any[]) => any) => {
  if (typeof (globalThis as any).vi !== "undefined") {
    return (globalThis as any).vi.fn(impl);
  }
  if (typeof jest !== "undefined") {
    return jest.fn(impl);
  }
  const f: any = (...args: any[]) => {
    f.mock.calls.push(args);
    return impl ? impl(...args) : undefined;
  };
  f.mock = { calls: [] };
  return f;
};

describe("Student Discount ZKP CSP Worker Fallback (#9637)", () => {
  const originalWorker = (globalThis as any).Worker;
  const originalConsoleWarn = console.warn;

  beforeEach(() => {
    resetCspWarningState();
    console.warn = testFn();
  });

  afterEach(() => {
    (globalThis as any).Worker = originalWorker;
    console.warn = originalConsoleWarn;
  });

  describe("CSP Detection & Capability Probing", () => {
    it("identifies SecurityError and CSP violations accurately", () => {
      const securityErr = new Error("The operation is insecure.");
      securityErr.name = "SecurityError";
      expect(isCspOrSecurityError(securityErr)).toBe(true);

      const cspDirectiveErr = new Error(
        "Refused to create a worker from 'blob:...' because it violates the following Content Security Policy directive: worker-src 'self'",
      );
      expect(isCspOrSecurityError(cspDirectiveErr)).toBe(true);

      const standardErr = new Error("File not found");
      expect(isCspOrSecurityError(standardErr)).toBe(false);
      expect(isCspOrSecurityError(null)).toBe(false);
    });

    it("probes worker capability successfully when Worker is allowed", () => {
      const mockTerminate = testFn();
      const mockWorkerFactory = testFn().mockImplementation(() => ({
        terminate: mockTerminate,
      }));

      const capability = probeWorkerCapability(mockWorkerFactory as any);
      expect(capability.allowed).toBe(true);
      expect(mockTerminate).toHaveBeenCalled();
    });

    it("probes worker capability and flags CSP_SECURITY_RESTRICTION when Worker throws SecurityError", () => {
      const mockWorkerFactory = testFn().mockImplementation(() => {
        const err = new Error("Refused to create worker due to CSP");
        err.name = "SecurityError";
        throw err;
      });

      const capability = probeWorkerCapability(mockWorkerFactory as any);
      expect(capability.allowed).toBe(false);
      expect(capability.reason).toBe("CSP_SECURITY_RESTRICTION");
    });
  });

  describe("Proof Generation with Worker and Fallback", () => {
    const mockInputs: StudentProofInputs = {
      secret: "1234567890",
      epoch: 2026,
      root: "1849102948102938401928401928401928401928401928401928401928401928",
      pathElements: Array(16).fill("0"),
      pathIndices: Array(16).fill(0),
    };

    const mockProof = {
      pi_a: ["111", "222", "1"],
      pi_b: [
        ["333", "444"],
        ["555", "666"],
        ["1", "0"],
      ],
      pi_c: ["777", "888", "1"],
    };
    const mockSignals = ["mock_root", "2026", "mock_nullifier"];

    const mockCustomProver: MainThreadProver = {
      wtnsCalculate: testFn().mockResolvedValue(undefined),
      groth16Prove: testFn().mockResolvedValue({
        proof: mockProof,
        publicSignals: mockSignals,
      }),
    };

    it("uses Worker when Worker is available and allowed", async () => {
      class MockWorker {
        onmessage: ((e: any) => void) | null = null;
        onerror: ((e: any) => void) | null = null;
        postMessage = testFn(() => {
          setTimeout(() => {
            this.onmessage?.({
              data: {
                type: "SUCCESS",
                proof: mockProof,
                publicSignals: mockSignals,
                simdAccelerated: true,
              },
            });
          }, 5);
        });
        terminate = testFn();
      }

      const res = await generateStudentProofWithFallback(mockInputs, {
        workerFactory: () => new MockWorker() as any,
      });

      expect(res.source).toBe("worker");
      expect(res.proof).toEqual(mockProof);
      expect(res.publicSignals).toEqual(mockSignals);
      expect(res.simdAccelerated).toBe(true);
      expect(console.warn).not.toHaveBeenCalled();
    });

    it("falls back to main-thread when Worker throws SecurityError (CSP blocked)", async () => {
      const failingWorkerFactory = () => {
        const err = new Error("Violates worker-src CSP directive");
        err.name = "SecurityError";
        throw err;
      };

      const res = await generateStudentProofWithFallback(mockInputs, {
        workerFactory: failingWorkerFactory as any,
        mainThreadProver: mockCustomProver,
      });

      expect(res.source).toBe("main-thread-fallback");
      expect(res.proof).toEqual(mockProof);
      expect(res.publicSignals).toEqual(mockSignals);
      expect(mockCustomProver.wtnsCalculate).toHaveBeenCalled();
      expect(mockCustomProver.groth16Prove).toHaveBeenCalled();

      // Verify diagnostic warning was emitted with sanitized reason
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("[ZKP CSP Fallback] Web Worker initialization blocked"),
        expect.objectContaining({
          category: "CSP_RESTRICTION",
          reason: "CSP_SECURITY_RESTRICTION",
        }),
      );
    });

    it("falls back to main-thread when Worker constructor is unavailable", async () => {
      delete (globalThis as any).Worker;

      const res = await generateStudentProofWithFallback(mockInputs, {
        mainThreadProver: mockCustomProver,
      });
      expect(res.source).toBe("main-thread-fallback");
      expect(res.proof).toEqual(mockProof);
    });

    it("handles progress callbacks during main-thread proof synthesis", async () => {
      const progressSteps: string[] = [];
      const onProgress = testFn((step: string) => {
        progressSteps.push(step);
      });

      await generateStudentProofMainThread(mockInputs, onProgress, mockCustomProver);

      expect(progressSteps).toContain("INITIALIZING");
      expect(progressSteps).toContain("LOADING_ARTIFACTS");
      expect(progressSteps).toContain("WITNESS_GENERATION");
      expect(progressSteps).toContain("PROOF_SYNTHESIS");
      expect(progressSteps).toContain("FINALIZING");
    });

    it("throws when required inputs are missing", async () => {
      await expect(
        generateStudentProofMainThread({} as any, undefined, mockCustomProver),
      ).rejects.toThrow("Missing or malformed proof generation inputs.");
    });
  });

  describe("Integration with Proof Verification and Caching", () => {
    it("successfully verifies proof generated via CSP fallback", async () => {
      const mockVerifier = testFn().mockResolvedValue(true);
      const proof = { pi_a: ["1"], pi_b: [["2"]], pi_c: ["3"] };
      const publicSignals = ["root_123", "2026"];

      const res = await verifyStudentDiscountProof(
        {
          proof,
          publicSignals,
          merkleRoot: "root_123",
          circuitId: "student_membership",
        },
        mockVerifier,
      );

      expect(res.isValid).toBe(true);
      expect(mockVerifier).toHaveBeenCalledTimes(1);
    });
  });
});
