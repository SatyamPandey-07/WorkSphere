/**
 * WebRTC DataChannel Flow-Control & CRDT Backpressure Chunker
 *
 * Implements reliable application-level backpressure, FIFO outgoing queuing,
 * and chunked transmission over WebRTC DataChannels using the existing 16-byte
 * CRDT binary framing protocol (docs/crdt/CRDT_DATACHANNEL_FRAMING.md).
 *
 * Requirements:
 * - HIGH_WATER_MARK = 1 MiB (1,048,576 bytes)
 * - LOW_WATER_MARK = 64 KiB (65,536 bytes)
 * - channel.bufferedAmountLowThreshold = LOW_WATER_MARK
 * - Strict FIFO message & frame ordering without drop or priority eviction
 * - Automatic transmission resumption on `bufferedamountlow`
 * - Safe handling of WebRTC OperationError on buffer saturation
 * - Reusable across multiple peers with independent backpressure state
 */

import {
  CRDT_MAX_CHUNK_PAYLOAD_SIZE,
  CrdtFrameMessageType,
  encodeCrdtFrames,
} from "@/lib/crdt/dataChannelFraming";

export const HIGH_WATER_MARK = 1024 * 1024; // 1 MiB (1,048,576 bytes)
export const LOW_WATER_MARK = 64 * 1024; // 64 KiB (65,536 bytes)
export const DEFAULT_MAX_QUEUE_BYTES = 16 * 1024 * 1024; // 16 MiB
export const DEFAULT_MAX_QUEUE_FRAMES = 10_000;

export class QueueOverflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueueOverflowError";
    Object.setPrototypeOf(this, QueueOverflowError.prototype);
  }
}

export interface DataChannelLike {
  readyState: RTCDataChannelState | string;
  bufferedAmount?: number;
  bufferedAmountLowThreshold?: number;
  binaryType?: string;
  send(data: string | ArrayBuffer | ArrayBufferView): void;
  addEventListener?(type: string, listener: (...args: any[]) => void): void;
  removeEventListener?(type: string, listener: (...args: any[]) => void): void;
  dispatchEvent?(event: any): boolean;
  onopen?: ((ev: any) => void) | null;
  onclose?: ((ev: any) => void) | null;
  onbufferedamountlow?: ((ev: any) => void) | null;
  onerror?: ((ev: any) => void) | null;
}

export interface DataChannelChunkerOptions {
  highWaterMark?: number;
  lowWaterMark?: number;
  maxQueueBytes?: number;
  maxQueueFrames?: number;
  overflowPolicy?: "throw" | "drop";
  onError?: (error: Error) => void;
}

export interface EnqueueOptions {
  messageId?: number;
  messageType?: CrdtFrameMessageType;
  compressed?: boolean;
  maxChunkPayloadSize?: number;
}

export interface DataChannelChunkerMetrics {
  queuedFrames: number;
  queuedBytes: number;
  isBackpressured: boolean;
  totalMessagesEnqueued: number;
  totalFramesSent: number;
  totalBytesSent: number;
}

export class DataChannelChunker {
  private readonly channel: DataChannelLike;
  private readonly highWaterMark: number;
  private readonly lowWaterMark: number;
  private readonly maxQueueBytes: number;
  private readonly maxQueueFrames: number;
  private readonly overflowPolicy: "throw" | "drop";
  private readonly onError?: (error: Error) => void;

  private queue: Uint8Array[] = [];
  private _queuedBytes = 0;
  private _isBackpressured = false;
  private _isDraining = false;
  private _disposed = false;
  private nextMessageId = 1;

  private totalMessagesEnqueued = 0;
  private totalFramesSent = 0;
  private totalBytesSent = 0;

  constructor(
    channel: RTCDataChannel | DataChannelLike,
    options: DataChannelChunkerOptions = {},
  ) {
    this.channel = channel;
    this.highWaterMark = options.highWaterMark ?? HIGH_WATER_MARK;
    this.lowWaterMark = options.lowWaterMark ?? LOW_WATER_MARK;
    this.maxQueueBytes = options.maxQueueBytes ?? DEFAULT_MAX_QUEUE_BYTES;
    this.maxQueueFrames = options.maxQueueFrames ?? DEFAULT_MAX_QUEUE_FRAMES;
    this.overflowPolicy = options.overflowPolicy ?? "throw";
    this.onError = options.onError;

    try {
      this.channel.bufferedAmountLowThreshold = this.lowWaterMark;
    } catch {
      // Ignore if property is read-only or unsupported in environment
    }

    if (typeof this.channel.addEventListener === "function") {
      this.channel.addEventListener(
        "bufferedamountlow",
        this.handleBufferedAmountLow,
      );
      this.channel.addEventListener("open", this.handleOpen);
      this.channel.addEventListener("close", this.handleClose);
    }
    if (
      this.channel.onbufferedamountlow === null ||
      this.channel.onbufferedamountlow === undefined
    ) {
      this.channel.onbufferedamountlow = this.handleBufferedAmountLow;
    }
  }

  public get bufferedAmount(): number {
    return typeof this.channel.bufferedAmount === "number"
      ? this.channel.bufferedAmount
      : 0;
  }

  public get queuedFrames(): number {
    return this.queue.length;
  }

