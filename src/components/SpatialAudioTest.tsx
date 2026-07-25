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

  // Dynamic HRTF Spatial Parameters
  const [azimuth, setAzimuth] = useState(0);
  const [elevation, setElevation] = useState(0);
  const [distance, setDistance] = useState(2.0);
  const [simdEnabled, setSimdEnabled] = useState(true);
  const [headRotation, setHeadRotation] = useState(0);

  // 2D Co-worker Position Map Coordinates
  const [sourceX, setSourceX] = useState(0.0);
  const [sourceY, setSourceY] = useState(2.0);

  // Room Acoustic Parameters
  const [roomWidth, setRoomWidth] = useState(10.0);
  const [roomLength, setRoomLength] = useState(10.0);
  const [roomHeight, setRoomHeight] = useState(3.0);
  const [roomAbsorption, setRoomAbsorption] = useState(0.4);

  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const ringBufferRef = useRef<SPSCRingBuffer | null>(null);
  const feedIntervalRef = useRef<number | null>(null);
  const statusIntervalRef = useRef<number | null>(null);
  const soundstageRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

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

        // Safety timeout
        setTimeout(() => {
          clearInterval(fillInterval);
          setStatus((prev) => ({ ...prev, isPreBuffering: false }));
          resolve();
        }, 100);
      });
    },
    [],
  );

  // Feed oscillator data into ring buffer
  const startFeedingOscillator = useCallback(
    (ringBuffer: SPSCRingBuffer, audioCtx: AudioContext, frameSize: number) => {
      const oscillatorFrame = new Float32Array(frameSize);

      const feedInterval = window.setInterval(
        () => {
          const now = audioCtx.currentTime;
          for (let i = 0; i < frameSize; i++) {
            const t = now + i / SAMPLE_RATE;
            // Generate a co-working voice-like test sound (combining 220Hz and 440Hz harmonics)
            oscillatorFrame[i] =
              (Math.sin(2 * Math.PI * 220 * t) * 0.4 +
                Math.sin(2 * Math.PI * 440 * t) * 0.2) *
              0.3; // safe amplitude
          }

          ringBuffer.push(oscillatorFrame);

          setStatus((prev) => ({
            ...prev,
            fillLevel: ringBuffer.fillLevel(),
          }));
        },
        Math.floor((frameSize / SAMPLE_RATE) * 1000 * 0.8),
      );

      feedIntervalRef.current = feedInterval;
    },
    [],
  );

  // Recalculate azimuth and distance based on 2D co-worker position & head rotation
  useEffect(() => {
    const dist = Math.sqrt(sourceX * sourceX + sourceY * sourceY);
    const safeDist = Math.max(0.1, dist);

    // Angle from listener center (0, 0) looking up Y-axis
    const angleToSource = Math.atan2(sourceX, sourceY) * (180 / Math.PI);

    // Relative azimuth: target angle - listener head rotation
    let az = angleToSource - headRotation;
    while (az < -180) az += 360;
    while (az > 180) az -= 360;

    setAzimuth(Math.round(az));
    setDistance(parseFloat(safeDist.toFixed(2)));
  }, [sourceX, sourceY, headRotation]);

  // Sync parameters to AudioWorkletNode
  useEffect(() => {
    if (workletNodeRef.current && isPlaying) {
      workletNodeRef.current.port.postMessage({
        type: "UPDATE_SPATIAL",
        azimuth,
        elevation,
        distance,
      });
    }
  }, [azimuth, elevation, distance, isPlaying]);

  useEffect(() => {
    if (workletNodeRef.current && isPlaying) {
      workletNodeRef.current.port.postMessage({
        type: "SET_SIMD_ENABLED",
        enabled: simdEnabled,
      });
    }
  }, [simdEnabled, isPlaying]);

  useEffect(() => {
    if (workletNodeRef.current && isPlaying) {
      workletNodeRef.current.port.postMessage({
        type: "SET_ROOM_PARAMETERS",
        width: roomWidth,
        length: roomLength,
        height: roomHeight,
        absorption: roomAbsorption,
      });
    }
  }, [roomWidth, roomLength, roomHeight, roomAbsorption, isPlaying]);

  const toggleAudio = async () => {
    if (isPlaying) {
      cleanup();
      setIsPlaying(false);
      return;
    }

    try {
      setError(null);

      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;

      if (!AudioContextClass) {
        throw new Error("Web Audio API not supported in this browser");
      }

      const audioCtx = new AudioContextClass({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = audioCtx;

      // Load AudioWorklet
      await audioCtx.audioWorklet.addModule("/audio-processor.js");

      // Create lock-free ring buffer
      const ringBuffer = new SPSCRingBuffer(RING_BUFFER_CAPACITY);
      ringBufferRef.current = ringBuffer;

      // Create stereo AudioWorkletNode (2 channels output)
      const workletNode = new AudioWorkletNode(audioCtx, "hrtf-processor", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      workletNodeRef.current = workletNode;

      // Handle message events
      workletNode.port.onmessage = (event) => {
        const { type, totalUnderruns, fillLevel, error: errMsg } = event.data;

        switch (type) {
          case "WASM_READY":
            console.log("[SpatialAudioTest] WASM engine ready");
            // Set initial room parameters
            workletNode.port.postMessage({
              type: "SET_ROOM_PARAMETERS",
              width: roomWidth,
              length: roomLength,
              height: roomHeight,
              absorption: roomAbsorption,
            });
            break;

          case "RING_BUFFER_READY":
            console.log(
              "[SpatialAudioTest] Ring buffer ready, pre-buffering...",
            );
            preBufferAudio(ringBuffer, 128).then(() => {
              workletNode.connect(audioCtx.destination);
              console.log("[SpatialAudioTest] Audio graph connected");
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
            console.warn("[SpatialAudioTest] Low buffer watermark:", fillLevel);
            break;

          case "WARNING":
            console.warn(
              "[SpatialAudioTest] Processor warning:",
              event.data.message,
            );
            break;

          case "ERROR":
            console.error("[SpatialAudioTest] Processor error:", errMsg);
            setError(errMsg);
            break;
        }
      };

      // Initialize ring buffer on processor
      workletNode.port.postMessage(
        {
          type: "INIT_RING_BUFFER",
          sab: ringBuffer.getSharedBuffer(),
          frameSize: 128,
        },
        [ringBuffer.getSharedBuffer()],
      );

      // Load WASM engine
      const wasmResponse = await fetch("/hrtf_engine.wasm");
      if (!wasmResponse.ok) {
        throw new Error(`Failed to load WASM engine: ${wasmResponse.status}`);
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

  // Soundstage mouse dragging interactions
  const handleSoundstageInteraction = (
    e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>,
  ) => {
    if (!soundstageRef.current) return;
    const rect = soundstageRef.current.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

    const xPx = clientX - (rect.left + rect.width / 2);
    const yPx = rect.top + rect.height / 2 - clientY; // standard Y is positive upwards

    const maxRadiusPx = rect.width / 2;
    const maxRadiusMeters = 8.0; // represent up to 8m distance on map
    const scale = maxRadiusMeters / maxRadiusPx;

    const xMeters = xPx * scale;
    const yMeters = yPx * scale;

    setSourceX(parseFloat(xMeters.toFixed(2)));
    setSourceY(parseFloat(yMeters.toFixed(2)));
  };

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // Map relative position coordinates back to screen pixels for visual display
  const mapXToPercent = (x: number) => {
    const maxRadiusMeters = 8.0;
    return 50 + (x / maxRadiusMeters) * 50;
  };

  const mapYToPercent = (y: number) => {
    const maxRadiusMeters = 8.0;
    return 50 - (y / maxRadiusMeters) * 50; // invert back for HTML top percent
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-6 bg-zinc-950 text-white rounded-2xl border border-zinc-800 shadow-2xl font-sans overflow-hidden">
      {/* Head import google fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap');
        .spatial-panel { font-family: 'Outfit', sans-serif; }
      `}</style>

      <div className="spatial-panel space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
          <div>
            <h2 className="text-2xl font-bold bg-gradient-to-r from-teal-400 to-indigo-400 bg-clip-text text-transparent">
              HRTF 3D Room Acoustic Simulator
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              Lock-Free Ring Buffer + WebAssembly SIMD binaural spatial engine
            </p>
          </div>
          <button
            onClick={toggleAudio}
            className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all transform active:scale-95 shadow-md ${
              isPlaying
                ? "bg-red-500 hover:bg-red-600 text-white"
                : "bg-gradient-to-r from-teal-500 to-indigo-500 hover:opacity-90 text-white"
            }`}
          >
            {isPlaying ? "⏹ Stop Spatializer" : "▶ Start Spatializer"}
          </button>
        </div>

        {/* Dynamic Controls Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left Column: Interactive Spatial 3D Map */}
          <div className="p-5 bg-zinc-900/50 rounded-2xl border border-zinc-800 flex flex-col items-center">
            <h3 className="text-sm font-semibold text-zinc-300 self-start mb-4">
              Workspace co-worker map (interactive)
            </h3>

            {/* Circular Soundstage Map */}
            <div
              ref={soundstageRef}
              onMouseDown={(e) => {
                setIsDragging(true);
                handleSoundstageInteraction(e);
              }}
              onMouseMove={(e) => {
                if (isDragging) handleSoundstageInteraction(e);
              }}
              onMouseUp={() => setIsDragging(false)}
              onMouseLeave={() => setIsDragging(false)}
              onTouchStart={(e) => {
                setIsDragging(true);
                handleSoundstageInteraction(e);
              }}
              onTouchMove={(e) => {
                if (isDragging) handleSoundstageInteraction(e);
              }}
              onTouchEnd={() => setIsDragging(false)}
              className="relative w-64 h-64 rounded-full border border-zinc-800/80 bg-zinc-950/70 shadow-inner flex items-center justify-center cursor-crosshair overflow-hidden"
            >
              {/* Concentric distance rings */}
              <div className="absolute w-48 h-48 rounded-full border border-zinc-900/40 pointer-events-none" />
              <div className="absolute w-32 h-32 rounded-full border border-zinc-900/40 pointer-events-none" />
              <div className="absolute w-16 h-16 rounded-full border border-zinc-900/40 pointer-events-none" />

              {/* Axis gridlines */}
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-zinc-900/20 pointer-events-none" />
              <div className="absolute top-1/2 left-0 right-0 h-px bg-zinc-900/20 pointer-events-none" />

              {/* Listener avatar at center */}
              <div
                className="absolute w-10 h-10 rounded-full bg-indigo-500/20 border-2 border-indigo-400 flex items-center justify-center shadow-lg transition-transform"
                style={{ transform: `rotate(${headRotation}deg)` }}
              >
                {/* Nose / Look direction indicator */}
                <div className="absolute -top-1.5 w-1 h-3 bg-indigo-400 rounded-full" />
                <span className="text-[10px] font-bold text-indigo-200">
                  YOU
                </span>
              </div>

              {/* Source avatar (Co-worker) */}
              <div
                className="absolute w-8 h-8 rounded-full bg-teal-500 border-2 border-teal-300 flex items-center justify-center shadow-md transform -translate-x-1/2 -translate-y-1/2 pointer-events-none select-none"
                style={{
                  left: `${mapXToPercent(sourceX)}%`,
                  top: `${mapYToPercent(sourceY)}%`,
                }}
              >
                <span className="text-[9px] font-extrabold text-zinc-950">
                  PEER
                </span>
              </div>
            </div>

            {/* Slider for head tracking rotation */}
            <div className="w-full mt-5 space-y-2">
              <div className="flex justify-between text-xs font-medium text-zinc-400">
                <span>Head Rotation Angle</span>
                <span className="text-indigo-400 font-bold">
                  {headRotation}°
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="360"
                value={headRotation}
                onChange={(e) => setHeadRotation(parseInt(e.target.value))}
                className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-400"
              />
            </div>

            {/* Slider for elevation */}
            <div className="w-full mt-3 space-y-2">
              <div className="flex justify-between text-xs font-medium text-zinc-400">
                <span>Elevation Angle</span>
                <span className="text-indigo-400 font-bold">{elevation}°</span>
              </div>
              <input
                type="range"
                min="-90"
                max="90"
                value={elevation}
                onChange={(e) => setElevation(parseInt(e.target.value))}
                className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-400"
              />
              <p className="text-[10px] text-zinc-500 italic text-center">
                Rotate head or adjust elevation to shift co-worker soundstage
                coordinates relative to you
              </p>
            </div>
          </div>

          {/* Right Column: Audio & Acoustic Parameters */}
          <div className="space-y-4">
            {/* Live HRTF telemetry status panel */}
            <div className="p-4 bg-zinc-900/50 rounded-2xl border border-zinc-800 space-y-2.5">
              <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                HRTF Spatial Telemetry
              </h3>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-zinc-950/50 p-2.5 rounded-lg border border-zinc-800/50">
                  <span className="block text-zinc-500 text-[10px] uppercase">
                    Azimuth
                  </span>
                  <span className="font-bold text-zinc-200">{azimuth}°</span>
                </div>
                <div className="bg-zinc-950/50 p-2.5 rounded-lg border border-zinc-800/50">
                  <span className="block text-zinc-500 text-[10px] uppercase">
                    Elevation
                  </span>
                  <span className="font-bold text-zinc-200">{elevation}°</span>
                </div>
                <div className="bg-zinc-950/50 p-2.5 rounded-lg border border-zinc-800/50">
                  <span className="block text-zinc-500 text-[10px] uppercase">
                    Distance
                  </span>
                  <span className="font-bold text-zinc-200">{distance}m</span>
                </div>
                <div className="bg-zinc-950/50 p-2.5 rounded-lg border border-zinc-800/50">
                  <span className="block text-zinc-500 text-[10px] uppercase">
                    WASM Kernel
                  </span>
                  <span className="font-bold text-teal-400 flex items-center gap-1.5">
                    {simdEnabled ? (
                      <>
                        <span className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-ping" />
                        SIMD v128
                      </>
                    ) : (
                      "Scalar Fallback"
                    )}
                  </span>
                </div>
              </div>

              {/* SIMD toggler */}
              <label className="flex items-center justify-between text-xs text-zinc-400 cursor-pointer pt-1">
                <span>Enable WebAssembly SIMD Acceleration</span>
                <input
                  type="checkbox"
                  checked={simdEnabled}
                  onChange={(e) => setSimdEnabled(e.target.checked)}
                  className="rounded border-zinc-800 bg-zinc-950 text-teal-500 focus:ring-teal-500 h-4 w-4"
                />
              </label>
            </div>

            {/* Room acoustic parameters */}
            <div className="p-4 bg-zinc-900/50 rounded-2xl border border-zinc-800 space-y-3">
              <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                Room Acoustic Simulator
              </h3>

              {/* Sliders for room dimension */}
              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-zinc-400">
                    <span>Room size (W x L)</span>
                    <span className="text-teal-400">
                      {roomWidth}m x {roomLength}m
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="range"
                      min="2"
                      max="30"
                      step="0.5"
                      value={roomWidth}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setRoomWidth(val);
                        setRoomLength(val); // maintain square room for simplicity
                      }}
                      className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-teal-400"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-zinc-400">
                    <span>Ceiling Height</span>
                    <span className="text-teal-400">{roomHeight}m</span>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="10"
                    step="0.1"
                    value={roomHeight}
                    onChange={(e) => setRoomHeight(parseFloat(e.target.value))}
                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-teal-400"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-zinc-400">
                    <span>Wall Absorption (anechoic degree)</span>
                    <span className="text-teal-400">
                      {Math.round(roomAbsorption * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.05"
                    value={roomAbsorption}
                    onChange={(e) =>
                      setRoomAbsorption(parseFloat(e.target.value))
                    }
                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-teal-400"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom panel: Buffer status */}
        {isPlaying && (
          <div className="p-4 bg-zinc-900/30 rounded-2xl border border-zinc-800/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-semibold text-zinc-300">
                Spatializer active co-working audio channel
              </span>
            </div>
            <div className="flex items-center gap-6 text-xs text-zinc-400">
              <div>
                Buffer:{" "}
                <span
                  className="font-bold"
                  style={{
                    color: status.fillLevel > 0.2 ? "#10b981" : "#ef4444",
                  }}
                >
                  {(status.fillLevel * 100).toFixed(1)}%
                </span>
              </div>
              <div>
                Underruns:{" "}
                <span
                  className="font-bold"
                  style={{
                    color: status.totalUnderruns === 0 ? "#10b981" : "#ef4444",
                  }}
                >
                  {status.totalUnderruns}
                </span>
              </div>
              <div>
                Status:{" "}
                <span className="text-zinc-300">
                  {status.isPreBuffering
                    ? "Pre-buffering..."
                    : status.totalUnderruns === 0
                      ? "Healthy"
                      : "Starvation detected"}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Error panel */}
        {error && (
          <div className="p-4 bg-red-950/30 border border-red-500 rounded-2xl text-red-400 text-xs font-medium">
            ⚠️ Setup Error: {error}
          </div>
        )}
      </div>
    </div>
  );
};

export default SpatialAudioTest;
