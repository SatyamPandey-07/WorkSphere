import * as snarkjs from "snarkjs";
import {
  handleZkpWorkerMessage,
  DEFAULT_VERIFICATION_TIMEOUT_MS,
  DEFAULT_PROVING_TIMEOUT_MS,
  classifyError,
  releaseWitnessBuffer,
  terminateCurveBn128,
  resolveArtifactUrls,
  WorkerRequest,
  WorkerResponse,
} from "@/workers/zkpWorker";

jest.mock("snarkjs", () => ({
  wtns: {
    calculate: jest.fn(),
  },
  groth16: {
    prove: jest.fn(),
    verify: jest.fn(),
    fullProve: jest.fn(),
  },
}));

jest.mock("@/lib/zkp/wasmSimd", () => ({
  getOptimizedZkpOptions: jest.fn().mockResolvedValue({
    simdEnabled: true,
    witnessOptions: { memorySize: 0 },
    proverOptions: { singleThread: true },
  }),
}));

describe("ZKP Web Worker Unit Tests (#9356)", () => {
  let postedMessages: WorkerResponse[];
  let postMock: (msg: Record<string, unknown>) => void;

  beforeEach(() => {
    jest.clearAllMocks();
    postedMessages = [];
    postMock = (msg: Record<string, unknown>) => {
      postedMessages.push(msg as unknown as WorkerResponse);
    };
  });

  afterEach(async () => {
    await terminateCurveBn128();
  });

  describe("Message Protocol & Valid Proof Generation", () => {
    it("handles valid GENERATE_PROOF request with structured monotonic progress and success response", async () => {
      (snarkjs.wtns.calculate as jest.Mock).mockResolvedValue(undefined);
      (snarkjs.groth16.prove as jest.Mock).mockResolvedValue({
        proof: {
          pi_a: ["101", "102", "1"],
          pi_b: [
            ["201", "202"],
            ["203", "204"],
            ["1", "0"],
          ],
          pi_c: ["301", "302", "1"],
        },
        publicSignals: ["mock_root", "2026", "mock_nullifier"],
      });

      const request: WorkerRequest = {
        type: "GENERATE_PROOF",
        studentHash: "student_hash_abc",
        epochSalt: 2026,
        nullifierSecret: "secret_val_xyz",
      };

      await handleZkpWorkerMessage(request, postMock);

      expect(snarkjs.wtns.calculate).toHaveBeenCalledTimes(1);
      expect(snarkjs.groth16.prove).toHaveBeenCalledTimes(1);

      // Verify progress sequence
      const progressSteps = postedMessages
        .filter((m) => m.type === "PROGRESS")
        .map((m: any) => m.step);

      expect(progressSteps).toEqual([
        "INITIALIZING",
        "LOADING_ARTIFACTS",
        "WITNESS_GENERATION",
        "PROOF_SYNTHESIS",
        "FINALIZING",
      ]);

      // Verify monotonic progress percentage
      const progressValues = postedMessages
        .filter((m) => m.type === "PROGRESS")
        .map((m: any) => m.progress);

      for (let i = 1; i < progressValues.length; i++) {
        expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1]);
      }

      // Verify success response contains proof and publicSignals
      const successMsg = postedMessages.find(
        (m) => m.type === "SUCCESS",
      ) as any;
      expect(successMsg).toBeDefined();
      expect(successMsg.proof).toEqual({
        pi_a: ["101", "102", "1"],
        pi_b: [
          ["201", "202"],
          ["203", "204"],
          ["1", "0"],
        ],
        pi_c: ["301", "302", "1"],
      });
      expect(successMsg.publicSignals).toEqual([
        "mock_root",
        "2026",
        "mock_nullifier",
      ]);
      expect(successMsg.simdAccelerated).toBe(true);
    });

    it("does not leak nullifierSecret or sensitive inputs in logs or messages", async () => {
      (snarkjs.wtns.calculate as jest.Mock).mockResolvedValue(undefined);
      (snarkjs.groth16.prove as jest.Mock).mockResolvedValue({
        proof: { pi_a: ["1"] },
        publicSignals: ["root"],
      });

      const superSecret = "TOP_SECRET_NULLIFIER_KEY_999";
      const request: WorkerRequest = {
        type: "GENERATE_PROOF",
        studentHash: "hash123",
        epochSalt: 2026,
        nullifierSecret: superSecret,
      };

      await handleZkpWorkerMessage(request, postMock);

      const serializedMessages = JSON.stringify(postedMessages);
      expect(serializedMessages).not.toContain(superSecret);
    });
  });

  describe("Error Handling & Validation", () => {
    it("handles missing or malformed input parameters with ERROR response", async () => {
      const emptyRequest: WorkerRequest = {
        type: "GENERATE_PROOF",
        studentHash: "",
        epochSalt: "",
        nullifierSecret: "",
      };

      await handleZkpWorkerMessage(emptyRequest, postMock);

      const errorMsg = postedMessages.find((m) => m.type === "ERROR") as any;
      expect(errorMsg).toBeDefined();
      expect(errorMsg.error).toContain(
        "Missing or malformed proof generation inputs",
      );
      expect(snarkjs.wtns.calculate).not.toHaveBeenCalled();
    });

    it("handles null or non-object message gracefully", async () => {
      await handleZkpWorkerMessage(null as any, postMock);
      const errorMsg = postedMessages.find((m) => m.type === "ERROR") as any;
      expect(errorMsg).toBeDefined();
      expect(errorMsg.error).toContain("Invalid worker message format");
    });

    it("handles witness calculation errors with sanitized error message", async () => {
      (snarkjs.wtns.calculate as jest.Mock).mockRejectedValue(
        new Error("Witness generation error: invalid constraint"),
      );

      const request: WorkerRequest = {
        type: "GENERATE_PROOF",
        studentHash: "valid_hash",
        epochSalt: 2026,
        nullifierSecret: "valid_secret",
      };

      await handleZkpWorkerMessage(request, postMock);

      const errorMsg = postedMessages.find((m) => m.type === "ERROR") as any;
      expect(errorMsg).toBeDefined();
      expect(errorMsg.error).toBe("Proof generation failed.");
      expect(errorMsg.isOom).toBe(false);
      expect(errorMsg.isTimeout).toBe(false);
    });

    it("handles out of memory RangeError correctly", async () => {
      (snarkjs.wtns.calculate as jest.Mock).mockRejectedValue(
        new RangeError("WebAssembly.Memory(): could not allocate memory"),
      );

      const request: WorkerRequest = {
        type: "GENERATE_PROOF",
        studentHash: "valid_hash",
        epochSalt: 2026,
        nullifierSecret: "valid_secret",
      };

      await handleZkpWorkerMessage(request, postMock);

      const errorMsg = postedMessages.find((m) => m.type === "ERROR") as any;
      expect(errorMsg).toBeDefined();
      expect(errorMsg.isOom).toBe(true);
      expect(errorMsg.error).toContain("does not have enough memory");
    });

    it("handles artifact loading failure / ENOENT correctly", async () => {
      (snarkjs.wtns.calculate as jest.Mock).mockRejectedValue(
        new Error(
          "ENOENT: could not load wasm binary file at /zkp/student_membership.wasm",
        ),
      );

      const request: WorkerRequest = {
        type: "GENERATE_PROOF",
        studentHash: "valid_hash",
        epochSalt: 2026,
        nullifierSecret: "valid_secret",
      };

      await handleZkpWorkerMessage(request, postMock);

      const errorMsg = postedMessages.find((m) => m.type === "ERROR") as any;
      expect(errorMsg).toBeDefined();
      expect(errorMsg.error).toContain("internal error");
    });
  });

  describe("Cancellation, Abort and Worker Lifecycle", () => {
    it("handles abort and cancel message by terminating curves and clearing state", async () => {
      const g = globalThis as any;
      const terminateBn128 = jest.fn().mockResolvedValue(undefined);
      g.curve_bn128 = { terminate: terminateBn128 };

      await handleZkpWorkerMessage({ type: "abort" }, postMock);

      expect(terminateBn128).toHaveBeenCalled();
      expect(postedMessages).toHaveLength(0); // abort does not post response
    });

    it("prevents stale worker execution results from posting after cancellation", async () => {
      let triggerResolve: () => void = () => {};
      (snarkjs.wtns.calculate as jest.Mock).mockImplementation(() => {
        return new Promise((resolve) => {
          triggerResolve = resolve;
        });
      });

      const reqPromise = handleZkpWorkerMessage(
        {
          type: "GENERATE_PROOF",
          studentHash: "hash1",
          epochSalt: 2026,
          nullifierSecret: "secret1",
        },
        postMock,
      );

      // Cancel before completion
      await handleZkpWorkerMessage({ type: "cancel" }, postMock);

      // Now complete proving
      triggerResolve();
      await reqPromise;

      // SUCCESS message must not be emitted for superseded generation
      const successMsgs = postedMessages.filter((m) => m.type === "SUCCESS");
      expect(successMsgs).toHaveLength(0);
    });

    it("releases witness memory buffers and zeroes typed arrays", () => {
      const buffer = new Uint8Array([1, 2, 3, 4, 5]);
      const wtns: any = { type: "mem", data: buffer };

      releaseWitnessBuffer(wtns);

      expect(Array.from(buffer)).toEqual([0, 0, 0, 0, 0]);
      expect(wtns.data).toBeNull();
    });

    it("resolves default artifact URLs for WASM and ZKEY", () => {
      const defaults = resolveArtifactUrls();
      expect(defaults.wasmUrl).toBe("/zkp/student_membership.wasm");
      expect(defaults.zkeyUrl).toBe("/zkp/student_membership.zkey");

      const custom = resolveArtifactUrls(
        "/custom/student_pass.wasm",
        "/custom/student_pass.zkey",
      );
      expect(custom.wasmUrl).toBe("/custom/student_pass.wasm");
      expect(custom.zkeyUrl).toBe("/custom/student_pass.zkey");
    });

    it("exports default proving and verification timeouts", () => {
      expect(DEFAULT_VERIFICATION_TIMEOUT_MS).toBe(15_000);
      expect(DEFAULT_PROVING_TIMEOUT_MS).toBe(30_000);
    });
  });

  describe("Error Classification Helper", () => {
    it("classifies error types correctly", () => {
      expect(classifyError(new Error("witness generation timed out"))).toBe(
        "timeout",
      );
      expect(classifyError(new Error("Out of memory on WebAssembly"))).toBe(
        "oom",
      );
      expect(
        classifyError(new RangeError("Maximum call stack size exceeded")),
      ).toBe("oom");
      expect(classifyError(new Error("wasm file not found"))).toBe("internal");
      expect(classifyError(new Error("unknown error"))).toBe("generic");
    });
  });
});
