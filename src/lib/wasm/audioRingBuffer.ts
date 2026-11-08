/**
 * Lock-free single-producer / single-consumer ring buffer for planar
 * multi-channel float32 audio over a SharedArrayBuffer (#3361).
 *
 * One thread writes (e.g. an AudioWorklet), one thread reads (e.g. the WASM
 * filter worker). Samples are copied straight into shared memory, so no
 * postMessage or structured clone happens per audio block.
 *
 * Memory layout (the contract a plain-JS AudioWorklet must follow too):
 *
 *   bytes 0..15   Int32[4]  header: [0] read position, [1] write position,
 *                                  [2] channel count, [3] capacity (frames)
 *   bytes 16..    Float32[channels × capacity], channel c at c × capacity
 *
 * Positions are monotonically increasing Int32 counters. Capacity must be a
 * power of two so `position & (capacity - 1)` stays correct when the
 * counters wrap past 2^31 (~12 h of 48 kHz audio).
 */

const HEADER_INTS = 4;
const HEADER_BYTES = HEADER_INTS * Int32Array.BYTES_PER_ELEMENT;
const READ = 0;
const WRITE = 1;
const CHANNELS = 2;
const CAPACITY = 3;

export function isSharedMemoryAvailable(): boolean {
  return (
    typeof SharedArrayBuffer === "function" &&
    typeof Atomics === "object" &&
    // Browsers expose SharedArrayBuffer only on cross-origin isolated pages.
    (typeof crossOriginIsolated === "undefined" || crossOriginIsolated === true)
  );
}

function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

export class AudioRingBuffer {
  readonly channels: number;
  readonly capacity: number;
  readonly buffer: SharedArrayBuffer;
  private readonly header: Int32Array;
  private readonly data: Float32Array;
  private readonly mask: number;

  private constructor(buffer: SharedArrayBuffer) {
    this.buffer = buffer;
    this.header = new Int32Array(buffer, 0, HEADER_INTS);
    this.channels = this.header[CHANNELS];
    this.capacity = this.header[CAPACITY];
    if (this.channels < 1 || !isPowerOfTwo(this.capacity)) {
      throw new RangeError("Invalid ring buffer header");
    }
    this.mask = this.capacity - 1;
    this.data = new Float32Array(buffer, HEADER_BYTES, this.channels * this.capacity);
  }

  /** Allocate a ring holding `capacityFrames` frames (power of two) per channel. */
  static create(channels: number, capacityFrames: number): AudioRingBuffer {
    if (!Number.isInteger(channels) || channels < 1) {
      throw new RangeError("channels must be a positive integer");
    }
    if (!isPowerOfTwo(capacityFrames)) {
      throw new RangeError("capacityFrames must be a power of two");
    }
    const sab = new SharedArrayBuffer(
      HEADER_BYTES + channels * capacityFrames * Float32Array.BYTES_PER_ELEMENT,
    );
    const header = new Int32Array(sab, 0, HEADER_INTS);
    header[CHANNELS] = channels;
    header[CAPACITY] = capacityFrames;
    return new AudioRingBuffer(sab);
  }

  /** Attach to a ring created in another thread (pass `ring.buffer` across). */
  static attach(buffer: SharedArrayBuffer): AudioRingBuffer {
    return new AudioRingBuffer(buffer);
  }

  /** Frames ready to read. */
  get availableRead(): number {
    return (Atomics.load(this.header, WRITE) - Atomics.load(this.header, READ)) | 0;
  }

  /** Frames of free space. */
  get availableWrite(): number {
    return this.capacity - this.availableRead;
  }

  /**
   * Producer side: copy as many frames as fit. Returns frames written
   * (less than requested when the consumer has fallen behind).
   */
  write(channels: ArrayLike<Float32Array>, frames = channels[0]?.length ?? 0): number {
    if (channels.length !== this.channels) {
      throw new RangeError(`Expected ${this.channels} channels, got ${channels.length}`);
    }
    const writePos = Atomics.load(this.header, WRITE);
    const count = Math.min(frames, this.availableWrite);
    if (count <= 0) return 0;

    const start = writePos & this.mask;
    const firstPart = Math.min(count, this.capacity - start);
    for (let c = 0; c < this.channels; c++) {
      const base = c * this.capacity;
      const src = channels[c];
      this.data.set(src.subarray(0, firstPart), base + start);
      if (count > firstPart) this.data.set(src.subarray(firstPart, count), base);
    }

    // Publish after the samples are in place (Atomics give release semantics).
    Atomics.store(this.header, WRITE, (writePos + count) | 0);
    Atomics.notify(this.header, WRITE);
    return count;
  }

  /** Consumer side: copy up to `out[0].length` frames. Returns frames read. */
  read(out: ArrayLike<Float32Array>, frames = out[0]?.length ?? 0): number {
    if (out.length !== this.channels) {
      throw new RangeError(`Expected ${this.channels} channels, got ${out.length}`);
    }
    const readPos = Atomics.load(this.header, READ);
    const count = Math.min(frames, this.availableRead);
    if (count <= 0) return 0;

    const start = readPos & this.mask;
    const firstPart = Math.min(count, this.capacity - start);
    for (let c = 0; c < this.channels; c++) {
      const base = c * this.capacity;
      const dst = out[c];
      dst.set(this.data.subarray(base + start, base + start + firstPart), 0);
      if (count > firstPart) {
        dst.set(this.data.subarray(base, base + count - firstPart), firstPart);
      }
    }

    Atomics.store(this.header, READ, (readPos + count) | 0);
    Atomics.notify(this.header, READ);
    return count;
  }

  /**
   * Block the calling thread until at least `frames` are readable or the
   * timeout passes. Only for worker threads: browsers forbid Atomics.wait
   * on the main thread and in AudioWorklets.
   */
  waitForData(frames: number, timeoutMs: number): boolean {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (this.availableRead >= frames) return true;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      const observed = Atomics.load(this.header, WRITE);
      if (this.availableRead >= frames) return true;
      Atomics.wait(this.header, WRITE, observed, remaining);
    }
  }
}
