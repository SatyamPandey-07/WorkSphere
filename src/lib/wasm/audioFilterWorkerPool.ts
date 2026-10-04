/**
 * Off-main-thread audio filtering with a small worker pool (#3361).
 *
 * Each worker owns its own WASM pipeline instance and a FIXED slice of
 * channels. Biquad state is per channel, so a channel must always be
 * filtered by the same worker; partitions never change after creation.
 * Channels are split in groups of 4 to keep the SIMD build's 4-lane vectors
 * full, so with the pipeline's 8-channel limit at most 2 workers are useful.
 *
 * Measured (scripts/bench-audio-filter-pool.mjs, 8 ch × 8 stages): every
 * round trip stays well under 1 ms, versus a 2.67 ms budget for a 128-frame
 * quantum at 48 kHz, and splitting 8 channels over 2 workers beats a
 * single worker at every block size (1.1–1.8×).
 */

import type { BiquadCoefficients } from "./audioFilterPipeline";
import type {
  AudioFilterWorkerRequest,
  AudioFilterWorkerResponse,
  AudioFilterWorkerStats,
} from "./audioFilterWorkerCore";

/** The subset of the DOM Worker API the pool needs (eases testing). */
export interface AudioFilterWorkerLike {
  postMessage(message: AudioFilterWorkerRequest, transfer?: Transferable[]): void;
  onmessage: ((event: { data: AudioFilterWorkerResponse }) => void) | null;
  onerror?: ((event: unknown) => void) | null;
  terminate(): void;
}

export interface AudioFilterWorkerPoolOptions {
  channels: number;
  /** Compiled audio-filter WASM (SIMD or scalar build). */
  wasm: ArrayBuffer;
  coefficients: BiquadCoefficients[];
  outputGain?: number;
  /** Upper bound on workers. Default 2 (all an 8-channel pipeline can use). */
  maxWorkers?: number;
  createWorker: () => AudioFilterWorkerLike;
}

/** Channels per partition: one full 128-bit SIMD vector of float32 lanes. */
export const CHANNELS_PER_GROUP = 4;

/**
 * Split `channels` into contiguous [start, end) ranges, one per worker, in
 * multiples of 4 so no worker runs a half-empty SIMD group.
 */
export function planChannelPartitions(channels: number, maxWorkers: number): Array<[number, number]> {
  if (!Number.isInteger(channels) || channels < 1) {
    throw new RangeError("channels must be a positive integer");
  }
  const groups = Math.ceil(channels / CHANNELS_PER_GROUP);
  const workers = Math.max(1, Math.min(Math.floor(maxWorkers), groups));
  const ranges: Array<[number, number]> = [];
  let group = 0;
  for (let w = 0; w < workers; w++) {
    const take = Math.ceil((groups - group) / (workers - w));
    const start = group * CHANNELS_PER_GROUP;
    group += take;
    ranges.push([start, Math.min(channels, group * CHANNELS_PER_GROUP)]);
  }
  return ranges;
}

/** Omit `id` from each member of the request union (plain Omit would collapse it). */
type RequestWithoutId = AudioFilterWorkerRequest extends infer R
  ? R extends AudioFilterWorkerRequest
    ? Omit<R, "id">
    : never
  : never;

interface Pending {
  resolve: (res: Extract<AudioFilterWorkerResponse, { type: "ok" }>) => void;
  reject: (err: Error) => void;
}

class WorkerChannel {
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(readonly worker: AudioFilterWorkerLike) {
    worker.onmessage = ({ data }) => {
      const waiter = this.pending.get(data.id);
      if (!waiter) return;
      this.pending.delete(data.id);
      if (data.type === "error") waiter.reject(new Error(data.error));
      else waiter.resolve(data);
    };
    worker.onerror = (event) => this.failAll(new Error(`Audio filter worker crashed: ${String(event)}`));
  }

  request(
    message: RequestWithoutId,
    transfer: Transferable[] = [],
  ): Promise<Extract<AudioFilterWorkerResponse, { type: "ok" }>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...message, id } as AudioFilterWorkerRequest, transfer);
    });
  }

  failAll(err: Error) {
    this.pending.forEach((p) => p.reject(err));
    this.pending.clear();
  }
}

