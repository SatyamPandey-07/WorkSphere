/**
 * @jest-environment node
 *
 * Off-main-thread audio filtering (#3361): SharedArrayBuffer ring buffer,
 * worker message handler, and the channel-partitioned worker pool.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { Worker } from "worker_threads";
import {
  AudioFilterPipeline,
  designBiquad,
  type BiquadStageConfig,
} from "@/lib/wasm/audioFilterPipeline";
import { AudioRingBuffer } from "@/lib/wasm/audioRingBuffer";
import {
  createAudioFilterWorkerHandler,
  type AudioFilterWorkerRequest,
  type AudioFilterWorkerResponse,
} from "@/lib/wasm/audioFilterWorkerCore";
import {
  AudioFilterWorkerPool,
  planChannelPartitions,
  type AudioFilterWorkerLike,
} from "@/lib/wasm/audioFilterWorkerPool";

const SAMPLE_RATE = 48000;
const wasmBytes = readFileSync(join(process.cwd(), "public/audio-filter-simd.wasm"));
const wasm = () => wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength);

const CHAIN: BiquadStageConfig[] = [
  { type: "highpass", frequency: 80 },
  { type: "peaking", frequency: 1000, q: 1.2, gainDb: 4 },
  { type: "lowpass", frequency: 8000 },
];
const coefficients = CHAIN.map((s) => designBiquad(s, SAMPLE_RATE));

function noise(frames: number, seed: number): Float32Array {
  let s = seed >>> 0;
  return Float32Array.from({ length: frames }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  });
}

const signal = (channels: number, frames: number, seed = 1) =>
  Array.from({ length: channels }, (_, c) => noise(frames, seed * 100 + c));

async function referencePipeline() {
  const p = await AudioFilterPipeline.fromBinary(wasm());
  p.setCoefficients(coefficients);
  return p;
}

const until = async (cond: () => boolean, timeoutMs = 3000) => {
  const end = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 2));
  }
};

// ─── Ring buffer ──────────────────────────────────────────────────────────────

describe("AudioRingBuffer", () => {
  it("validates its shape", () => {
    expect(() => AudioRingBuffer.create(0, 8)).toThrow(RangeError);
    expect(() => AudioRingBuffer.create(2, 100)).toThrow(/power of two/);
  });

  it("round-trips planar audio across the wrap-around point", () => {
    const ring = AudioRingBuffer.create(2, 8);
    const out = [new Float32Array(6), new Float32Array(6)];
    for (let round = 0; round < 3; round++) {
      const input = signal(2, 6, round + 1);
      expect(ring.write(input)).toBe(6);
      expect(ring.read(out)).toBe(6);
      expect(out).toEqual(input);
    }
  });

  it("writes only what fits and reports availability", () => {
    const ring = AudioRingBuffer.create(1, 4);
    expect(ring.write([new Float32Array([1, 2, 3])])).toBe(3);
    expect(ring.availableRead).toBe(3);
    expect(ring.write([new Float32Array([4, 5, 6])])).toBe(1);
    expect(ring.availableWrite).toBe(0);
    const out = [new Float32Array(4)];
    expect(ring.read(out)).toBe(4);
    expect(Array.from(out[0])).toEqual([1, 2, 3, 4]);
  });

  it("stays correct when the position counters wrap past 2^31", () => {
    const ring = AudioRingBuffer.create(1, 8);
    const header = new Int32Array(ring.buffer, 0, 4);
    header[0] = header[1] = 2 ** 31 - 3; // just below Int32 max
    const out = [new Float32Array(6)];
    const input = [Float32Array.from([1, 2, 3, 4, 5, 6])];
    expect(ring.write(input)).toBe(6);
    expect(header[1]).toBeLessThan(0); // wrapped
    expect(ring.availableRead).toBe(6);
    expect(ring.read(out)).toBe(6);
    expect(out).toEqual(input);
  });

  it("is readable from another thread using only the documented layout", async () => {
    const ring = AudioRingBuffer.create(2, 16);
    // Plain-JS consumer, as an AudioWorklet would be: no imports, just the layout.
    const worker = new Worker(
      `const { parentPort, workerData } = require("worker_threads");
       const h = new Int32Array(workerData, 0, 4), ch = h[2], cap = h[3];
       const d = new Float32Array(workerData, 16, ch * cap);
       while (((Atomics.load(h, 1) - Atomics.load(h, 0)) | 0) < 10) Atomics.wait(h, 1, Atomics.load(h, 1), 50);
       const r = Atomics.load(h, 0), sums = [];
       for (let c = 0; c < ch; c++) { let s = 0; for (let i = 0; i < 10; i++) s += d[c * cap + ((r + i) & (cap - 1))]; sums.push(s); }
       Atomics.store(h, 0, (r + 10) | 0);
       parentPort.postMessage(sums);`,
      { eval: true, workerData: ring.buffer },
    );
    const input = signal(2, 10, 7);
    const result = new Promise<number[]>((resolve) => worker.once("message", resolve));
    ring.write(input);
    const sums = await result;
    await worker.terminate();

    input.forEach((ch, c) => expect(sums[c]).toBeCloseTo(ch.reduce((a, b) => a + b, 0), 4));
    expect(ring.availableRead).toBe(0); // the other thread consumed it
  });

  it("waitForData times out without data and returns once data arrives", () => {
    const ring = AudioRingBuffer.create(1, 8);
    expect(ring.waitForData(4, 5)).toBe(false);
    ring.write([new Float32Array(4)]);
    expect(ring.waitForData(4, 5)).toBe(true);
  });
});

// ─── Worker message handler ───────────────────────────────────────────────────

function handlerHarness() {
  const responses: Array<{ msg: AudioFilterWorkerResponse; transfer?: Transferable[] }> = [];
  const handle = createAudioFilterWorkerHandler({ post: (msg, transfer) => responses.push({ msg, transfer }) });
  const last = () => responses[responses.length - 1].msg;
  return { handle, responses, last };
}

describe("audio filter worker handler", () => {
  it("filters transferred channels exactly like the pipeline and transfers them back", async () => {
    const { handle, responses, last } = handlerHarness();
    await handle({ type: "init", id: 1, wasm: wasm(), coefficients });
    expect(last()).toEqual({ type: "ok", id: 1, simd: true });

    const input = signal(3, 256);
    const expected = input.map((c) => c.slice());
    (await referencePipeline()).process(expected);

    await handle({ type: "process", id: 2, channels: input.map((c) => c.slice()) });
    const res = last();
    expect(res.type).toBe("ok");
    if (res.type !== "ok") return;
    expect(res.channels).toEqual(expected);
    expect(responses[1].transfer).toHaveLength(3);
  });

  it("reports errors instead of throwing", async () => {
    const { handle, last } = handlerHarness();
    await handle({ type: "process", id: 1, channels: [new Float32Array(4)] });
    expect(last()).toEqual({ type: "error", id: 1, error: "Worker not initialized" });

    await handle({ type: "init", id: 2, wasm: wasm(), coefficients });
    const a = AudioRingBuffer.create(2, 256);
    const b = AudioRingBuffer.create(1, 256);
    await handle({ type: "attachRing", id: 3, input: a.buffer, output: b.buffer, quantum: 128 });
    expect(last()).toMatchObject({ type: "error", id: 3 });
  });

  it("streams through SharedArrayBuffer rings, then stops when detached", async () => {
    const { handle, last } = handlerHarness();
    await handle({ type: "init", id: 1, wasm: wasm(), coefficients });
    const input = AudioRingBuffer.create(2, 1024);
    const output = AudioRingBuffer.create(2, 1024);
    await handle({ type: "attachRing", id: 2, input: input.buffer, output: output.buffer, quantum: 128 });

    const audio = signal(2, 512, 3);
    const expected = audio.map((c) => c.slice());
    (await referencePipeline()).process(expected);

    for (let off = 0; off < 512; off += 128) input.write(audio.map((c) => c.subarray(off, off + 128)));
    await until(() => output.availableRead === 512);

    const out = [new Float32Array(512), new Float32Array(512)];
    output.read(out);
    out.forEach((ch, c) => {
      for (let i = 0; i < 512; i++) expect(ch[i]).toBeCloseTo(expected[c][i], 6);
    });

    await handle({ type: "detachRing", id: 3 });
    input.write(signal(2, 128, 9));
    await new Promise((r) => setTimeout(r, 30));
    expect(output.availableRead).toBe(0);

    await handle({ type: "stats", id: 4 });
    expect(last()).toMatchObject({ type: "ok", stats: { processedFrames: 512, droppedFrames: 0 } });
  });

  it("counts frames dropped when the consumer falls behind", async () => {
    const { handle, last } = handlerHarness();
    await handle({ type: "init", id: 1, wasm: wasm(), coefficients });
    const input = AudioRingBuffer.create(1, 1024);
    const output = AudioRingBuffer.create(1, 128); // room for one quantum only
    await handle({ type: "attachRing", id: 2, input: input.buffer, output: output.buffer, quantum: 128 });
    input.write([new Float32Array(384)]);
    await until(() => input.availableRead === 0);
    await handle({ type: "detachRing", id: 3 });
    await handle({ type: "stats", id: 4 });
    expect(last()).toMatchObject({ stats: { processedFrames: 384, droppedFrames: 256 } });
  });
});

// ─── Worker pool ──────────────────────────────────────────────────────────────

/** In-process stand-in for a Worker with real structured-clone transfer semantics. */
class FakeWorker implements AudioFilterWorkerLike {
  onmessage: ((event: { data: AudioFilterWorkerResponse }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminated = false;
  private handle = createAudioFilterWorkerHandler({
    post: (msg, transfer = []) => {
      const data = structuredClone(msg, { transfer });
      setImmediate(() => !this.terminated && this.onmessage?.({ data }));
    },
  });

  constructor(private readonly failOn?: AudioFilterWorkerRequest["type"]) {}

  postMessage(message: AudioFilterWorkerRequest, transfer: Transferable[] = []) {
    const data = structuredClone(message, { transfer });
    setImmediate(() => {
      if (this.terminated) return;
      if (data.type === this.failOn) {
        this.onmessage?.({ data: { type: "error", id: data.id, error: "boom" } });
        return;
      }
      void this.handle(data);
    });
  }

  terminate() {
    this.terminated = true;
  }
}

describe("planChannelPartitions", () => {
  it.each([
    [1, 2, [[0, 1]]],
    [4, 2, [[0, 4]]],
    [5, 2, [[0, 4], [4, 5]]],
    [6, 2, [[0, 4], [4, 6]]],
    [8, 2, [[0, 4], [4, 8]]],
    [8, 1, [[0, 8]]],
    [8, 8, [[0, 4], [4, 8]]], // never more workers than 4-channel SIMD groups
  ])("%i channels, max %i workers", (channels, maxWorkers, expected) => {
    expect(planChannelPartitions(channels, maxWorkers)).toEqual(expected);
  });
});

describe("AudioFilterWorkerPool", () => {
  const pools: AudioFilterWorkerPool[] = [];
  afterEach(() => pools.splice(0).forEach((p) => p.dispose()));

  async function makePool(channels: number, extra: Partial<Parameters<typeof AudioFilterWorkerPool.create>[0]> = {}) {
    const created: FakeWorker[] = [];
    const pool = await AudioFilterWorkerPool.create({
      channels,
      wasm: wasm(),
      coefficients,
      createWorker: () => {
        const w = new FakeWorker();
        created.push(w);
        return w;
      },
      ...extra,
    });
    pools.push(pool);
    return { pool, created };
  }

  it.each([8, 6, 3])(
    "matches single-threaded output for %i channels across consecutive blocks",
    async (channels) => {
      const { pool } = await makePool(channels);
      const reference = await referencePipeline();
      for (let block = 0; block < 4; block++) {
        const input = signal(channels, 128, block + 1);
        const expected = input.map((c) => c.slice());
        reference.process(expected);
        await pool.process(input);
        expect(input).toEqual(expected); // filter state stayed with the right worker
      }
    },
  );

  it("splits 8 channels across 2 workers and leaves caller buffers usable", async () => {
    const { pool, created } = await makePool(8);
    expect(pool.size).toBe(2);
    expect(created).toHaveLength(2);
    expect(pool.simd).toBe(true);

    const input = signal(8, 256);
    await pool.process(input);
    expect(input.every((c) => c.length === 256 && c.buffer.byteLength > 0)).toBe(true);
  });

  it("propagates new coefficients and resets to every worker", async () => {
    const { pool } = await makePool(8);
    await pool.setCoefficients([designBiquad({ type: "lowpass", frequency: 500 }, SAMPLE_RATE)]);
    await pool.process(signal(8, 512));
    await pool.reset();

    const reference = await AudioFilterPipeline.fromBinary(wasm());
    reference.setCoefficients([designBiquad({ type: "lowpass", frequency: 500 }, SAMPLE_RATE)]);
    const input = signal(8, 128, 42);
    const expected = input.map((c) => c.slice());
    reference.process(expected);
    await pool.process(input);
    expect(input).toEqual(expected);

    const stats = await pool.stats();
    expect(stats.map((s) => s.processedFrames)).toEqual([640, 640]);
  });

  it("validates input", async () => {
    const { pool } = await makePool(4);
    await expect(pool.process(signal(3, 128))).rejects.toThrow(/Expected 4 channels/);
    await expect(
      pool.process([new Float32Array(8), new Float32Array(8), new Float32Array(8), new Float32Array(4)]),
    ).rejects.toThrow(/same length/);
  });

  it("supports ring streaming only on a single-worker pool", async () => {
    const { pool } = await makePool(8);
    const ring = AudioRingBuffer.create(8, 256);
    await expect(pool.attachRing(ring.buffer, ring.buffer)).rejects.toThrow(/single-worker/);

    const { pool: single } = await makePool(8, { maxWorkers: 1 });
    const input = AudioRingBuffer.create(8, 1024);
    const output = AudioRingBuffer.create(8, 1024);
    await single.attachRing(input.buffer, output.buffer, 128);
    input.write(signal(8, 128));
    await until(() => output.availableRead === 128);
    await single.detachRing();
  });

  it("terminates its workers if initialization fails", async () => {
    const created: FakeWorker[] = [];
    await expect(
      AudioFilterWorkerPool.create({
        channels: 8,
        wasm: wasm(),
        coefficients,
        createWorker: () => {
          const w = new FakeWorker(created.length === 1 ? "init" : undefined);
          created.push(w);
          return w;
        },
      }),
    ).rejects.toThrow("boom");
    expect(created.every((w) => w.terminated)).toBe(true);
  });

  it("rejects in-flight work and further calls after dispose", async () => {
    const { pool, created } = await makePool(8);
    const inflight = pool.process(signal(8, 128));
    pool.dispose();
    await expect(inflight).rejects.toThrow(/disposed/);
    await expect(pool.process(signal(8, 128))).rejects.toThrow(/disposed/);
    expect(created.every((w) => w.terminated)).toBe(true);
  });
});
