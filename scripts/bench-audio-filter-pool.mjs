#!/usr/bin/env node
/**
 * Benchmark: single-thread vs worker-pool throughput for the WASM SIMD audio
 * filter pipeline (#3361).
 *
 *   npm run bench:audio-filter
 *
 * Uses the committed public/audio-filter-simd.wasm and Node worker_threads.
 * Each worker owns its own WASM instance and a fixed slice of channels (filter
 * state is per channel, so a channel must always go to the same worker).
 * Buffers are transferred, not copied, between threads.
 */
import { Worker } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WASM = readFileSync(fileURLToPath(new URL("../public/audio-filter-simd.wasm", import.meta.url)));
const CHANNELS = 8;
const STAGES = 8;
const SIZES = [128, 256, 512, 1024, 2048, 4096];
const ITERATIONS = 400;

// Normalised lowpass-ish biquad; the exact response doesn't matter for timing.
const COEFFS = [0.2, 0.4, 0.2, -0.5, 0.3];

const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
WebAssembly.instantiate(workerData.wasm).then(({ instance }) => {
  const x = instance.exports;
  for (let s = 0; s < ${STAGES}; s++) x.setStage(s, ...workerData.coeffs);
  x.setStageCount(${STAGES});
  const maxFrames = x.getMaxFrames();
  parentPort.on("message", (channels) => {
    const heap = new Float32Array(x.memory.buffer, x.getBufferPtr(), channels.length * maxFrames);
    channels.forEach((ch, c) => heap.set(ch, c * maxFrames));
    x.process(channels.length, channels[0].length);
    channels.forEach((ch, c) => ch.set(heap.subarray(c * maxFrames, c * maxFrames + ch.length)));
    parentPort.postMessage(channels, channels.map((c) => c.buffer));
  });
  parentPort.postMessage("ready");
});`;

function startWorker() {
  const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { wasm: WASM, coeffs: COEFFS } });
  return new Promise((resolve) => worker.once("message", () => resolve(worker)));
}

function roundTrip(worker, channels) {
  return new Promise((resolve) => {
    worker.once("message", resolve);
    worker.postMessage(channels, channels.map((c) => c.buffer));
  });
}

async function inlineRunner() {
  const { instance } = await WebAssembly.instantiate(WASM);
  const x = instance.exports;
  for (let s = 0; s < STAGES; s++) x.setStage(s, ...COEFFS);
  x.setStageCount(STAGES);
  const maxFrames = x.getMaxFrames();
  return async (frames) => {
    const heap = new Float32Array(x.memory.buffer, x.getBufferPtr(), CHANNELS * maxFrames);
    for (let c = 0; c < CHANNELS; c++) heap.fill(0.1, c * maxFrames, c * maxFrames + frames);
    x.process(CHANNELS, frames);
  };
}

const makeChannels = (count, frames) =>
  Array.from({ length: count }, () => new Float32Array(frames).fill(0.1));

async function measure(run) {
  for (let i = 0; i < 50; i++) await run();
  const times = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const t = performance.now();
    await run();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return { median: times[times.length >> 1], p99: times[Math.floor(times.length * 0.99)] };
}

const us = (ms) => `${(ms * 1000).toFixed(1).padStart(7)} µs`;

const inline = await inlineRunner();
const single = await startWorker();
const pool = [await startWorker(), await startWorker()];

console.log(`\nWASM SIMD audio filter: ${CHANNELS} channels, ${STAGES} biquad stages, median of ${ITERATIONS}\n`);
console.log("frames | inline (main thread) | 1 worker             | 2 workers (4+4 ch)   | pool vs 1 worker");
console.log("-------|----------------------|----------------------|----------------------|-----------------");
for (const frames of SIZES) {
  const a = await measure(() => inline(frames));
  const b = await measure(() => roundTrip(single, makeChannels(CHANNELS, frames)));
  const c = await measure(() =>
    Promise.all([
      roundTrip(pool[0], makeChannels(4, frames)),
      roundTrip(pool[1], makeChannels(4, frames)),
    ]),
  );
  const speedup = b.median / c.median;
  console.log(
    `${String(frames).padStart(6)} | ${us(a.median)} p99 ${us(a.p99).trim().padStart(9)} | ` +
      `${us(b.median)} p99 ${us(b.p99).trim().padStart(9)} | ${us(c.median)} p99 ${us(c.p99).trim().padStart(9)} | ` +
      `${speedup.toFixed(2)}× ${speedup > 1 ? "faster" : "slower"}`,
  );
}

await Promise.all([single, ...pool].map((w) => w.terminate()));

// ─── SharedArrayBuffer ring (src/lib/wasm/audioRingBuffer.ts layout) ────────
// Header Int32[4] = [read, write, channels, capacity], then planar Float32 data.
const RING_WORKER = `
const { workerData } = require("node:worker_threads");
const { input, output, quantum } = workerData;
const hin = new Int32Array(input, 0, 4), hout = new Int32Array(output, 0, 4);
const ch = hin[2], cap = hin[3], mask = cap - 1;
const din = new Float32Array(input, 16, ch * cap), dout = new Float32Array(output, 16, ch * cap);
WebAssembly.instantiate(workerData.wasm).then(({ instance }) => {
  const x = instance.exports;
  for (let s = 0; s < ${STAGES}; s++) x.setStage(s, ...workerData.coeffs);
  x.setStageCount(${STAGES});
  const max = x.getMaxFrames();
  for (;;) {
    const w = Atomics.load(hin, 1), r = Atomics.load(hin, 0);
    if (((w - r) | 0) < quantum) { Atomics.wait(hin, 1, w, 100); continue; }
    const heap = new Float32Array(x.memory.buffer, x.getBufferPtr(), ch * max);
    for (let c = 0; c < ch; c++) for (let i = 0; i < quantum; i++) heap[c * max + i] = din[c * cap + ((r + i) & mask)];
    Atomics.store(hin, 0, (r + quantum) | 0);
    x.process(ch, quantum);
    const ow = Atomics.load(hout, 1);
    for (let c = 0; c < ch; c++) for (let i = 0; i < quantum; i++) dout[c * cap + ((ow + i) & mask)] = heap[c * max + i];
    Atomics.store(hout, 1, (ow + quantum) | 0);
    Atomics.notify(hout, 1);
  }
});`;

function ring(channels, capacity) {
  const sab = new SharedArrayBuffer(16 + channels * capacity * 4);
  const h = new Int32Array(sab, 0, 4);
  h[2] = channels;
  h[3] = capacity;
  return sab;
}

{
  const quantum = 128;
  const input = ring(CHANNELS, 1024);
  const output = ring(CHANNELS, 1024);
  const hin = new Int32Array(input, 0, 4);
  const hout = new Int32Array(output, 0, 4);
  const worker = new Worker(RING_WORKER, {
    eval: true,
    workerData: { wasm: WASM, coeffs: COEFFS, input, output, quantum },
  });
  await new Promise((r) => setTimeout(r, 200));

  const din = new Float32Array(input, 16);
  const step = () => {
    const w = Atomics.load(hin, 1);
    for (let c = 0; c < CHANNELS; c++) din.fill(0.1, c * 1024 + (w & 1023), c * 1024 + (w & 1023) + quantum);
    const target = (Atomics.load(hout, 1) + quantum) | 0;
    Atomics.store(hin, 1, (w + quantum) | 0);
    Atomics.notify(hin, 1);
    while (Atomics.load(hout, 1) !== target) Atomics.wait(hout, 1, Atomics.load(hout, 1), 50);
    Atomics.store(hout, 0, target); // consume
  };
  const r = await measure(async () => step());
  console.log(
    `\nSharedArrayBuffer ring, 1 worker, ${quantum} frames: ${us(r.median)} median, ${us(r.p99).trim()} p99 round trip`,
  );
  await worker.terminate();
}
