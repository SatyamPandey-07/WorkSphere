"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export const DEFAULT_SAMPLE_RATE = 24000;
export const DEFAULT_CHUNK_DURATION_MS = 250;
export const DEFAULT_MAX_BUFFER_CHUNKS = 20; // 5000ms max buffer at 250ms chunks
export const DEFAULT_PREBUFFER_CHUNKS = 2; // 500ms jitter buffer before playback

export interface AudioBufferTelemetry {
  chunksQueued: number;
  chunksPlayed: number;
  underrunCount: number;
  overrunCount: number;
  bufferedDurationMs: number;
  bufferUtilization: number; // 0.0 to 1.0
  isBackpressureActive: boolean;
}

export interface UseVoiceConciergeOptions {
  sampleRate?: number;
  chunkDurationMs?: number;
  maxBufferChunks?: number;
  minBufferChunksToPlay?: number;
  audioContext?: AudioContext | null;
  onUnderrun?: (metrics: AudioBufferTelemetry) => void;
  onOverrun?: (metrics: AudioBufferTelemetry) => void;
  onTelemetryUpdate?: (metrics: AudioBufferTelemetry) => void;
}

/**
 * Converts Int16 PCM byte/word buffer to Float32 normalized [-1.0, 1.0] samples.
 */
export function convertInt16ToFloat32(input: Int16Array): Float32Array {
  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    output[i] = input[i] / 32768.0;
  }
  return output;
}

/**
 * StreamingAudioRingBuffer
 *
 * Implements a backpressure-aware ring buffer that slices incoming arbitrary PCM audio
 * data into fixed-size chunks (e.g. 250ms), mitigating jitter and preventing
 * memory leaks / audio stutter on variable-latency connections.
 */
export class StreamingAudioRingBuffer {
  public readonly sampleRate: number;
  public readonly chunkDurationMs: number;
  public readonly samplesPerChunk: number;
  public readonly maxChunks: number;

  private queue: Float32Array[] = [];
  private pendingSamples: number[] = [];
  private chunksPlayedCount = 0;
  private underrunCount = 0;
  private overrunCount = 0;

  private onUnderrun?: (metrics: AudioBufferTelemetry) => void;
  private onOverrun?: (metrics: AudioBufferTelemetry) => void;

  constructor(options: {
    sampleRate?: number;
    chunkDurationMs?: number;
    maxChunks?: number;
    onUnderrun?: (metrics: AudioBufferTelemetry) => void;
    onOverrun?: (metrics: AudioBufferTelemetry) => void;
  } = {}) {
    this.sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
    this.chunkDurationMs = options.chunkDurationMs ?? DEFAULT_CHUNK_DURATION_MS;
    this.samplesPerChunk = Math.round((this.sampleRate * this.chunkDurationMs) / 1000);
    this.maxChunks = options.maxChunks ?? DEFAULT_MAX_BUFFER_CHUNKS;
    this.onUnderrun = options.onUnderrun;
    this.onOverrun = options.onOverrun;
  }

  /**
   * Accepts incoming raw PCM audio (Float32Array, Int16Array, or ArrayBuffer)
   * and slices it into 250ms chunks.
   */
  public push(data: Float32Array | Int16Array | ArrayBuffer): void {
    let floatSamples: Float32Array;

    if (data instanceof Float32Array) {
      floatSamples = data;
    } else if (data instanceof Int16Array) {
      floatSamples = convertInt16ToFloat32(data);
    } else if (data instanceof ArrayBuffer) {
      floatSamples = convertInt16ToFloat32(new Int16Array(data));
    } else {
      return;
    }

    // Append to pending samples accumulator
    for (let i = 0; i < floatSamples.length; i++) {
      this.pendingSamples.push(floatSamples[i]);
    }

    // Extract complete 250ms chunks
    while (this.pendingSamples.length >= this.samplesPerChunk) {
      const chunkSamples = this.pendingSamples.splice(0, this.samplesPerChunk);
      const chunk = new Float32Array(chunkSamples);

      // Backpressure check: if buffer exceeds maxChunks, drop oldest chunk (overrun)
      if (this.queue.length >= this.maxChunks) {
        this.overrunCount++;
        this.queue.shift(); // Drop oldest to prevent unbounded memory growth

        if (this.onOverrun) {
          this.onOverrun(this.getTelemetry());
        }
      }

      this.queue.push(chunk);
    }
  }

  /**
   * Pulls the next 250ms chunk for playback. If the queue is starved, increments underrun count.
   */
  public pull(): Float32Array | null {
    if (this.queue.length === 0) {
      this.underrunCount++;
      if (this.onUnderrun) {
        this.onUnderrun(this.getTelemetry());
      }
      return null;
    }

    this.chunksPlayedCount++;
    return this.queue.shift() || null;
  }

  /**
   * Returns current buffer telemetry.
   */
  public getTelemetry(): AudioBufferTelemetry {
    const chunksQueued = this.queue.length;
    const bufferedDurationMs = chunksQueued * this.chunkDurationMs;
    const bufferUtilization = Math.min(1.0, chunksQueued / this.maxChunks);
    const isBackpressureActive = chunksQueued >= this.maxChunks;

    return {
      chunksQueued,
      chunksPlayed: this.chunksPlayedCount,
      underrunCount: this.underrunCount,
      overrunCount: this.overrunCount,
      bufferedDurationMs,
      bufferUtilization: Number(bufferUtilization.toFixed(3)),
      isBackpressureActive,
    };
  }

