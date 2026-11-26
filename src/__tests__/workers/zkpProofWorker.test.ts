/**
 * Unit tests for zkpProofWorker (SnarkJS Web Worker) (#9615).
 */

import {
  handleZkpProofWorkerMessage,
  classifyWorkerError,
  serializeBigIntSignals,
  normalizeCircuitInputs,
  terminateCurveBn128,
  type ZkpProofWorkerRequest,
  type ZkpProofWorkerResponse,
} from "@/workers/zkpProofWorker";
import * as snarkjs from "snarkjs";

jest.mock("snarkjs", () => ({
  groth16: {
    fullProve: jest.fn(),
    verify: jest.fn(),
  },
}));

describe("zkpProofWorker Message Protocol and Execution (#9615)", () => {
  const mockFullProve = snarkjs.groth16.fullProve as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await terminateCurveBn128();
  });

  describe("Error Classification and Serialization", () => {
    it("correctly classifies timeout errors", () => {
      expect(classifyWorkerError(new Error("Proof generation timed out"))).toBe(
        "PROVING_TIMEOUT",
      );
      expect(classifyWorkerError("Execution timeout occurred")).toBe(
        "PROVING_TIMEOUT",
      );
    });

    it("correctly classifies out of memory (OOM) errors", () => {
      expect(classifyWorkerError(new Error("Out of memory"))).toBe("OOM");
      expect(classifyWorkerError(new RangeError("allocation failed"))).toBe(
        "OOM",
      );
      expect(
        classifyWorkerError("Memory access out of bounds in WebAssembly"),
      ).toBe("OOM");
    });

    it("correctly classifies aborted/cancelled errors", () => {
      expect(classifyWorkerError(new Error("Operation was aborted"))).toBe(
        "ABORTED",
      );
      expect(classifyWorkerError("Task cancelled")).toBe("ABORTED");
    });

    it("correctly classifies invalid input errors", () => {
      expect(classifyWorkerError(new Error("Invalid student inputs"))).toBe(
        "INVALID_INPUT",
      );
      expect(classifyWorkerError("Missing input arguments")).toBe(
        "INVALID_INPUT",
      );
    });

    it("serializes nested BigInts to strings", () => {
      const input = {
        secret: 12345678901234567890n,
        elements: [1n, 2n, "3"],
        nested: { val: 42n },
      };
      const serialized = serializeBigIntSignals(input) as any;
      expect(serialized.secret).toBe("12345678901234567890");
      expect(serialized.elements).toEqual(["1", "2", "3"]);
      expect(serialized.nested.val).toBe("42");
    });

    it("normalizes both flat and nested circuit inputs", () => {
      const flatRequest: ZkpProofWorkerRequest = {
        type: "GENERATE_PROOF",
        secret: 123n,
        epoch: 2026,
        root: "999",
        pathElements: [456n],
        pathIndices: [0],
      };
      const normalizedFlat = normalizeCircuitInputs(flatRequest);
      expect(normalizedFlat.secret).toBe("123");
      expect(normalizedFlat.epoch).toBe("2026");
      expect(normalizedFlat.root).toBe("999");
      expect(normalizedFlat.pathElements).toEqual(["456"]);
      expect(normalizedFlat.pathIndices).toEqual(["0"]);

      const nestedRequest: ZkpProofWorkerRequest = {
        type: "GENERATE_PROOF",
        payload: {
          inputs: {
            secret: 789n,
            epoch: "2026",
          },
        },
      };
      const normalizedNested = normalizeCircuitInputs(nestedRequest);
      expect(normalizedNested.secret).toBe("789");
      expect(normalizedNested.epoch).toBe("2026");
    });
  });

  describe("Proof Generation Flow & Progress Reporting", () => {
    it("emits progress percentages during witness computation and polynomial multiplication", async () => {
      const messages: ZkpProofWorkerResponse[] = [];
      const post = (msg: ZkpProofWorkerResponse) => messages.push(msg);

      mockFullProve.mockImplementation(async (inputs, wasm, zkey, logger) => {
        // Simulate SnarkJS logger callbacks
        logger.debug("Reading Wtns");
        logger.debug("Building ABC");
        logger.debug("Reading A Points");
        logger.debug("JoinABC");
        logger.info("OK!");

        return {
          proof: {
            pi_a: ["1", "2", "1"],
            pi_b: [
              ["1", "2"],
              ["3", "4"],
              ["1", "0"],
            ],
            pi_c: ["5", "6", "1"],
            protocol: "groth16",
            curve: "bn128",
          },
          publicSignals: ["9999", "2026"],
        };
      });

      const request: ZkpProofWorkerRequest = {
        type: "GENERATE_PROOF",
        secret: "12345",
        epoch: "2026",
        root: "9999",
        pathElements: ["111", "222"],
        pathIndices: [0, 1],
      };

      await handleZkpProofWorkerMessage(request, post);

      // Verify progress messages were emitted
      const progressMessages = messages.filter(
        (m) => m.type === "PROOF_PROGRESS",
      );
      expect(progressMessages.length).toBeGreaterThanOrEqual(4);

      // Verify witness stage progress
      const witnessProgress = progressMessages.filter(
        (m) => (m as any).stage === "witness",
      );
      expect(witnessProgress.length).toBeGreaterThan(0);
      expect(witnessProgress[0].percent).toBeLessThanOrEqual(50);

      // Verify polynomial multiplication stage progress
      const polyProgress = progressMessages.filter(
        (m) => (m as any).stage === "polynomial_multiplication",
      );
      expect(polyProgress.length).toBeGreaterThan(0);
      expect(polyProgress[0].percent).toBeGreaterThanOrEqual(45);

      // Verify final success message
      const successMessage = messages.find(
        (m) => m.type === "PROOF_SUCCESS",
      ) as any;
      expect(successMessage).toBeDefined();
      expect(successMessage.publicSignals).toEqual(["9999", "2026"]);
      expect(successMessage.proof.protocol).toBe("groth16");
      expect(typeof successMessage.durationMs).toBe("number");
    });

    it("emits PROOF_ERROR when inputs are missing", async () => {
      const messages: ZkpProofWorkerResponse[] = [];
      const post = (msg: ZkpProofWorkerResponse) => messages.push(msg);

      const emptyRequest: ZkpProofWorkerRequest = {
        type: "GENERATE_PROOF",
        payload: { inputs: {} },
      };

      await handleZkpProofWorkerMessage(emptyRequest, post);

      const errorMsg = messages.find((m) => m.type === "PROOF_ERROR") as any;
      expect(errorMsg).toBeDefined();
      expect(errorMsg.code).toBe("INVALID_INPUT");
    });

    it("emits PROOF_ERROR on SnarkJS failure or OOM", async () => {
      const messages: ZkpProofWorkerResponse[] = [];
      const post = (msg: ZkpProofWorkerResponse) => messages.push(msg);

      mockFullProve.mockRejectedValue(
        new RangeError("Out of memory in WebAssembly allocation"),
      );

      const request: ZkpProofWorkerRequest = {
        type: "GENERATE_PROOF",
        secret: "12345",
        epoch: "2026",
      };

      await handleZkpProofWorkerMessage(request, post);

      const errorMsg = messages.find((m) => m.type === "PROOF_ERROR") as any;
      expect(errorMsg).toBeDefined();
      expect(errorMsg.code).toBe("OOM");
      expect(errorMsg.isOom).toBe(true);
    });

    it("emits PROOF_ERROR when proving times out", async () => {
      const messages: ZkpProofWorkerResponse[] = [];
      const post = (msg: ZkpProofWorkerResponse) => messages.push(msg);

      // Mock fullProve to stall longer than the timeout
      mockFullProve.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 500)),
      );

      const request: ZkpProofWorkerRequest = {
        type: "GENERATE_PROOF",
        secret: "12345",
        epoch: "2026",
        timeoutMs: 50, // 50ms short timeout
      };

      await handleZkpProofWorkerMessage(request, post);

      const errorMsg = messages.find((m) => m.type === "PROOF_ERROR") as any;
      expect(errorMsg).toBeDefined();
      expect(errorMsg.code).toBe("PROVING_TIMEOUT");
      expect(errorMsg.isTimeout).toBe(true);
    });
  });

  describe("Clean Termination & Deallocation", () => {
    it("handles CANCEL and TERMINATE messages without emitting errors", async () => {
      const messages: ZkpProofWorkerResponse[] = [];
      const post = (msg: ZkpProofWorkerResponse) => messages.push(msg);

      const cancelRequest: ZkpProofWorkerRequest = { type: "CANCEL" };
      await handleZkpProofWorkerMessage(cancelRequest, post);
      expect(messages).toHaveLength(0);

      const terminateRequest: ZkpProofWorkerRequest = { type: "TERMINATE" };
      await handleZkpProofWorkerMessage(terminateRequest, post);
      expect(messages).toHaveLength(0);
    });

    it("cleans up global curve_bn128 instance during terminateCurveBn128", async () => {
      const mockTerminate = jest.fn().mockResolvedValue(undefined);
      (globalThis as any).curve_bn128 = { terminate: mockTerminate };

      await terminateCurveBn128();

      expect(mockTerminate).toHaveBeenCalled();
      expect((globalThis as any).curve_bn128).toBeUndefined();
    });
  });
});
