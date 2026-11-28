 feat/solana-escrow-priority-fee

 fix/zkp-worker-memory-boundary
 main
﻿import { describe, expect, it, vi } from "vitest";
import {
  attachZkpWorker,
  WASM_PAGE_BYTES,
  ZkpWorkerController,
  type ZkpWorkerRequestMessage,
  type ZkpWorkerResponseMessage,
} from "../../workers/zkpWorker";

describe("zkpWorker memory boundary & recovery", () => {
  it("clears active scratch and job state when a prover throws synchronously", async () => {
    const controller = new ZkpWorkerController(8);
    const internalState = controller as unknown as {
      activeScratchBuffer: WebAssembly.Memory | null;
      activeJobId: string | null;
    };

    const response = await controller.handleMessage({
      type: "prove",
      jobId: "job-sync-failure",
      requestedPages: 1,
      prover: ({ memory }) => {
        expect(internalState.activeScratchBuffer).toBe(memory);
        expect(internalState.activeJobId).toBe("job-sync-failure");
        throw new Error("synchronous prover failure");
      },
    });

    expect(response).toMatchObject({
      type: "error",
      jobId: "job-sync-failure",
      error: {
        code: "PROVER_FAILED",
        message: "synchronous prover failure",
      },
    });
    expect(internalState.activeScratchBuffer).toBeNull();
    expect(internalState.activeJobId).toBeNull();
  });

  it("catches WebAssembly.Memory.grow failures and emits structured error without crashing", async () => {
    const controller = new ZkpWorkerController(16);

    const response = await controller.handleMessage({
      type: "prove",
      jobId: "job-grow-fail",
      requestedPages: 4,
      maxPages: 16,
      prover: ({ memory }) => {
        expect(memory).toBeInstanceOf(WebAssembly.Memory);
        // Simulate a failed linear memory growth inside the prover
        return memory!.grow(999_999);
      },
    });

    expect(response.type).toBe("error");
    if (response.type === "error") {
      expect(response.jobId).toBe("job-grow-fail");
      expect(response.error.code).toBe("MEMORY_GROW_FAILED");
      expect(response.error.message.length).toBeGreaterThan(0);
    }
  });

  it("enforces page-cap limits and recovers cleanly on subsequent proof jobs", async () => {
    const posted: ZkpWorkerResponseMessage[] = [];
    const mockScope = {
      onmessage: null as
        ((ev: MessageEvent<ZkpWorkerRequestMessage>) => void) | null,
      postMessage: (msg: ZkpWorkerResponseMessage) => {
        posted.push(msg);
      },
    };

    attachZkpWorker(mockScope);

    // 1. Exceed page cap
    mockScope.onmessage?.({
      data: {
        type: "prove",
        jobId: "job-over-cap",
        requestedPages: 2048,
        maxPages: 64,
        witness: { circuitInput: "123" },
      },
    } as MessageEvent<ZkpWorkerRequestMessage>);

    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      type: "error",
      jobId: "job-over-cap",
      error: {
        code: "MEMORY_LIMIT_EXCEEDED",
      },
    });

    // 2. Subsequent proof job within bounds must succeed without stale state
    mockScope.onmessage?.({
      data: {
        type: "prove",
        jobId: "job-recovered",
        requestedPages: 2,
        maxPages: 16,
        witness: { circuitInput: "456" },
        prover: ({ memory }) => ({
          proof: "valid-zk-proof",
          bytes: memory?.buffer.byteLength ?? 0,
        }),
      },
    } as MessageEvent<ZkpWorkerRequestMessage>);

    await vi.waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]).toEqual({
      type: "result",
      jobId: "job-recovered",
      result: {
        proof: "valid-zk-proof",
        bytes: 2 * WASM_PAGE_BYTES,
      },
    });
  });

  it("catches linear-memory out-of-bounds exceptions and clears state for next job", async () => {
    const controller = new ZkpWorkerController(8);

    const oobResponse = await controller.handleMessage({
      type: "prove",
      jobId: "job-oob",
      requestedPages: 1,
      prover: ({ memory }) => {
        const view = new Uint8Array(memory!.buffer);
        // Accessing beyond linear memory slice throws RangeError / out-of-bounds
        return view.subarray(view.byteLength + 10);
      },
    });

    expect(oobResponse.type).toBe("error");
    if (oobResponse.type === "error") {
      expect(oobResponse.jobId).toBe("job-oob");
      expect(oobResponse.error.code).toBe("OUT_OF_BOUNDS");
    }

    const nextResponse = await controller.handleMessage({
      type: "prove",
      jobId: "job-after-oob",
      requestedPages: 1,
      prover: () => ({ ok: true }),
    });

    expect(nextResponse).toEqual({
      type: "result",
      jobId: "job-after-oob",
      result: { ok: true },
    });
  });

  it("rejects oversized witness payloads cleanly before allocation", async () => {
    const controller = new ZkpWorkerController(8);
    const hugeWitness = new Uint8Array(17 * 1024 * 1024);

    const res = await controller.handleMessage({
      type: "prove",
      jobId: "job-huge-witness",
      witness: hugeWitness,
    });

    expect(res.type).toBe("error");
    if (res.type === "error") {
      expect(res.jobId).toBe("job-huge-witness");
      expect(res.error.code).toBe("MEMORY_LIMIT_EXCEEDED");
    }
  });
});
 feat/solana-escrow-priority-fee

﻿import { ZkpWorkerQueueRunner, type ZkpWorkerOutboundMessage } from '@/workers/zkpWorker'; describe('ZkpWorkerQueueRunner progress ordering', () => { it('delivers strictly ordered per-job progress and completion messages when multiple proofs are queued', async () => { const emitted: ZkpWorkerOutboundMessage[] = []; const runner = new ZkpWorkerQueueRunner((msg) => { emitted.push(msg); }, { stepDelayMs: 5, defaultSteps: 3, nowFn: () => 1_700_000_000_000 }); await Promise.all([ runner.enqueue({ jobId: 'job-1', studentId: 'stu-a', stepDelayMs: 8, steps: 2 }), runner.enqueue({ jobId: 'job-2', studentId: 'stu-b', stepDelayMs: 2, steps: 2 }), runner.enqueue({ jobId: 'job-3', studentId: 'stu-c', stepDelayMs: 1, steps: 2 }) ]); const jobOrder = emitted.map((m) => m.jobId); expect(jobOrder.lastIndexOf('job-1')).toBeLessThan(jobOrder.indexOf('job-2')); expect(jobOrder.lastIndexOf('job-2')).toBeLessThan(jobOrder.indexOf('job-3')); for (const targetJobId of ['job-1', 'job-2', 'job-3']) { const jobMsgs = emitted.filter((m) => m.jobId === targetJobId); expect(jobMsgs.length).toBe(3); expect(jobMsgs.map((m) => m.seq)).toEqual([1, 2, 3]); expect(jobMsgs[jobMsgs.length - 1]?.type).toBe('complete'); expect(jobMsgs[jobMsgs.length - 1]?.progress).toBe(100); } }); });
 main
 main
