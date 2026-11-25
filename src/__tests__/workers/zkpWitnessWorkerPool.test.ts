/**
 * Unit and Performance Benchmark Tests for Multi-threaded Circom Witness Calculator
 * in Web Worker Pool (#9726).
 */

import {
  ZkpWitnessWorkerPool,
  resolvePoolConcurrency,
  type ZkpWitnessTask,
  type CalculateWitnessRequest,
  type CancelJobRequest,
  terminateCurveBn128,
} from "@/workers/zkpWorker";
import { StudentDiscountVerifier } from "@/features/zkp/studentDiscountVerifier";

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

class MockPoolWorker {
  static instances: MockPoolWorker[] = [];
  public listeners: Record<string, ((event: any) => void)[]> = {};
  public postedMessages: any[] = [];
  public isTerminated = false;

  constructor() {
    MockPoolWorker.instances.push(this);
  }

  addEventListener(type: string, listener: (event: any) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: (event: any) => void) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
  }

  postMessage(message: CalculateWitnessRequest | CancelJobRequest | any) {
    this.postedMessages.push(message);

    if (message.type === "CALCULATE_WITNESS") {
      const { jobId } = message;

      // Simulate asynchronous witness computation and Groth16 proving
      setTimeout(() => {
        if (this.isTerminated) return;

        // Emit progress
        const progressListener = this.listeners["message"];
        if (progressListener) {
          progressListener.forEach((cb) =>
            cb({
              data: {
                type: "WITNESS_PROGRESS",
                jobId,
                step: "WITNESS_GENERATION",
                progress: 0.5,
              },
            }),
          );
        }

        // Emit success
        setTimeout(() => {
          if (this.isTerminated) return;
          if (progressListener) {
            progressListener.forEach((cb) =>
              cb({
                data: {
                  type: "WITNESS_SUCCESS",
                  jobId,
                  proof: { protocol: "groth16", pi_a: ["1", "2"] },
                  publicSignals: ["1849102948", "2026"],
                  durationMs: 15,
                  simdAccelerated: true,
                },
              }),
            );
          }
        }, 10);
      }, 5);
    }
  }

  terminate() {
    this.isTerminated = true;
  }
}

