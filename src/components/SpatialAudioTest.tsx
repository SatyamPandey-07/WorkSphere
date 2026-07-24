/**
 * HRTF Spatial Audio Test Component with Lock-Free Ring Buffer
 *
 * Demonstrates glitch-free audio playback under CPU load spikes by:
 * 1. Creating a SharedArrayBuffer-backed lock-free SPSC ring buffer
 * 2. Pre-buffering 50ms of audio before worklet starts processing
 * 3. Feeding oscillator data into the ring buffer from the main thread
 * 4. Monitoring underruns and buffer fill levels in real time
 */

import React, { useState, useRef, useCallback, useEffect } from "react";
import { SPSCRingBuffer } from "@/lib/spatial/SPSCRingBuffer";

// 50ms pre-buffer at 48kHz = 2400 samples
const TARGET_PRE_BUFFER_MS = 50;
const SAMPLE_RATE = 48000;
const TARGET_PRE_BUFFER_SAMPLES = Math.ceil(
  (TARGET_PRE_BUFFER_MS / 1000) * SAMPLE_RATE,
);
const RING_BUFFER_CAPACITY = TARGET_PRE_BUFFER_SAMPLES * 2; // Double for headroom

interface BufferStatus {
  fillLevel: number;
  totalUnderruns: number;
  isPreBuffering: boolean;
}

