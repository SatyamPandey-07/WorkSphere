import { renderHook, act } from "@testing-library/react";
import {
  useVoiceConcierge,
  StreamingAudioRingBuffer,
  convertInt16ToFloat32,
  DEFAULT_SAMPLE_RATE,
  DEFAULT_CHUNK_DURATION_MS,
} from "@/hooks/useVoiceConcierge";

describe("StreamingAudioRingBuffer and useVoiceConcierge", () => {
  describe("convertInt16ToFloat32", () => {
    it("converts Int16 PCM samples to normalized [-1.0, 1.0] Float32Array", () => {
      const int16 = new Int16Array([0, 32767, -32768, 16384]);
      const float32 = convertInt16ToFloat32(int16);

      expect(float32[0]).toBe(0);
      expect(float32[1]).toBeCloseTo(1.0, 2);
      expect(float32[2]).toBe(-1.0);
      expect(float32[3]).toBeCloseTo(0.5, 2);
    });
  });

  describe("StreamingAudioRingBuffer 250ms chunking & backpressure", () => {
    it("chunks incoming audio into exact 250ms chunks", () => {
      const sampleRate = 24000;
      const buffer = new StreamingAudioRingBuffer({
        sampleRate,
        chunkDurationMs: 250,
        maxChunks: 10,
      });

      expect(buffer.samplesPerChunk).toBe(6000); // 24000 * 0.25

      // Push 12,000 samples (exactly two 250ms chunks)
      const data = new Float32Array(12000);
      buffer.push(data);

      const telemetry = buffer.getTelemetry();
      expect(telemetry.chunksQueued).toBe(2);
      expect(telemetry.bufferedDurationMs).toBe(500);

      const chunk1 = buffer.pull();
      expect(chunk1).not.toBeNull();
      expect(chunk1?.length).toBe(6000);

      const chunk2 = buffer.pull();
      expect(chunk2).not.toBeNull();
      expect(chunk2?.length).toBe(6000);
    });

    it("accumulates partial samples until a full 250ms chunk is reached", () => {
      const buffer = new StreamingAudioRingBuffer({
        sampleRate: 24000,
        chunkDurationMs: 250,
      });

      // Push 4000 samples (< 6000 required for a chunk)
      buffer.push(new Float32Array(4000));
      expect(buffer.getTelemetry().chunksQueued).toBe(0);

      // Push another 4000 samples (total 8000 -> 1 full chunk of 6000 + 2000 remaining)
      buffer.push(new Float32Array(4000));
      expect(buffer.getTelemetry().chunksQueued).toBe(1);

      // Push 4000 samples (2000 + 4000 = 6000 -> 2nd full chunk)
      buffer.push(new Float32Array(4000));
      expect(buffer.getTelemetry().chunksQueued).toBe(2);
    });

    it("triggers overrun metric and drops oldest chunk when buffer capacity is exceeded", () => {
      const onOverrun = jest.fn();
      const buffer = new StreamingAudioRingBuffer({
        sampleRate: 24000,
        chunkDurationMs: 250,
        maxChunks: 3,
        onOverrun,
      });

      // Push 4 chunks worth of samples (4 * 6000 = 24,000)
      buffer.push(new Float32Array(24000));

      const telemetry = buffer.getTelemetry();
      expect(telemetry.chunksQueued).toBe(3); // Capped at maxChunks
      expect(telemetry.overrunCount).toBe(1);
      expect(telemetry.isBackpressureActive).toBe(true);
      expect(onOverrun).toHaveBeenCalledTimes(1);
    });

    it("triggers underrun metric when pulling from an empty buffer", () => {
      const onUnderrun = jest.fn();
      const buffer = new StreamingAudioRingBuffer({
        sampleRate: 24000,
        chunkDurationMs: 250,
        onUnderrun,
      });

      const chunk = buffer.pull();
      expect(chunk).toBeNull();

      const telemetry = buffer.getTelemetry();
      expect(telemetry.underrunCount).toBe(1);
      expect(onUnderrun).toHaveBeenCalledTimes(1);
    });
  });

  describe("useVoiceConcierge Hook", () => {
    let mockAudioContext: any;

    beforeEach(() => {
      mockAudioContext = {
        state: "running",
        currentTime: 0,
        destination: {},
        createBuffer: jest.fn().mockReturnValue({
          getChannelData: jest.fn().mockReturnValue(new Float32Array(6000)),
        }),
        createBufferSource: jest.fn().mockReturnValue({
          connect: jest.fn(),
          start: jest.fn(),
        }),
        resume: jest.fn().mockResolvedValue(undefined),
      };

      (window as any).AudioContext = jest.fn().mockImplementation(() => mockAudioContext);
    });

    it("initializes with default telemetry and state", () => {
      const { result } = renderHook(() =>
        useVoiceConcierge({ audioContext: mockAudioContext })
      );

      expect(result.current.isPlaying).toBe(false);
      expect(result.current.isBuffering).toBe(false);
      expect(result.current.telemetry.chunksQueued).toBe(0);
      expect(result.current.telemetry.underrunCount).toBe(0);
      expect(result.current.telemetry.overrunCount).toBe(0);
    });

    it("pushes audio data and updates queued chunks in telemetry", () => {
      const { result } = renderHook(() =>
        useVoiceConcierge({
          sampleRate: 24000,
          chunkDurationMs: 250,
          audioContext: mockAudioContext,
        })
      );

      act(() => {
        result.current.pushAudioData(new Float32Array(12000)); // 2 chunks
      });

      expect(result.current.telemetry.chunksQueued).toBe(2);
      expect(result.current.telemetry.bufferedDurationMs).toBe(500);
    });

    it("clears the buffer when clear is called", () => {
      const { result } = renderHook(() =>
        useVoiceConcierge({
          sampleRate: 24000,
          chunkDurationMs: 250,
          audioContext: mockAudioContext,
        })
      );

      act(() => {
        result.current.pushAudioData(new Float32Array(6000));
      });
      expect(result.current.telemetry.chunksQueued).toBe(1);

      act(() => {
        result.current.clear();
      });
      expect(result.current.telemetry.chunksQueued).toBe(0);
    });
  });
});
