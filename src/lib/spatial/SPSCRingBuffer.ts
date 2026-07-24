/**
 * Lock-Free SPSC (Single Producer, Single Consumer) Ring Buffer
 *
 * Uses SharedArrayBuffer and Atomics for thread-safe communication
 * between the main thread and AudioWorklet thread without mutexes.
 *
 * Buffer Layout (SharedArrayBuffer):
 *   [0..3]   readIndex  (Uint32, monotonic counter, written by consumer)
 *   [4..7]   writeIndex (Uint32, monotonic counter, written by producer)
 *   [8..]    data       (Float32Array, audio sample buffer)
 *
 * Both indices are free-running counters. The actual buffer index is
 * computed as (counter & mask), where mask = capacity - 1 (power-of-2).
 *
 * Capacity must be a power of 2 for efficient masking.
 */

export class SPSCRingBuffer {
  private readonly sab: SharedArrayBuffer;
  private readonly capacity: number;
  private readonly mask: number;
  private readonly headerSize = 8; // bytes for readIndex + writeIndex

  // Typed array views (main thread side)
  private readonly readIndexView: Uint32Array;
  private readonly writeIndexView: Uint32Array;
  private readonly dataView: Float32Array;

  /**
   * Create an SPSC ring buffer backed by a SharedArrayBuffer.
   *
   * @param capacity  Number of float32 samples the buffer can hold (must be power of 2)
   * @param sab       Optional existing SharedArrayBuffer (for worklet side reconstruction)
   */
  constructor(capacity: number, sab?: SharedArrayBuffer) {
    if ((capacity & (capacity - 1)) !== 0) {
      throw new Error(
        `SPSCRingBuffer: capacity ${capacity} must be a power of 2`,
      );
    }

    this.capacity = capacity;
    this.mask = capacity - 1;

    if (sab) {
      // Reconstruct from existing SAB (worklet side)
      this.sab = sab;
    } else {
      // Allocate new SAB (main thread side)
      const byteSize = this.headerSize + capacity * 4;
      this.sab = new SharedArrayBuffer(byteSize);
    }

    this.readIndexView = new Uint32Array(this.sab, 0, 1);
    this.writeIndexView = new Uint32Array(this.sab, 4, 1);
    this.dataView = new Float32Array(this.sab, this.headerSize, capacity);
  }

  /** Get the underlying SharedArrayBuffer (send this to the worklet). */
  getSharedBuffer(): SharedArrayBuffer {
    return this.sab;
  }

  /** Get the capacity in samples. */
  getCapacity(): number {
    return this.capacity;
  }

  /**
   * Get available samples for reading (consumer side).
   * Uses atomic load for correct cross-thread visibility.
   */
  availableRead(): number {
    const writeIdx = Atomics.load(this.writeIndexView, 0);
    const readIdx = Atomics.load(this.readIndexView, 0);
    return writeIdx - readIdx;
  }

  /**
   * Get available space for writing (producer side).
   */
  availableWrite(): number {
    const writeIdx = Atomics.load(this.writeIndexView, 0);
    const readIdx = Atomics.load(this.readIndexView, 0);
    return this.capacity - (writeIdx - readIdx);
  }

  /**
   * Push audio samples into the ring buffer (producer — main thread).
   *
   * @param data  Float32Array of samples to push
   * @returns     Number of samples actually written (may be less if buffer is full)
   */
  push(data: Float32Array): number {
    const available = this.availableWrite();
    const toWrite = Math.min(data.length, available);
    if (toWrite === 0) return 0;

    const writeIdx = Atomics.load(this.writeIndexView, 0);

    for (let i = 0; i < toWrite; i++) {
      const idx = (writeIdx + i) & this.mask;
      this.dataView[idx] = data[i];
    }

    // Ensure all writes are visible before updating the write index
    Atomics.store(this.writeIndexView, 0, writeIdx + toWrite);

    return toWrite;
  }

  /**
   * Pop audio samples from the ring buffer (consumer — AudioWorklet).
   *
   * @param output  Float32Array to fill with samples
   * @returns       Number of samples actually read (may be less if buffer is empty)
   */
  pop(output: Float32Array): number {
    const available = this.availableRead();
    const toRead = Math.min(output.length, available);
    if (toRead === 0) {
      // Underrun: zero-fill output
      output.fill(0);
      return 0;
    }

    const readIdx = Atomics.load(this.readIndexView, 0);

    for (let i = 0; i < toRead; i++) {
      const idx = (readIdx + i) & this.mask;
      output[i] = this.dataView[idx];
    }

    // Zero-fill remaining if we didn't have enough data
    if (toRead < output.length) {
      output.fill(0, toRead);
    }

    // Ensure all reads are complete before updating the read index
    Atomics.store(this.readIndexView, 0, readIdx + toRead);

    return toRead;
  }

  /**
   * Peek at samples without consuming them (consumer side).
   * Useful for checking pre-buffer fill level.
   */
  peek(samples: number): Float32Array | null {
    const available = this.availableRead();
    if (available < samples) return null;

    const readIdx = Atomics.load(this.readIndexView, 0);
    const result = new Float32Array(samples);

    for (let i = 0; i < samples; i++) {
      const idx = (readIdx + i) & this.mask;
      result[i] = this.dataView[idx];
    }

    return result;
  }

  /**
   * Reset both indices to zero (must only be called when both threads are paused).
   */
  reset(): void {
    Atomics.store(this.readIndexView, 0, 0);
    Atomics.store(this.writeIndexView, 0, 0);
  }

  /**
   * Get the current fill level as a fraction [0..1].
   */
  fillLevel(): number {
    return this.availableRead() / this.capacity;
  }

  /**
   * Check if the buffer has at least `threshold` samples available.
   */
  hasMinimum(threshold: number): boolean {
    return this.availableRead() >= threshold;
  }
}
