import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OcrWorkerManager, WorkerInstanceLike } from "@/workers/ocrWorker";

describe("OcrWorkerManager Idle Timeout & Termination (#5736)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("terminates worker after inactivity timeout elapses", () => {
    const terminateMock = vi.fn();
    const postMessageMock = vi.fn();

    const mockWorkerFactory = (): WorkerInstanceLike => ({
      postMessage: postMessageMock,
      terminate: terminateMock,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    const manager = new OcrWorkerManager({
      idleTimeoutMs: 120000, // 2 minutes
      workerFactory: mockWorkerFactory,
    });

    expect(manager.isWorkerActive()).toBe(false);

    // Spawn worker
    const worker = manager.getOrCreateWorker();
    expect(manager.isWorkerActive()).toBe(true);
    expect(worker).toBeDefined();

    // Schedule idle termination (e.g. after job completes)
    manager.scheduleIdleTermination();

    // Advance 60 seconds (halfway through idle window)
    vi.advanceTimersByTime(60000);
    expect(terminateMock).not.toHaveBeenCalled();
    expect(manager.isWorkerActive()).toBe(true);

    // Advance remaining 60 seconds (total 120s)
    vi.advanceTimersByTime(60000);
    expect(terminateMock).toHaveBeenCalledTimes(1);
    expect(manager.isWorkerActive()).toBe(false);
  });

  it("re-spawns worker seamlessly when a new OCR extraction task is requested", () => {
    const terminateMock1 = vi.fn();
    const terminateMock2 = vi.fn();
    let spawnCount = 0;

    const mockWorkerFactory = (): WorkerInstanceLike => {
      spawnCount++;
      return {
        postMessage: vi.fn(),
        terminate: spawnCount === 1 ? terminateMock1 : terminateMock2,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
    };

    const manager = new OcrWorkerManager({
      idleTimeoutMs: 5000,
      workerFactory: mockWorkerFactory,
    });

    // 1st request spawns worker 1
    manager.startJob();
    expect(spawnCount).toBe(1);
    expect(manager.isWorkerActive()).toBe(true);

    // End job triggers idle countdown
    manager.endJob();
    vi.advanceTimersByTime(5000);

    // Worker 1 is terminated
    expect(terminateMock1).toHaveBeenCalledTimes(1);
    expect(manager.isWorkerActive()).toBe(false);

    // 2nd request re-spawns worker 2 seamlessly
    manager.startJob();
    expect(spawnCount).toBe(2);
    expect(manager.isWorkerActive()).toBe(true);

    manager.endJob();
    vi.advanceTimersByTime(5000);
    expect(terminateMock2).toHaveBeenCalledTimes(1);
    expect(manager.isWorkerActive()).toBe(false);
  });

  it("cancels idle termination timer when a new job starts before timeout", () => {
    const terminateMock = vi.fn();

    const manager = new OcrWorkerManager({
      idleTimeoutMs: 10000,
      workerFactory: () => ({
        postMessage: vi.fn(),
        terminate: terminateMock,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });

    manager.startJob();
    manager.endJob();

    // Advance 7 seconds (almost timed out)
    vi.advanceTimersByTime(7000);
    expect(terminateMock).not.toHaveBeenCalled();

    // New job arrives, resetting timer
    manager.startJob();

    // Advance past previous 10s deadline
    vi.advanceTimersByTime(5000);
    expect(terminateMock).not.toHaveBeenCalled();
    expect(manager.isWorkerActive()).toBe(true);

    // End job and allow full 10s idle
    manager.endJob();
    vi.advanceTimersByTime(10000);
    expect(terminateMock).toHaveBeenCalledTimes(1);
    expect(manager.isWorkerActive()).toBe(false);
  });
});
