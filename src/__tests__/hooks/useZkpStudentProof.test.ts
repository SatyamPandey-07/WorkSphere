import { renderHook, act } from "@testing-library/react";
import {
  useZkpStudentProof,
  computeExponentialBackoffDelay,
  isRetryableZkpError,
  type StudentProofInputs,
} from "@/hooks/useZkpStudentProof";

describe("useZkpStudentProof (#6509)", () => {
  const dummyInputs: StudentProofInputs = {
    studentId: "student-12345",
    secret: "0xabcdef123456",
    epoch: "2026-Q4",
    root: "0x1234567890abcdef",
    pathElements: ["0x1", "0x2"],
    pathIndices: [0, 1],
  };

  class MockWorker {
    public onmessage: ((e: MessageEvent) => void) | null = null;
    public onerror: ((e: ErrorEvent) => void) | null = null;
    public postMessage = jest.fn();
    public terminate = jest.fn();
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("Helper Functions", () => {
    it("computes 3-stage exponential backoff delays accurately", () => {
      expect(computeExponentialBackoffDelay(1, 1000, 2)).toBe(1000); // Stage 1 -> 1s
      expect(computeExponentialBackoffDelay(2, 1000, 2)).toBe(2000); // Stage 2 -> 2s
      expect(computeExponentialBackoffDelay(3, 1000, 2)).toBe(4000); // Stage 3 -> 4s
    });

    it("correctly identifies retryable transient ZKP errors (OOM, timeout, memory throttle)", () => {
      expect(isRetryableZkpError(new Error("Out of memory on mobile Web Worker"))).toBe(true);
      expect(isRetryableZkpError(new Error("witness generation timed out"))).toBe(true);
      expect(isRetryableZkpError({ isOom: true })).toBe(true);
      expect(isRetryableZkpError({ isTimeout: true })).toBe(true);
      expect(isRetryableZkpError(new Error("Invalid student ID signature"))).toBe(false);
    });
  });

  describe("Single Attempt Success", () => {
    it("completes proof generation on first attempt with progress updates", async () => {
      const mockWorker = new MockWorker();
      const workerFactory = jest.fn(() => mockWorker as unknown as Worker);

      const { result } = renderHook(() =>
        useZkpStudentProof({
          workerFactory,
          timeoutMs: 5000,
        }),
      );

      let promise: Promise<any>;
      act(() => {
        promise = result.current.generateProof(dummyInputs);
      });

      expect(result.current.isProving).toBe(true);
      expect(result.current.attempt).toBe(1);
      expect(result.current.circuitType).toBe("primary");

      // Advance timers for intermediate progress
      act(() => {
        jest.advanceTimersByTime(200);
      });

      // Worker replies with success
      act(() => {
        mockWorker.onmessage?.({
          data: {
            type: "success",
            proof: { pi_a: ["1", "2"] },
            publicSignals: ["signal-1"],
          },
        } as MessageEvent);
      });

      const outcome = await promise!;
      expect(outcome.proof).toEqual({ pi_a: ["1", "2"] });
      expect(outcome.circuitType).toBe("primary");
      expect(outcome.attemptsUsed).toBe(1);

      expect(result.current.isProving).toBe(false);
      expect(result.current.progress).toBe(100);
      expect(result.current.progressStage).toBe("complete");
    });
  });

  describe("Exponential Backoff Retry with Fallback Circuit", () => {
    it("retries with fallback circuit on transient OOM error and succeeds on attempt 2", async () => {
      const worker1 = new MockWorker();
      const worker2 = new MockWorker();
      const workers = [worker1, worker2];
      let workerCount = 0;
      const workerFactory = jest.fn(() => (workers[workerCount++] || new MockWorker()) as unknown as Worker);

      const onProgress = jest.fn();
      const { result } = renderHook(() =>
        useZkpStudentProof({
          workerFactory,
          initialBackoffMs: 1000,
          backoffMultiplier: 2,
          maxRetries: 3,
          onProgress,
        }),
      );

      let promise: Promise<any>;
      act(() => {
        promise = result.current.generateProof(dummyInputs);
      });

      expect(result.current.attempt).toBe(1);
      expect(result.current.circuitType).toBe("primary");

      // Attempt 1 fails with transient OOM error
      act(() => {
        worker1.onmessage?.({
          data: {
            type: "error",
            error: "Out of memory in WebAssembly linear memory",
            isOom: true,
          },
        } as MessageEvent);
      });

      // Hook enters retrying state with fallback circuit indicated
      expect(result.current.progressStage).toBe("retrying");
      expect(result.current.circuitType).toBe("fallback");

      // Advance through exponential backoff delay (1000ms)
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      // Now Attempt 2 starts on worker2 with fallback circuit
      expect(result.current.attempt).toBe(2);
      expect(worker2.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          circuit: "fallback",
          useFallbackCircuit: true,
        }),
      );

      // Attempt 2 succeeds
      act(() => {
        worker2.onmessage?.({
          data: {
            type: "success",
            proof: { pi_a: ["fallback-1", "fallback-2"] },
            publicSignals: ["fallback-signal"],
          },
        } as MessageEvent);
      });

      const outcome = await promise!;
      expect(outcome.circuitType).toBe("fallback");
      expect(outcome.attemptsUsed).toBe(2);
      expect(result.current.progress).toBe(100);
    });

    it("terminates and throws after exhausting 3 retry stages", async () => {
      const workerFactory = jest.fn(() => new MockWorker() as unknown as Worker);

      const { result } = renderHook(() =>
        useZkpStudentProof({
          workerFactory,
          initialBackoffMs: 500,
          maxRetries: 3,
        }),
      );

      let promise: Promise<any>;
      act(() => {
        promise = result.current.generateProof(dummyInputs);
      });

      // Stage 1 fail
      act(() => {
        (result.current as any);
        const w1 = workerFactory.mock.results[0].value;
        w1.onmessage({ data: { type: "error", error: "OOM error", isOom: true } });
      });

      // Backoff 1 (500ms)
      act(() => {
        jest.advanceTimersByTime(500);
      });

      // Stage 2 fail
      act(() => {
        const w2 = workerFactory.mock.results[1].value;
        w2.onmessage({ data: { type: "error", error: "OOM error", isOom: true } });
      });

      // Backoff 2 (1000ms)
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      // Stage 3 fail
      act(() => {
        const w3 = workerFactory.mock.results[2].value;
        w3.onmessage({ data: { type: "error", error: "Final OOM limit reached", isOom: true } });
      });

      await expect(promise!).rejects.toThrow("Final OOM limit reached");
      expect(result.current.isProving).toBe(false);
      expect(result.current.progressStage).toBe("error");
    });
  });

  describe("Cancellation & Reset", () => {
    it("aborts worker execution and resets status when cancelled", () => {
      const mockWorker = new MockWorker();
      const workerFactory = jest.fn(() => mockWorker as unknown as Worker);

      const { result } = renderHook(() =>
        useZkpStudentProof({
          workerFactory,
        }),
      );

      act(() => {
        void result.current.generateProof(dummyInputs);
      });

      expect(result.current.isProving).toBe(true);

      act(() => {
        result.current.cancel();
      });

      expect(mockWorker.terminate).toHaveBeenCalled();
      expect(result.current.isProving).toBe(false);
      expect(result.current.progressStage).toBe("idle");
    });
  });
});
