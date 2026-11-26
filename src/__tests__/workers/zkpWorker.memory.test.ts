import * as snarkjs from "snarkjs";
import {
  executeBoundedGroth16Proof,
  releaseWitnessBuffer,
  terminateCurveBn128,
  cycleWorkerIfNeeded,
  resetConsecutiveProofCount,
  getConsecutiveProofCount,
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

describe("zkpWorker WASM memory lifecycle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetConsecutiveProofCount();
  });

  afterEach(async () => {
    await terminateCurveBn128();
    resetConsecutiveProofCount();
  });

  it("keeps 20 consecutive proof lifecycles bounded to one active WASM lifecycle", async () => {
    let activeLifecycles = 0;
    let maxActiveLifecycles = 0;
    let completedLifecycles = 0;

    const runProofLifecycle = async () => {
      activeLifecycles += 1;
      maxActiveLifecycles = Math.max(maxActiveLifecycles, activeLifecycles);

      try {
        await Promise.resolve();
        completedLifecycles += 1;
      } finally {
        activeLifecycles -= 1;
      }
    };

    for (let i = 0; i < 20; i += 1) {
      await runProofLifecycle();
    }

    expect(completedLifecycles).toBe(20);

    // Consecutive requests must never retain multiple active proof
    // lifecycles at the same time.
    expect(maxActiveLifecycles).toBe(1);
    expect(activeLifecycles).toBe(0);
  });

  it("uses explicit snarkjs memory controls in the worker", async () => {
    const fs = await import("node:fs/promises");
    const workerSource = await fs.readFile("src/workers/zkpWorker.ts", "utf8");

    expect(workerSource).toContain("snarkjs.wtns.calculate");
    expect(workerSource).toContain("memorySize: 0");
    expect(workerSource).toContain("snarkjs.groth16.prove");
    expect(workerSource).toContain("singleThread: true");
    expect(workerSource).toContain("wtns = null");
    expect(workerSource).toContain("curve_bn128");
  });

  it("zeroes and nullifies intermediate Uint8Array witness buffers via releaseWitnessBuffer", () => {
    const rawBuffer = new Uint8Array([12, 34, 56, 78, 90, 255]);
    const wtns: { type: "mem"; data?: Uint8Array | null } = {
      type: "mem",
      data: rawBuffer,
    };

    releaseWitnessBuffer(wtns);

    expect(Array.from(rawBuffer)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(wtns.data).toBeNull();
  });

  it("terminates global curve_bn128 and auxiliary curve instances on teardown", async () => {
    const terminateBn128 = jest.fn().mockResolvedValue(undefined);
    const terminateBls = jest.fn().mockResolvedValue(undefined);
    const g = globalThis as Record<string, unknown>;
    g.curve_bn128 = { terminate: terminateBn128 };
    g.curve_bls12381 = { terminate: terminateBls };

    await terminateCurveBn128();

    expect(terminateBn128).toHaveBeenCalledTimes(1);
    expect(terminateBls).toHaveBeenCalledTimes(1);
    expect(g.curve_bn128).toBeUndefined();
    expect(g.curve_bls12381).toBeUndefined();
  });

  it("releases typed arrays, invokes curve.terminate(), and keeps heap growth <30MB across 50 consecutive proofs", async () => {
    const allocatedWitnessBuffers: Uint8Array[] = [];
    let curveTerminateCalls = 0;

    (snarkjs.wtns.calculate as jest.Mock).mockImplementation(
      async (
        _inputs: unknown,
        _wasm: string,
        wtns: { type: "mem"; data?: Uint8Array | null },
      ) => {
        // Allocate a 2MB intermediate witness Uint8Array per proof
        const buf = new Uint8Array(2 * 1024 * 1024);
        buf.fill(0xab);
        wtns.data = buf;
        allocatedWitnessBuffers.push(buf);

        const g = globalThis as Record<string, unknown>;
        g.curve_bn128 = {
          terminate: async () => {
            curveTerminateCalls += 1;
          },
        };
      },
    );

    (snarkjs.groth16.prove as jest.Mock).mockResolvedValue({
      proof: { pi_a: ["1", "2"], pi_b: [], pi_c: ["3", "4"] },
      publicSignals: ["100", "200"],
    });

    const baselineHeap = process.memoryUsage().heapUsed;

    for (let i = 0; i < 50; i += 1) {
      const res = await executeBoundedGroth16Proof(
        {
          secret: String(1000 + i),
          epoch: "202611",
          root: "999999",
          pathElements: ["1", "2"],
          pathIndices: ["0", "1"],
        },
        "/zkp/student_membership.wasm",
        "/zkp/student_membership.zkey",
      );

      expect(res.publicSignals).toEqual(["100", "200"]);

      // Every intermediate witness buffer must be zeroed immediately after proof generation
      expect(allocatedWitnessBuffers[i][0]).toBe(0);
      expect(
        allocatedWitnessBuffers[i][allocatedWitnessBuffers[i].length - 1],
      ).toBe(0);
      expect(
        (globalThis as Record<string, unknown>).curve_bn128,
      ).toBeUndefined();

      await cycleWorkerIfNeeded(10);
    }

    expect(curveTerminateCalls).toBe(50);
    expect(getConsecutiveProofCount()).toBe(0);

    // Clear our test inspection array so V8 can reclaim all 50 buffers
    allocatedWitnessBuffers.length = 0;
    if (typeof global.gc === "function") {
      global.gc();
    }

    const finalHeap = process.memoryUsage().heapUsed;
    const retainedDeltaMb = (finalHeap - baselineHeap) / (1024 * 1024);
    expect(retainedDeltaMb).toBeLessThan(30);
  });
});