  /**
   * Clears all queued and pending audio samples.
   */
  public clear(): void {
    this.queue = [];
    this.pendingSamples = [];
  }

  /**
   * Resets all metrics and queues.
   */
  public reset(): void {
    this.clear();
    this.chunksPlayedCount = 0;
    this.underrunCount = 0;
    this.overrunCount = 0;
  }
}

export function useVoiceConcierge(options: UseVoiceConciergeOptions = {}) {
  const {
    sampleRate = DEFAULT_SAMPLE_RATE,
    chunkDurationMs = DEFAULT_CHUNK_DURATION_MS,
    maxBufferChunks = DEFAULT_MAX_BUFFER_CHUNKS,
    minBufferChunksToPlay = DEFAULT_PREBUFFER_CHUNKS,
    audioContext: externalAudioContext,
    onUnderrun,
    onOverrun,
    onTelemetryUpdate,
  } = options;

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [telemetry, setTelemetry] = useState<AudioBufferTelemetry>({
    chunksQueued: 0,
    chunksPlayed: 0,
    underrunCount: 0,
    overrunCount: 0,
    bufferedDurationMs: 0,
    bufferUtilization: 0,
    isBackpressureActive: false,
  });

  const bufferRef = useRef<StreamingAudioRingBuffer | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const schedulerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initialize or get buffer instance
  if (!bufferRef.current) {
    bufferRef.current = new StreamingAudioRingBuffer({
      sampleRate,
      chunkDurationMs,
      maxChunks: maxBufferChunks,
      onUnderrun: (t) => {
        setTelemetry(t);
        onUnderrun?.(t);
      },
      onOverrun: (t) => {
        setTelemetry(t);
        onOverrun?.(t);
      },
    });
  }

  const getOrCreateAudioContext = useCallback(() => {
    if (audioContextRef.current) return audioContextRef.current;
    if (externalAudioContext) {
      audioContextRef.current = externalAudioContext;
      return externalAudioContext;
    }

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx({ sampleRate });
      audioContextRef.current = ctx;
      return ctx;
    }
    return null;
  }, [externalAudioContext, sampleRate]);

  // Schedule next 250ms audio chunk
  const scheduleNextChunks = useCallback(() => {
    const ctx = getOrCreateAudioContext();
    const ringBuffer = bufferRef.current;
    if (!ctx || !ringBuffer) return;

    const currentMetrics = ringBuffer.getTelemetry();
    setTelemetry(currentMetrics);
    onTelemetryUpdate?.(currentMetrics);

    // Lookahead schedule window (schedule up to 0.5s in advance)
    const scheduleAheadTime = 0.5;
    const chunkSec = chunkDurationMs / 1000;

    while (
      nextPlayTimeRef.current < ctx.currentTime + scheduleAheadTime &&
      currentMetrics.chunksQueued > 0
    ) {
      const chunk = ringBuffer.pull();
      if (!chunk) break;

      const audioBuffer = ctx.createBuffer(1, chunk.length, sampleRate);
      audioBuffer.getChannelData(0).set(chunk);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      const startTime = Math.max(ctx.currentTime, nextPlayTimeRef.current);
      source.start(startTime);
      nextPlayTimeRef.current = startTime + chunkSec;
    }

    // Check if buffer is starved
    if (currentMetrics.chunksQueued === 0 && ctx.currentTime >= nextPlayTimeRef.current) {
      setIsBuffering(true);
    } else {
      setIsBuffering(false);
    }
  }, [chunkDurationMs, getOrCreateAudioContext, onTelemetryUpdate, sampleRate]);

  // Push incoming audio
  const pushAudioData = useCallback(
    (data: Float32Array | Int16Array | ArrayBuffer) => {
      if (!bufferRef.current) return;
      bufferRef.current.push(data);

      const t = bufferRef.current.getTelemetry();
      setTelemetry(t);
      onTelemetryUpdate?.(t);

      // Auto-start or resume if prebuffered enough chunks
      if (t.chunksQueued >= minBufferChunksToPlay && !isPlaying) {
        setIsBuffering(false);
      }
    },
    [isPlaying, minBufferChunksToPlay, onTelemetryUpdate]
  );

  const start = useCallback(async () => {
    const ctx = getOrCreateAudioContext();
    if (!ctx) return;

    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    setIsPlaying(true);
    nextPlayTimeRef.current = ctx.currentTime;

    if (schedulerTimerRef.current) {
      clearInterval(schedulerTimerRef.current);
    }
    schedulerTimerRef.current = setInterval(scheduleNextChunks, 50);
  }, [getOrCreateAudioContext, scheduleNextChunks]);

  const pause = useCallback(() => {
    setIsPlaying(false);
    if (schedulerTimerRef.current) {
      clearInterval(schedulerTimerRef.current);
      schedulerTimerRef.current = null;
    }
  }, []);

  const clear = useCallback(() => {
    bufferRef.current?.clear();
    const t = bufferRef.current?.getTelemetry() ?? telemetry;
    setTelemetry(t);
  }, [telemetry]);

  const stop = useCallback(() => {
    pause();
    clear();
  }, [clear, pause]);

  useEffect(() => {
    return () => {
      if (schedulerTimerRef.current) {
        clearInterval(schedulerTimerRef.current);
        schedulerTimerRef.current = null;
      }
    };
  }, []);

  return {
    pushAudioData,
    start,
    pause,
    stop,
    clear,
    isPlaying,
    isBuffering,
    telemetry,
  };
}

export default useVoiceConcierge;
