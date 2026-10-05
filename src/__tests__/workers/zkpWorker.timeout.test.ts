import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DEFAULT_VERIFICATION_TIMEOUT_MS,
  withTimeout,
} from "@/workers/zkpWorker";

describe("zkpWorker Verification & Proving Timeout Handling", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("exports a default verification timeout of 15 seconds (15000 ms)", () => {
    expect(DEFAULT_VERIFICATION_TIMEOUT_MS).toBe(15_000);
  });

  it("resolves successfully when proof generation completes within timeout limit", async () => {
    const mockProofTask = async () => {
      return { proof: { pi_a: ["1"] }, publicSignals: ["100"] };
    };

    const result = await withTimeout(mockProofTask, 5000);
    expect(result).toEqual({ proof: { pi_a: ["1"] }, publicSignals: ["100"] });
  });

  it("rejects with VERIFICATION_TIMEOUT structured error when operation exceeds timeout threshold", async () => {
    vi.useFakeTimers();

    const hangingWorkerTask = () =>
      new Promise<{ proof: unknown }>((resolve) => {
        // Simulates worker deadlock / infinite loop during witness calculation
        setTimeout(() => {
          resolve({ proof: {} });
        }, 30_000);
      });

    const timeoutPromise = withTimeout(hangingWorkerTask, 15_000);

    // Fast-forward past the 15-second timeout window
    vi.advanceTimersByTime(15_001);

    await expect(timeoutPromise).rejects.toThrow("VERIFICATION_TIMEOUT");
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
});
