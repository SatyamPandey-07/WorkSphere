/**
 * Message protocol and handler for the off-main-thread audio filter worker
 * (#3361). Kept free of worker globals so it can be unit-tested directly;
 * src/workers/audioFilter.worker.ts is the thin glue around it.
 *
 * Two ways to feed audio:
 *  - "process": channels are transferred in and back out (zero-copy hand-off,
 *    works everywhere). Used by the pool and on non-isolated pages.
 *  - "attachRing": the worker drains an input AudioRingBuffer and fills an
 *    output one (SharedArrayBuffer, needs a cross-origin isolated page).
 */

import { AudioFilterPipeline, type BiquadCoefficients } from "./audioFilterPipeline";
import { AudioRingBuffer } from "./audioRingBuffer";

export type AudioFilterWorkerRequest =
  | {
      type: "init";
      id: number;
      wasm: ArrayBuffer;
      coefficients: BiquadCoefficients[];
      outputGain?: number;
    }
  | { type: "setCoefficients"; id: number; coefficients: BiquadCoefficients[] }
  | { type: "process"; id: number; channels: Float32Array[] }
  | {
      type: "attachRing";
      id: number;
      input: SharedArrayBuffer;
      output: SharedArrayBuffer;
      /** Frames per processing step, e.g. 128 (one render quantum). */
      quantum: number;
    }
  | { type: "detachRing"; id: number }
  | { type: "stats"; id: number }
  | { type: "reset"; id: number };

export interface AudioFilterWorkerStats {
  processedFrames: number;
  /** Frames dropped because the output ring was full (consumer too slow). */
  droppedFrames: number;
  /** Slowest single processing step, in ms. */
  maxStepMs: number;
}

export type AudioFilterWorkerResponse =
  | {
      type: "ok";
      id: number;
      channels?: Float32Array[];
      elapsedMs?: number;
      stats?: AudioFilterWorkerStats;
      simd?: boolean;
    }
  | { type: "error"; id: number; error: string };

export interface AudioFilterWorkerHost {
  post(message: AudioFilterWorkerResponse, transfer?: Transferable[]): void;
  /** Override for tests; defaults to AudioFilterPipeline.fromBinary. */
  instantiate?: (wasm: ArrayBuffer) => Promise<AudioFilterPipeline>;
}

const IDLE_WAIT_MS = 2;

/** Wait for the ring's write counter to move without blocking message handling. */
async function waitForInput(ring: AudioRingBuffer, frames: number): Promise<void> {
  const header = new Int32Array(ring.buffer, 0, 4);
  const observed = Atomics.load(header, 1);
  if (ring.availableRead >= frames) return;

  const waitAsync = (Atomics as unknown as {
    waitAsync?: (a: Int32Array, i: number, v: number, t: number) => { async: boolean; value: Promise<string> | string };
  }).waitAsync;
  if (typeof waitAsync === "function") {
    const result = waitAsync(header, 1, observed, IDLE_WAIT_MS);
    if (result.async) await result.value;
    return;
  }
  // Older engines: yield to the event loop between short sleeps so
  // setCoefficients / detachRing messages still get through.
  await new Promise((resolve) => setTimeout(resolve, 1));
}

export function createAudioFilterWorkerHandler(host: AudioFilterWorkerHost) {
  const instantiate = host.instantiate ?? ((wasm: ArrayBuffer) => AudioFilterPipeline.fromBinary(wasm));
  let pipeline: AudioFilterPipeline | null = null;
  let ringSession = 0;
  const stats: AudioFilterWorkerStats = { processedFrames: 0, droppedFrames: 0, maxStepMs: 0 };

  const requirePipeline = (): AudioFilterPipeline => {
    if (!pipeline) throw new Error("Worker not initialized");
    return pipeline;
  };

  const record = (frames: number, elapsedMs: number) => {
    stats.processedFrames += frames;
    stats.maxStepMs = Math.max(stats.maxStepMs, elapsedMs);
  };

  async function runRing(session: number, input: AudioRingBuffer, output: AudioRingBuffer, quantum: number) {
    const scratch = Array.from({ length: input.channels }, () => new Float32Array(quantum));
    while (session === ringSession) {
      if (input.availableRead < quantum) {
        await waitForInput(input, quantum);
        continue;
      }
      input.read(scratch, quantum);
      const elapsed = requirePipeline().process(scratch);
      record(quantum, elapsed);
      const written = output.write(scratch, quantum);
      stats.droppedFrames += quantum - written;
    }
  }

  return async function handle(msg: AudioFilterWorkerRequest): Promise<void> {
    try {
      switch (msg.type) {
        case "init": {
          pipeline = await instantiate(msg.wasm);
          pipeline.setCoefficients(msg.coefficients);
          if (msg.outputGain !== undefined) pipeline.setOutputGain(msg.outputGain);
          host.post({ type: "ok", id: msg.id, simd: pipeline.simd });
          return;
        }
        case "setCoefficients":
          requirePipeline().setCoefficients(msg.coefficients);
          host.post({ type: "ok", id: msg.id });
          return;
        case "process": {
          const elapsedMs = requirePipeline().process(msg.channels);
          record(msg.channels[0]?.length ?? 0, elapsedMs);
          host.post(
            { type: "ok", id: msg.id, channels: msg.channels, elapsedMs },
            msg.channels.map((c) => c.buffer),
          );
          return;
        }
        case "attachRing": {
          requirePipeline();
          const input = AudioRingBuffer.attach(msg.input);
          const output = AudioRingBuffer.attach(msg.output);
          if (input.channels !== output.channels) {
            throw new RangeError("Input and output rings must have the same channel count");
          }
          if (!Number.isInteger(msg.quantum) || msg.quantum < 1 || msg.quantum > input.capacity) {
            throw new RangeError("quantum must be between 1 and the ring capacity");
          }
          const session = ++ringSession;
          host.post({ type: "ok", id: msg.id });
          void runRing(session, input, output, msg.quantum).catch((err) => {
            host.post({ type: "error", id: -1, error: err instanceof Error ? err.message : String(err) });
          });
          return;
        }
        case "detachRing":
          ringSession++;
          host.post({ type: "ok", id: msg.id });
          return;
        case "stats":
          host.post({ type: "ok", id: msg.id, stats: { ...stats } });
          return;
        case "reset":
          requirePipeline().reset();
          host.post({ type: "ok", id: msg.id });
          return;
      }
    } catch (err) {
      host.post({ type: "error", id: msg.id, error: err instanceof Error ? err.message : String(err) });
    }
  };
}
