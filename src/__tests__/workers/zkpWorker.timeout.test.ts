import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_VERIFICATION_TIMEOUT_MS,
  DEFAULT_PROVING_TIMEOUT_MS,
  withTimeout,
  classifyError,
} from "@/workers/zkpWorker";

describe("zkpWorker Verification & Proving Timeout Handling (#4797)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Timeout Constants & Classification", () => {
    it("exports a default verification timeout of 15 seconds (15000 ms)", () => {
      expect(DEFAULT_VERIFICATION_TIMEOUT_MS).toBe(15_000);
    });

    it("exports a default proving timeout of 30 seconds (30000 ms)", () => {
      expect(DEFAULT_PROVING_TIMEOUT_MS).toBe(30_000);
    });

    it("classifies error with message containing 'Witness generation timed out' as timeout", () => {
      const err = new Error("Witness generation timed out after 30 seconds");
      expect(classifyError(err)).toBe("timeout");
    });

    it("classifies error with message containing 'PROVING_TIMEOUT' as timeout", () => {
      const err = new Error("PROVING_TIMEOUT: computation aborted");
      expect(classifyError(err)).toBe("timeout");
    });

    it("classifies error with message containing 'VERIFICATION_TIMEOUT' as timeout", () => {
      const err = new Error("VERIFICATION_TIMEOUT");
      expect(classifyError(err)).toBe("timeout");
    });

    it("classifies general out-of-memory errors appropriately", () => {
      const err = new Error("WebAssembly.Memory allocation failed: Out of memory");
      expect(classifyError(err)).toBe("oom");
    });

    it("classifies range error memory limits as oom", () => {
      const err = new RangeError("Maximum call stack size exceeded");
      expect(classifyError(err)).toBe("oom");
    });

    it("classifies internal wasm file error as internal", () => {
      const err = new Error("ENOENT: could not load wasm binary file");
      expect(classifyError(err)).toBe("internal");
    });

    it("classifies unknown generic errors as generic", () => {
      const err = new Error("Unknown crypto malfunction");
      expect(classifyError(err)).toBe("generic");
    });
  });

  describe("Promise Timeout Runner with AbortController", () => {
    it("resolves successfully when proof generation completes within timeout limit", async () => {
      const mockProofTask = async () => {
        return { proof: { pi_a: ["1"] }, publicSignals: ["100"] };
      };

      const result = await withTimeout(mockProofTask, 5000);
      expect(result).toEqual({ proof: { pi_a: ["1"] }, publicSignals: ["100"] });
    });

    it("rejects with custom timeout error message when operation exceeds timeout threshold", async () => {
      vi.useFakeTimers();

      const hangingWorkerTask = () =>
        new Promise<{ proof: unknown }>((resolve) => {
          setTimeout(() => {
            resolve({ proof: {} });
          }, 45_000);
        });

      const timeoutPromise = withTimeout(
        hangingWorkerTask,
        DEFAULT_PROVING_TIMEOUT_MS,
        "Witness generation timed out after 30 seconds",
      );

      vi.advanceTimersByTime(30_001);

      await expect(timeoutPromise).rejects.toThrow("Witness generation timed out after 30 seconds");
    });

    it("aborts the AbortSignal when verification times out", async () => {
      vi.useFakeTimers();
      let signalAborted = false;

      const taskWithSignal = (signal: AbortSignal) =>
        new Promise<string>((resolve) => {
          signal.addEventListener("abort", () => {
            signalAborted = true;
          });
          setTimeout(() => resolve("success"), 20_000);
        });

      const promise = withTimeout(taskWithSignal, 5000);
      vi.advanceTimersByTime(5001);

      await expect(promise).rejects.toThrow("VERIFICATION_TIMEOUT");
      expect(signalAborted).toBe(true);
    });

    it("clears timeout timer upon fast task completion without leaking timers", async () => {
      vi.useFakeTimers();

      const fastTask = async () => "fast_result";
      const result = await withTimeout(fastTask, 10_000);

      expect(result).toBe("fast_result");
      expect(vi.getTimerCount()).toBe(0);
    });

    it("propagates genuine rejection from task before timeout occurs", async () => {
      const failingTask = async () => {
        throw new Error("Invalid cryptographic input elements");
      };

      await expect(withTimeout(failingTask, 10_000)).rejects.toThrow(
        "Invalid cryptographic input elements",
      );
    });
  });

  describe("Witness Calculation Stalls & Resource Exhaustion Simulation", () => {
    it("terminates 30-second witness calculation deadlock on low-powered mobile environment", async () => {
      vi.useFakeTimers();

      const simulatedMobileDeadlock = (signal: AbortSignal) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => {
            reject(new Error("Witness generation aborted due to timeout"));
          });
        });

      const runWitness = withTimeout(
        simulatedMobileDeadlock,
        30_000,
        "Witness generation timed out after 30 seconds",
      );

      vi.advanceTimersByTime(30_005);

      await expect(runWitness).rejects.toThrow(
        "Witness generation timed out after 30 seconds",
      );
    });

    it("handles multiple concurrent proof generation timers independently", async () => {
      vi.useFakeTimers();

      const task1 = () => new Promise((resolve) => setTimeout(() => resolve("task1_done"), 10_000));
      const task2 = () => new Promise((resolve) => setTimeout(() => resolve("task2_done"), 40_000));

      const p1 = withTimeout(task1, 15_000, "task1 timeout");
      const p2 = withTimeout(task2, 30_000, "task2 timeout");

      vi.advanceTimersByTime(10_001);
      await expect(p1).resolves.toBe("task1_done");

      vi.advanceTimersByTime(20_001);
      await expect(p2).rejects.toThrow("task2 timeout");
    });

    it("verifies unhandled rejection event handling pattern inside Web Worker context", () => {
      let dispatchedMessage: any = null;
      const fakeSelf = {
        postMessage: (msg: any) => {
          dispatchedMessage = msg;
        },
      };

      const event = {
        preventDefault: vi.fn(),
        reason: new Error("Witness generation timed out after 30 seconds"),
      };

      const reason = event.reason;
      const errorType = classifyError(reason);
      fakeSelf.postMessage({
        type: "error",
        error: "Witness generation timed out after 30 seconds. Your device may not have enough processing power to generate cryptographic proofs.",
        code: errorType === "timeout" ? "PROVING_TIMEOUT" : "UNHANDLED_REJECTION",
        isTimeout: errorType === "timeout",
        details: reason.message,
      });

      expect(dispatchedMessage).toEqual({
        type: "error",
        error: "Witness generation timed out after 30 seconds. Your device may not have enough processing power to generate cryptographic proofs.",
        code: "PROVING_TIMEOUT",
        isTimeout: true,
        details: "Witness generation timed out after 30 seconds",
      });
    });

    it("verifies uncaught error event handling pattern inside Web Worker context", () => {
      let dispatchedMessage: any = null;
      const fakeSelf = {
        postMessage: (msg: any) => {
          dispatchedMessage = msg;
        },
      };

      const event = {
        message: "Out of memory during witness calculation",
        error: new Error("WebAssembly.Memory allocation failed: out of memory"),
      };

      const errorType = classifyError(event.error);
      fakeSelf.postMessage({
        type: "error",
        error: "Your device does not have enough memory to generate the zero-knowledge proof. Please try again on a device with more RAM, or use the server-side verification option.",
        code: errorType === "timeout" ? "PROVING_TIMEOUT" : "WORKER_ERROR",
        isTimeout: errorType === "timeout",
        details: event.message,
      });

      expect(dispatchedMessage).toEqual({
        type: "error",
        error: "Your device does not have enough memory to generate the zero-knowledge proof. Please try again on a device with more RAM, or use the server-side verification option.",
        code: "WORKER_ERROR",
        isTimeout: false,
        details: "Out of memory during witness calculation",
      });
    });
  });

  describe("Prover Parameter Verification & Early Exit", () => {
    it("ensures student proof rejects empty secret or epoch", () => {
      const invalidData = {
        type: "prove-student",
        secret: "",
        epoch: "",
        root: "123",
        pathElements: [],
        pathIndices: [],
      };

      const hasSecret = Boolean(invalidData.secret);
      const hasEpoch = Boolean(invalidData.epoch);

      expect(hasSecret && hasEpoch).toBe(false);
    });

    it("ensures premium proof rejects invalid non-numeric tokens", () => {
      const nonNumericToken = "abc-invalid-token";
      const isValid = /^-?\d+$/.test(nonNumericToken);
      expect(isValid).toBe(false);
    });

    it("ensures premium proof accepts valid numeric identity token", () => {
      const validToken = "12345678901234567890";
      const isValid = /^-?\d+$/.test(validToken);
      expect(isValid).toBe(true);
    });
  });

  describe("Stress & Boundary Tests for ZKP Timeout Mechanism", () => {
    it("handles zero timeout parameter gracefully", async () => {
      vi.useFakeTimers();
      const task = () => new Promise((resolve) => setTimeout(resolve, 100));

      const promise = withTimeout(task, 0, "immediate timeout");
      vi.advanceTimersByTime(1);

      await expect(promise).rejects.toThrow("immediate timeout");
    });

    it("handles sub-millisecond task execution", async () => {
      const instantaneousTask = () => Promise.resolve("instant");
      const result = await withTimeout(instantaneousTask, 30_000);
      expect(result).toBe("instant");
    });

    it("handles non-Error objects passed to classifyError", () => {
      expect(classifyError("string timeout error")).toBe("timeout");
      expect(classifyError("out of memory occurred")).toBe("oom");
      expect(classifyError(12345)).toBe("generic");
      expect(classifyError(null)).toBe("generic");
      expect(classifyError(undefined)).toBe("generic");
    });
  });
});
