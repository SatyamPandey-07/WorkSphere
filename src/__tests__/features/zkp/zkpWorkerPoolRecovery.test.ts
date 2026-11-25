/**
 * zkpWorkerPoolRecovery.test.ts
 *
 * Unit tests verifying WebWorker ZKP witness pool memory leak prevention,
 * worker termination, and steady-state recovery on unhandled proof generation failure (#10018).
 */

import {
  ZkpWitnessWorkerPool,
  ZkpWitnessTask,
  releaseZkpWasmMemory,
  terminateCurveBn128,
} from "@/workers/zkpWorker";
import {
  createStudentDiscountVerifier,
  StudentDiscountVerifier,
  ZkpWorkerLike,
} from "@/features/zkp/studentDiscountVerifier";

class MockRecoverableWorker {
  static instances: MockRecoverableWorker[] = [];
  public listeners: Record<string, ((event: any) => void)[]> = {};
  public postedMessages: any[] = [];
  public isTerminated = false;
  public onmessage: ((event: any) => void) | null = null;
  public onerror: ((event: any) => void) | null = null;
  public id: number;

  constructor() {
    this.id = MockRecoverableWorker.instances.length;
    MockRecoverableWorker.instances.push(this);
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
  }

  terminate() {
    this.isTerminated = true;
  }

  triggerError(errorDetail: string) {
    const errorListeners = this.listeners["error"];
    if (errorListeners) {
      errorListeners.forEach((cb) => cb({ message: errorDetail }));
    }
    if (typeof this.onerror === "function") {
      this.onerror({ message: errorDetail });
    }
  }

  triggerMessage(data: any) {
    const msgListeners = this.listeners["message"];
    if (msgListeners) {
      msgListeners.forEach((cb) => cb({ data }));
    }
    if (typeof this.onmessage === "function") {
      this.onmessage({ data } as any);
    }
  }
}

describe("ZKP Worker Pool Memory Leak Prevention & Failure Recovery (#10018)", () => {
  beforeEach(() => {
    MockRecoverableWorker.instances = [];
    jest.clearAllMocks();
  });

  afterEach(async () => {
    releaseZkpWasmMemory();
    await terminateCurveBn128();
  });

  describe("ZkpWitnessWorkerPool Recovery", () => {
    it("terminates faulty worker and spawns a fresh worker on unhandled error", async () => {
      const pool = new ZkpWitnessWorkerPool({
        poolSize: 2,
        workerFactory: () => new MockRecoverableWorker() as any,
      });

      expect(pool.getPoolSize()).toBe(2);
      expect(MockRecoverableWorker.instances).toHaveLength(2);

      const worker0 = MockRecoverableWorker.instances[0];

      const task1: ZkpWitnessTask = {
        id: "job-failing-1",
        circuitInputs: { studentId: "stu-err" },
      };

      const taskPromise = pool.executeTask(task1);

      // Simulate unhandled worker error (e.g., OOM / WASM trap)
      worker0.triggerError("Out of memory in WASM witness generator");

      // Caller promise must be rejected with error details
      await expect(taskPromise).rejects.toThrow(
        "Out of memory in WASM witness generator",
      );

      // Faulty worker must have been forcefully terminated
      expect(worker0.isTerminated).toBe(true);

      // Pool steady-state capacity must be maintained by spawning a replacement worker
      expect(pool.getPoolSize()).toBe(2);
      expect(MockRecoverableWorker.instances).toHaveLength(3);

      const replacementWorker = MockRecoverableWorker.instances[2];
      expect(replacementWorker.isTerminated).toBe(false);

      await pool.terminate();
    });

    it("processes subsequent queued tasks successfully using the replacement worker", async () => {
      const pool = new ZkpWitnessWorkerPool({
        poolSize: 1,
        workerFactory: () => new MockRecoverableWorker() as any,
      });

      const worker1 = MockRecoverableWorker.instances[0];

      // Dispatch failing task
      const failPromise = pool.executeTask({
        id: "job-fail",
        circuitInputs: { bad: true },
      });
      worker1.triggerError("SnarkJS witness calculation failed");
      await expect(failPromise).rejects.toThrow(
        "SnarkJS witness calculation failed",
      );
      expect(worker1.isTerminated).toBe(true);

      // Replacement worker exists in pool
      expect(pool.getPoolSize()).toBe(1);
      const worker2 = MockRecoverableWorker.instances[1];
      expect(worker2.isTerminated).toBe(false);

      // Dispatch subsequent valid task
      const successPromise = pool.executeTask({
        id: "job-success",
        circuitInputs: { valid: true },
      });

      worker2.triggerMessage({
        type: "WITNESS_SUCCESS",
        jobId: "job-success",
        proof: { pi_a: ["1", "2"] },
        publicSignals: ["100"],
        durationMs: 12,
      });

      const result = await successPromise;
      expect(result.jobId).toBe("job-success");
      expect(result.publicSignals).toEqual(["100"]);

      await pool.terminate();
    });

    it("terminates all workers cleanly when pool is terminated", async () => {
      const pool = new ZkpWitnessWorkerPool({
        poolSize: 3,
        workerFactory: () => new MockRecoverableWorker() as any,
      });

      expect(MockRecoverableWorker.instances).toHaveLength(3);

      await pool.terminate();

      MockRecoverableWorker.instances.forEach((w) => {
        expect(w.isTerminated).toBe(true);
      });
      expect(pool.getPoolSize()).toBe(0);
    });
  });

  describe("createStudentDiscountVerifier Error Cleanup", () => {
    it("terminates worker and cleans up heap on unhandled worker error event", async () => {
      let createdWorker: MockRecoverableWorker | null = null;
      const workerFactory = (): ZkpWorkerLike => {
        createdWorker = new MockRecoverableWorker();
        return createdWorker as unknown as ZkpWorkerLike;
      };

      const verifier = createStudentDiscountVerifier({ workerFactory });

      const proofPromise = verifier.generateStudentDiscountProof({
        studentId: "test-student",
        institutionDomain: "campus.edu",
      });

      expect(createdWorker).not.toBeNull();
      // Trigger error
      createdWorker!.triggerError("WASM compilation failed");

      await expect(proofPromise).rejects.toThrow("WASM compilation failed");
      expect(createdWorker!.isTerminated).toBe(true);
    });

    it("terminates worker on PROOF_ERROR message", async () => {
      let createdWorker: MockRecoverableWorker | null = null;
      const workerFactory = (): ZkpWorkerLike => {
        createdWorker = new MockRecoverableWorker();
        return createdWorker as unknown as ZkpWorkerLike;
      };

      const verifier = createStudentDiscountVerifier({ workerFactory });

      const proofPromise = verifier.generateStudentDiscountProof({
        studentId: "test-student",
        institutionDomain: "campus.edu",
      });

      createdWorker!.triggerMessage({
        type: "PROOF_ERROR",
        error: "Malformed circuit constraints",
      });

      await expect(proofPromise).rejects.toThrow(
        "Malformed circuit constraints",
      );
      expect(createdWorker!.isTerminated).toBe(true);
    });
  });

  describe("StudentDiscountVerifier class", () => {
    it("initializes and terminates pool properly", async () => {
      const verifier = new StudentDiscountVerifier({
        poolSize: 2,
        workerFactory: () => new MockRecoverableWorker() as any,
      });

      const pool = verifier.getWorkerPool();
      expect(pool.getPoolSize()).toBe(2);

      await verifier.terminate();
      expect(pool.getPoolSize()).toBe(0);
    });
  });
});