describe("ZkpWitnessWorkerPool Multi-threaded Witness Calculator (#9726)", () => {
  beforeEach(() => {
    MockPoolWorker.instances = [];
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await terminateCurveBn128();
  });

  describe("Concurrency Resolution & Pool Sizing", () => {
    it("respects explicit custom concurrency options", () => {
      expect(resolvePoolConcurrency(4)).toBe(4);
      expect(resolvePoolConcurrency(1)).toBe(1);
      expect(resolvePoolConcurrency(8)).toBe(8);
    });

    it("bounds worker pool to hardwareConcurrency - 1 reserving main thread headroom", () => {
      const originalNavigator = global.navigator;
      try {
        // Quad-core nomad laptop: 4 logical cores -> 3 workers (bounded at min(3, 4))
        Object.defineProperty(global, "navigator", {
          value: { hardwareConcurrency: 4 },
          configurable: true,
        });
        expect(resolvePoolConcurrency()).toBe(3);

        // 8-core machine -> 4 workers (capped at 4)
        Object.defineProperty(global, "navigator", {
          value: { hardwareConcurrency: 8 },
          configurable: true,
        });
        expect(resolvePoolConcurrency()).toBe(4);

        // Single-core machine -> 1 worker fallback
        Object.defineProperty(global, "navigator", {
          value: { hardwareConcurrency: 1 },
          configurable: true,
        });
        expect(resolvePoolConcurrency()).toBe(1);
      } finally {
        Object.defineProperty(global, "navigator", {
          value: originalNavigator,
          configurable: true,
        });
      }
    });

    it("spawns expected number of worker instances in pool", () => {
      const pool = new ZkpWitnessWorkerPool({
        poolSize: 3,
        workerFactory: () => new MockPoolWorker() as any,
      });

      expect(pool.getPoolSize()).toBe(3);
      expect(pool.getActiveWorkerCount()).toBe(0);
      expect(pool.getQueueLength()).toBe(0);
    });
  });

  describe("Job Queuing and Parallel Task Execution", () => {
    it("executes independent witness calculation tasks across workers concurrently", async () => {
      const pool = new ZkpWitnessWorkerPool({
        poolSize: 2,
        workerFactory: () => new MockPoolWorker() as any,
      });

      const task1: ZkpWitnessTask = {
        id: "task-1",
        circuitInputs: { secret: "111", epoch: 2026 },
      };
      const task2: ZkpWitnessTask = {
        id: "task-2",
        circuitInputs: { secret: "222", epoch: 2026 },
      };

      const [res1, res2] = await Promise.all([
        pool.executeTask(task1),
        pool.executeTask(task2),
      ]);

      expect(res1.jobId).toBe("task-1");
      expect(res2.jobId).toBe("task-2");
      expect(res1.proof).toBeDefined();
      expect(res2.proof).toBeDefined();
      expect(res1.publicSignals).toEqual(["1849102948", "2026"]);
      expect(res2.publicSignals).toEqual(["1849102948", "2026"]);

      await pool.terminate();
    });

    it("queues excess tasks when all pool workers are busy", async () => {
      const pool = new ZkpWitnessWorkerPool({
        poolSize: 1, // Single worker pool
        workerFactory: () => new MockPoolWorker() as any,
      });

      const task1: ZkpWitnessTask = {
        id: "task-1",
        circuitInputs: { secret: "111" },
      };
      const task2: ZkpWitnessTask = {
        id: "task-2",
        circuitInputs: { secret: "222" },
      };

      const promise1 = pool.executeTask(task1);
      const promise2 = pool.executeTask(task2);

      // Task 2 should be queued behind Task 1
      const [res1, res2] = await Promise.all([promise1, promise2]);

      expect(res1.jobId).toBe("task-1");
      expect(res2.jobId).toBe("task-2");

      const metrics = pool.getMetrics();
      expect(metrics.totalJobsProcessed).toBe(2);

      await pool.terminate();
    });

    it("handles task cancellation via AbortSignal", async () => {
      const pool = new ZkpWitnessWorkerPool({
        poolSize: 1,
        workerFactory: () => new MockPoolWorker() as any,
      });

      const controller = new AbortController();
      const task: ZkpWitnessTask = {
        id: "abort-task",
        circuitInputs: { secret: "999" },
        signal: controller.signal,
      };

      const taskPromise = pool.executeTask(task);
      controller.abort();

      await expect(taskPromise).rejects.toThrow("aborted");

      await pool.terminate();
    });

    it("rejects immediately if task signal is already aborted", async () => {
      const pool = new ZkpWitnessWorkerPool({
        poolSize: 2,
        workerFactory: () => new MockPoolWorker() as any,
      });

      const controller = new AbortController();
      controller.abort();

      const task: ZkpWitnessTask = {
        id: "already-aborted",
        circuitInputs: { secret: "000" },
        signal: controller.signal,
      };

      await expect(pool.executeTask(task)).rejects.toThrow("aborted before execution");

      await pool.terminate();
    });

    it("rejects task on worker timeout", async () => {
      class HangingWorker extends MockPoolWorker {
        postMessage() {
          // Intentionally do not respond
        }
      }

      const pool = new ZkpWitnessWorkerPool({
        poolSize: 1,
        timeoutMs: 50,
        workerFactory: () => new HangingWorker() as any,
      });

      const task: ZkpWitnessTask = {
        id: "timeout-task",
        circuitInputs: { secret: "timeout" },
        timeoutMs: 30,
      };

      await expect(pool.executeTask(task)).rejects.toThrow("timed out");

      await pool.terminate();
    });
  });

  describe("Integration with StudentDiscountVerifier Orchestrator", () => {
    it("delegates to worker pool when useWorkerPool is enabled", async () => {
      const verifier = new StudentDiscountVerifier({
        useWorkerPool: true,
        createWorker: () => new MockPoolWorker() as any,
      });

      const result = await verifier.generateProof({
        secret: "student-123",
        epoch: 2026,
        root: "1849102948",
      });

      expect(result.proofSource).toBe("worker");
      expect(result.publicSignals).toEqual(["1849102948", "2026"]);

      await verifier.terminate();
    });

    it("scales witness calculation across multi-job batch without blocking", async () => {
      const verifier = new StudentDiscountVerifier({
        useWorkerPool: true,
        poolSize: 4,
        createWorker: () => new MockPoolWorker() as any,
      });

      const jobs = Array.from({ length: 8 }, (_, i) =>
        verifier.generateProof({
          secret: `student-${i}`,
          epoch: 2026,
          root: "1849102948",
        }),
      );

      const results = await Promise.all(jobs);
      expect(results).toHaveLength(8);
      results.forEach((res) => {
        expect(res.proofSource).toBe("worker");
        expect(res.publicSignals).toEqual(["1849102948", "2026"]);
      });

      await verifier.terminate();
    });
  });

  describe("Reproducible Benchmarking: Serial vs Worker Pool Throughput", () => {
    it("compares serial execution against multi-worker pool throughput", async () => {
      const jobCount = 6;
      const simulatedDurationMs = 20;

      class BenchmarkWorker extends MockPoolWorker {
        postMessage(message: any) {
          if (message.type === "CALCULATE_WITNESS") {
            const { jobId } = message;
            setTimeout(() => {
              if (this.isTerminated) return;
              this.listeners["message"]?.forEach((cb) =>
                cb({
                  data: {
                    type: "WITNESS_SUCCESS",
                    jobId,
                    proof: { protocol: "groth16" },
                    publicSignals: ["1849102948", "2026"],
                    durationMs: simulatedDurationMs,
                  },
                }),
              );
            }, simulatedDurationMs);
          }
        }
      }

      // 1. Serial (poolSize: 1)
      const serialPool = new ZkpWitnessWorkerPool({
        poolSize: 1,
        workerFactory: () => new BenchmarkWorker() as any,
      });

      const serialStart = Date.now();
      for (let i = 0; i < jobCount; i++) {
        await serialPool.executeTask({
          id: `serial-${i}`,
          circuitInputs: { secret: `${i}` },
        });
      }
      const serialDuration = Date.now() - serialStart;
      await serialPool.terminate();

      // 2. Parallel Pool (poolSize: 3)
      const parallelPool = new ZkpWitnessWorkerPool({
        poolSize: 3,
        workerFactory: () => new BenchmarkWorker() as any,
      });

      const parallelStart = Date.now();
      await Promise.all(
        Array.from({ length: jobCount }, (_, i) =>
          parallelPool.executeTask({
            id: `parallel-${i}`,
            circuitInputs: { secret: `${i}` },
          }),
        ),
      );
      const parallelDuration = Date.now() - parallelStart;
      await parallelPool.terminate();

      // Parallel pool should finish significantly faster than serial execution
      expect(parallelDuration).toBeLessThan(serialDuration);
    });
  });
});