const SpatialAudioTest = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState<BufferStatus>({
    fillLevel: 0,
    totalUnderruns: 0,
    isPreBuffering: false,
  });
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const ringBufferRef = useRef<SPSCRingBuffer | null>(null);
  const feedIntervalRef = useRef<number | null>(null);
  const statusIntervalRef = useRef<number | null>(null);

  // Cleanup all resources
  const cleanup = useCallback(() => {
    if (feedIntervalRef.current !== null) {
      clearInterval(feedIntervalRef.current);
      feedIntervalRef.current = null;
    }
    if (statusIntervalRef.current !== null) {
      clearInterval(statusIntervalRef.current);
      statusIntervalRef.current = null;
    }
    if (oscillatorRef.current) {
      try {
        oscillatorRef.current.stop();
      } catch {}
      oscillatorRef.current.disconnect();
      oscillatorRef.current = null;
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    ringBufferRef.current = null;
    setStatus({ fillLevel: 0, totalUnderruns: 0, isPreBuffering: false });
  }, []);

  // Pre-buffer audio frames into the ring buffer
  const preBufferAudio = useCallback(
    (ringBuffer: SPSCRingBuffer, frameSize: number): Promise<void> => {
      return new Promise((resolve) => {
        setStatus((prev) => ({ ...prev, isPreBuffering: true }));

        // Generate silence frames to fill the ring buffer to 50ms
        const totalSamples = TARGET_PRE_BUFFER_SAMPLES;
        const silenceFrame = new Float32Array(frameSize);
        silenceFrame.fill(0);
        let written = 0;

        const fillInterval = setInterval(() => {
          const pushResult = ringBuffer.push(silenceFrame);
          written += pushResult;

          if (written >= totalSamples || ringBuffer.fillLevel() >= 0.95) {
            clearInterval(fillInterval);
            setStatus((prev) => ({
              ...prev,
              isPreBuffering: false,
              fillLevel: ringBuffer.fillLevel(),
            }));
            resolve();
          }
        }, 1); // Every 1ms to fill quickly

        // Safety timeout: resolve after 100ms even if not full
        setTimeout(() => {
          clearInterval(fillInterval);
          setStatus((prev) => ({ ...prev, isPreBuffering: false }));
          resolve();
        }, 100);
      });
    },
    [],
  );

  // Feed oscillator data into ring buffer at regular intervals
  const startFeedingOscillator = useCallback(
    (ringBuffer: SPSCRingBuffer, audioCtx: AudioContext, frameSize: number) => {
      // Create a script processor node to generate oscillator samples on the main thread
      const oscillatorFrame = new Float32Array(frameSize);

      const feedInterval = window.setInterval(
        () => {
          // Generate a short burst of 440Hz sine wave
          const now = audioCtx.currentTime;
          for (let i = 0; i < frameSize; i++) {
            const t = now + i / SAMPLE_RATE;
            oscillatorFrame[i] = Math.sin(2 * Math.PI * 440 * t) * 0.3; // 30% amplitude
          }

          // Push to ring buffer
          const pushed = ringBuffer.push(oscillatorFrame);

          // Update status periodically
          setStatus((prev) => ({
            ...prev,
            fillLevel: ringBuffer.fillLevel(),
          }));

          // If ring buffer is full, the feed interval is too fast — the worklet will catch up
          if (pushed < frameSize) {
            // Buffer is full — we're producing faster than consuming (good, no underruns)
          }
        },
        Math.floor((frameSize / SAMPLE_RATE) * 1000 * 0.8),
      ); // Feed at 80% of real-time rate

      feedIntervalRef.current = feedInterval;
    },
    [],
  );

  const toggleAudio = async () => {
    if (isPlaying) {
      cleanup();
      setIsPlaying(false);
      return;
    }

    try {
      setError(null);

      // 1. Create AudioContext
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;

      if (!AudioContextClass) {
        throw new Error("Web Audio API not supported in this browser");
      }

      const audioCtx = new AudioContextClass({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = audioCtx;

      // 2. Load the AudioWorklet module
      await audioCtx.audioWorklet.addModule("/audio-processor.js");

      // 3. Create lock-free SPSC ring buffer
      const ringBuffer = new SPSCRingBuffer(RING_BUFFER_CAPACITY);
      ringBufferRef.current = ringBuffer;

      // 4. Create AudioWorkletNode
      const workletNode = new AudioWorkletNode(audioCtx, "hrtf-processor", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      workletNodeRef.current = workletNode;

      // 5. Handle messages from the worklet
      workletNode.port.onmessage = (event) => {
        const { type, totalUnderruns, fillLevel, error: errMsg } = event.data;

        switch (type) {
          case "WASM_READY":
            console.log("[SpatialAudioTest] WASM engine ready");
            break;

          case "RING_BUFFER_READY":
            console.log(
              "[SpatialAudioTest] Ring buffer ready, starting pre-buffer",
            );
            // Start pre-buffering, then connect audio graph
            preBufferAudio(ringBuffer, 128).then(() => {
              // Connect worklet to destination
              workletNode.connect(audioCtx.destination);
              console.log("[SpatialAudioTest] Audio graph connected");

              // Start feeding oscillator data
              startFeedingOscillator(ringBuffer, audioCtx, 128);
            });
            break;

          case "UNDERRUN":
            setStatus((prev) => ({
              ...prev,
              totalUnderruns: totalUnderruns ?? prev.totalUnderruns + 1,
              fillLevel: fillLevel ?? prev.fillLevel,
            }));
            break;

          case "LOW_BUFFER_WARNING":
            console.warn("[SpatialAudioTest] Low buffer:", fillLevel);
            break;

          case "WARNING":
            console.warn("[SpatialAudioTest]", event.data.message);
            break;

          case "ERROR":
            console.error("[SpatialAudioTest] Worklet error:", errMsg);
            setError(errMsg);
            break;
        }
      };

      // 6. Send ring buffer to worklet (must be before WASM to set up buffering first)
      workletNode.port.postMessage(
        {
          type: "INIT_RING_BUFFER",
          sab: ringBuffer.getSharedBuffer(),
          frameSize: 128,
        },
        [ringBuffer.getSharedBuffer()],
      );

      // 7. Load and send WASM binary to worklet
      const wasmResponse = await fetch("/hrtf_engine.wasm");
      if (!wasmResponse.ok) {
        throw new Error(`Failed to load WASM: ${wasmResponse.status}`);
      }
      const wasmBinary = await wasmResponse.arrayBuffer();
      workletNode.port.postMessage(
        {
          type: "LOAD_WASM",
          wasmBinary,
        },
        [wasmBinary],
      );

      setIsPlaying(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[SpatialAudioTest] Setup failed:", message);
      setError(message);
      cleanup();
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return (
    <div
      style={{
        padding: "20px",
        border: "1px solid #ccc",
        margin: "10px",
        borderRadius: "8px",
        fontFamily: "monospace",
      }}
    >
      <h3 style={{ marginTop: 0 }}>
        WASM HRTF Spatial Audio Test (Ring Buffer)
      </h3>

      <button
        onClick={toggleAudio}
        style={{
          padding: "10px 20px",
          cursor: "pointer",
          fontSize: "14px",
          fontWeight: "bold",
        }}
      >
        {isPlaying ? "⏹ Stop Test Sound" : "▶ Start Test Sound"}
      </button>

      {/* Status panel */}
      {isPlaying && (
        <div
          style={{
            marginTop: "12px",
            padding: "10px",
            background: "#1a1a2e",
            color: "#00ff88",
            borderRadius: "4px",
            fontSize: "12px",
            lineHeight: "1.6",
          }}
        >
          <div>
            Buffer fill:{" "}
            <span
              style={{ color: status.fillLevel > 0.2 ? "#00ff88" : "#ff4444" }}
            >
              {(status.fillLevel * 100).toFixed(1)}%
            </span>
          </div>
          <div>
            Underruns:{" "}
            <span
              style={{
                color: status.totalUnderruns === 0 ? "#00ff88" : "#ff4444",
              }}
            >
              {status.totalUnderruns}
            </span>
          </div>
          <div>
            Status:{" "}
            {status.isPreBuffering
              ? "⏳ Pre-buffering..."
              : status.totalUnderruns === 0
                ? "✅ Glitch-free"
                : `⚠️ ${status.totalUnderruns} underrun(s)`}
          </div>
          <div style={{ marginTop: "4px", fontSize: "10px", color: "#888" }}>
            Pre-buffer: {TARGET_PRE_BUFFER_MS}ms | Ring: {RING_BUFFER_CAPACITY}{" "}
            samples
          </div>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div
          style={{
            marginTop: "8px",
            padding: "8px",
            background: "#ff000020",
            border: "1px solid #ff4444",
            borderRadius: "4px",
            color: "#ff4444",
            fontSize: "12px",
          }}
        >
          ❌ {error}
        </div>
      )}
    </div>
  );
};

export default SpatialAudioTest;