  public get queuedBytes(): number {
    return this._queuedBytes;
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public getQueuedBytes(): number {
    return this._queuedBytes;
  }

  public get isBackpressured(): boolean {
    if (this.bufferedAmount >= this.highWaterMark) {
      return true;
    }
    return this._isBackpressured;
  }

  public get isDisposed(): boolean {
    return this._disposed;
  }

  public getMetrics(): DataChannelChunkerMetrics {
    return {
      queuedFrames: this.queue.length,
      queuedBytes: this._queuedBytes,
      isBackpressured: this.isBackpressured,
      totalMessagesEnqueued: this.totalMessagesEnqueued,
      totalFramesSent: this.totalFramesSent,
      totalBytesSent: this.totalBytesSent,
    };
  }

  /**
   * Enqueues a logical binary message. Fragments the payload into MTU frames
   * using encodeCrdtFrames() and triggers queue drainage.
   */
  public enqueue(
    data: ArrayBuffer | Uint8Array,
    options: EnqueueOptions = {},
  ): boolean {
    if (this._disposed) {
      throw new Error(
        "Cannot enqueue message on a disposed DataChannelChunker",
      );
    }

    const rawBytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    let messageId: number;
    if (options.messageId !== undefined) {
      messageId = options.messageId >>> 0;
    } else {
      messageId = this.nextMessageId >>> 0;
      this.nextMessageId = (this.nextMessageId + 1) >>> 0;
      if (this.nextMessageId === 0) {
        this.nextMessageId = 1;
      }
    }

    const messageType =
      options.messageType ?? CrdtFrameMessageType.DELTA_UPDATE;
    const compressed = options.compressed ?? true;
    const maxChunkPayloadSize =
      options.maxChunkPayloadSize ?? CRDT_MAX_CHUNK_PAYLOAD_SIZE;

    const frames = encodeCrdtFrames(rawBytes, {
      messageId,
      messageType,
      compressed,
      maxChunkPayloadSize,
    });

    let incomingBytes = 0;
    for (let i = 0; i < frames.length; i++) {
      incomingBytes += frames[i].byteLength;
    }

    if (
      this._queuedBytes + incomingBytes > this.maxQueueBytes ||
      this.queue.length + frames.length > this.maxQueueFrames
    ) {
      if (this.overflowPolicy === "throw") {
        throw new QueueOverflowError(
          `DataChannelChunker queue overflow: queued ${this._queuedBytes + incomingBytes} bytes exceeds limit ${this.maxQueueBytes}`,
        );
      }
      if (this.onError) {
        this.onError(
          new QueueOverflowError(
            "DataChannelChunker queue overflow: capacity exceeded",
          ),
        );
      }
      return false;
    }

    for (let i = 0; i < frames.length; i++) {
      this.queue.push(frames[i]);
    }
    this._queuedBytes += incomingBytes;
    this.totalMessagesEnqueued += 1;

    this.drainQueue();
    return true;
  }

  public send(
    data: ArrayBuffer | Uint8Array,
    options?: EnqueueOptions,
  ): boolean {
    return this.enqueue(data, options);
  }

  /**
   * Drains queued frames to the underlying DataChannel while respecting
   * HIGH_WATER_MARK backpressure boundaries and handling OperationError.
   */
  public drainQueue(): void {
    if (this._disposed || this._isDraining) {
      return;
    }
    if (this.channel.readyState !== "open") {
      return;
    }

    this._isDraining = true;
    try {
      while (this.queue.length > 0) {
        if (this.channel.readyState !== "open") {
          break;
        }

        const nextFrame = this.queue[0];
        const nextFrameSize = nextFrame.byteLength;

        // Pause sending if adding this frame would exceed HIGH_WATER_MARK
        if (this.bufferedAmount + nextFrameSize > this.highWaterMark) {
          this._isBackpressured = true;
          break;
        }

        const bufferToSend = (
          nextFrame.byteOffset === 0 &&
          nextFrame.byteLength === nextFrame.buffer.byteLength
            ? nextFrame.buffer
            : nextFrame.buffer.slice(
                nextFrame.byteOffset,
                nextFrame.byteOffset + nextFrame.byteLength,
              )
        ) as ArrayBuffer;

        try {
          this.channel.send(bufferToSend);
        } catch (err: unknown) {
          const isOperationError =
            (err instanceof Error && err.name === "OperationError") ||
            (typeof err === "object" &&
              err !== null &&
              "name" in err &&
              (err as any).name === "OperationError") ||
            (err instanceof Error && /operation/i.test(err.message));

          if (isOperationError) {
            // Do not remove the frame from the queue; mark backpressured and wait for drain
            this._isBackpressured = true;
            break;
          }

          if (this.onError) {
            this.onError(err instanceof Error ? err : new Error(String(err)));
          }
          throw err;
        }

        // Only remove the frame from the queue after channel.send() succeeds
        this.queue.shift();
        this._queuedBytes -= nextFrameSize;
        this.totalFramesSent += 1;
        this.totalBytesSent += nextFrameSize;
      }

      if (this.bufferedAmount <= this.lowWaterMark && this.queue.length === 0) {
        this._isBackpressured = false;
      }
    } finally {
      this._isDraining = false;
    }
  }

  private handleBufferedAmountLow = (): void => {
    if (this._disposed) return;
    if (this.bufferedAmount <= this.lowWaterMark) {
      this._isBackpressured = false;
    }
    this.drainQueue();
  };

  private handleOpen = (): void => {
    if (this._disposed) return;
    this.drainQueue();
  };

  private handleClose = (): void => {
    this.dispose();
  };

  public dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    if (typeof this.channel.removeEventListener === "function") {
      this.channel.removeEventListener(
        "bufferedamountlow",
        this.handleBufferedAmountLow,
      );
      this.channel.removeEventListener("open", this.handleOpen);
      this.channel.removeEventListener("close", this.handleClose);
    }
    if (this.channel.onbufferedamountlow === this.handleBufferedAmountLow) {
      this.channel.onbufferedamountlow = null;
    }

    this.queue = [];
    this._queuedBytes = 0;
    this._isBackpressured = false;
  }

  public destroy(): void {
    this.dispose();
  }
}