export class AudioFilterWorkerPool {
  readonly channels: number;
  readonly partitions: ReadonlyArray<[number, number]>;
  private disposed = false;

  private constructor(
    private readonly workers: WorkerChannel[],
    partitions: Array<[number, number]>,
    channels: number,
    readonly simd: boolean,
  ) {
    this.partitions = partitions;
    this.channels = channels;
  }

  static async create(options: AudioFilterWorkerPoolOptions): Promise<AudioFilterWorkerPool> {
    const partitions = planChannelPartitions(options.channels, options.maxWorkers ?? 2);
    const workers = partitions.map(() => new WorkerChannel(options.createWorker()));
    try {
      const results = await Promise.all(
        workers.map((w) =>
          w.request({
            type: "init",
            // Each worker gets its own copy: an ArrayBuffer can only be transferred once.
            wasm: options.wasm.slice(0),
            coefficients: options.coefficients,
            outputGain: options.outputGain,
          }),
        ),
      );
      return new AudioFilterWorkerPool(workers, partitions, options.channels, results.every((r) => r.simd));
    } catch (err) {
      workers.forEach((w) => w.worker.terminate());
      throw err;
    }
  }

  get size(): number {
    return this.workers.length;
  }

  /**
   * Filter planar channels in place, off the calling thread. Each worker
   * gets its channels as transferred copies, so the caller's buffers stay
   * usable (an AudioBuffer's channel data cannot be detached).
   * Resolves with the slowest worker's processing time in ms.
   */
  async process(channels: Float32Array[]): Promise<number> {
    this.assertUsable();
    if (channels.length !== this.channels) {
      throw new RangeError(`Expected ${this.channels} channels, got ${channels.length}`);
    }
    const frames = channels[0].length;
    if (channels.some((c) => c.length !== frames)) {
      throw new RangeError("All channels must have the same length");
    }

    const results = await Promise.all(
      this.partitions.map(([start, end], i) => {
        const slice = channels.slice(start, end).map((c) => c.slice());
        return this.workers[i].request({ type: "process", channels: slice }, slice.map((c) => c.buffer));
      }),
    );

    let slowest = 0;
    results.forEach((res, i) => {
      const [start] = this.partitions[i];
      res.channels!.forEach((processed, j) => channels[start + j].set(processed));
      slowest = Math.max(slowest, res.elapsedMs ?? 0);
    });
    return slowest;
  }

  /** Replace the filter chain on every worker (resets filter state). */
  async setCoefficients(coefficients: BiquadCoefficients[]): Promise<void> {
    this.assertUsable();
    await Promise.all(this.workers.map((w) => w.request({ type: "setCoefficients", coefficients })));
  }

  async reset(): Promise<void> {
    this.assertUsable();
    await Promise.all(this.workers.map((w) => w.request({ type: "reset" })));
  }

  async stats(): Promise<AudioFilterWorkerStats[]> {
    this.assertUsable();
    const res = await Promise.all(this.workers.map((w) => w.request({ type: "stats" })));
    return res.map((r) => r.stats!);
  }

  /**
   * Real-time streaming without per-block messages: worker 0 drains `input`
   * and fills `output` (both AudioRingBuffer SharedArrayBuffers). Requires a
   * cross-origin isolated page and a single-partition pool.
   */
  async attachRing(input: SharedArrayBuffer, output: SharedArrayBuffer, quantum = 128): Promise<void> {
    this.assertUsable();
    if (this.workers.length !== 1) {
      throw new Error("Ring streaming needs a single-worker pool (maxWorkers: 1)");
    }
    await this.workers[0].request({ type: "attachRing", input, output, quantum });
  }

  async detachRing(): Promise<void> {
    this.assertUsable();
    await Promise.all(this.workers.map((w) => w.request({ type: "detachRing" })));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const w of this.workers) {
      w.failAll(new Error("Audio filter worker pool disposed"));
      w.worker.terminate();
    }
  }

  private assertUsable() {
    if (this.disposed) throw new Error("Audio filter worker pool disposed");
  }
}
