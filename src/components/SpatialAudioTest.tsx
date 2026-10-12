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

  // Input Gain (-40dB to +6dB) and Dynamics Compression
  const [inputGain, setInputGain] = useState(1.0); // 1.0 = 0dB
  const [peakLevel, setPeakLevel] = useState(0); // 0.0 to 1.0 peak amplitude
  const gainNodeRef = useRef<GainNode | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const peakMeterIntervalRef = useRef<number | null>(null);

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
    if (peakMeterIntervalRef.current !== null) {
      clearInterval(peakMeterIntervalRef.current);
      peakMeterIntervalRef.current = null;
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (gainNodeRef.current) {
      gainNodeRef.current.disconnect();
      gainNodeRef.current = null;
    }
    if (compressorRef.current) {
      compressorRef.current.disconnect();
      compressorRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    ringBufferRef.current = null;
    setPeakLevel(0);
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

  // Handle clamped input gain updates
  const handleGainChange = (newGain: number) => {
    // Clamp strictly between 0.01 (-40dB) and 2.0 (+6dB)
    const clamped = Math.max(0.01, Math.min(2.0, newGain));
    setInputGain(clamped);
    if (gainNodeRef.current && audioContextRef.current) {
      if (gainNodeRef.current.gain.setValueAtTime) {
        gainNodeRef.current.gain.setValueAtTime(
          clamped,
          audioContextRef.current.currentTime,
        );
      } else {
        gainNodeRef.current.gain.value = clamped;
      }
    }
  };

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

      // Create GainNode, DynamicsCompressorNode (-3dB), and AnalyserNode
      if (typeof audioCtx.createGain === "function") {
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = inputGain;
        gainNodeRef.current = gainNode;
      }

      if (typeof audioCtx.createDynamicsCompressor === "function") {
        const compressor = audioCtx.createDynamicsCompressor();
        compressor.threshold.value = -3; // -3dB threshold to prevent harsh digital clipping
        compressor.knee.value = 6;
        compressor.ratio.value = 12;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.25;
        compressorRef.current = compressor;
      }

      if (typeof audioCtx.createAnalyser === "function") {
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyserRef.current = analyser;
      }

      // Connect processing chain: gainNode -> compressor -> analyser -> destination
      if (compressorRef.current) {
        if (gainNodeRef.current) {
          gainNodeRef.current.connect(compressorRef.current);
        }
        if (analyserRef.current) {
          compressorRef.current.connect(analyserRef.current);
          analyserRef.current.connect(audioCtx.destination);
        } else {
          compressorRef.current.connect(audioCtx.destination);
        }
      } else if (gainNodeRef.current) {
        if (analyserRef.current) {
          gainNodeRef.current.connect(analyserRef.current);
          analyserRef.current.connect(audioCtx.destination);
        } else {
          gainNodeRef.current.connect(audioCtx.destination);
        }
      }

      // Start visual peak meter polling
      peakMeterIntervalRef.current = window.setInterval(() => {
        if (analyserRef.current) {
          const data = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteTimeDomainData(data);
          let maxDiff = 0;
          for (let i = 0; i < data.length; i++) {
            const diff = Math.abs(data[i] - 128) / 128;
            if (diff > maxDiff) maxDiff = diff;
          }
          setPeakLevel(Math.min(1.0, maxDiff * inputGain));
        } else {
          // Fallback synthetic amplitude scaled by input gain
          setPeakLevel(Math.min(1.0, 0.45 * inputGain));
        }
      }, 50);

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
              // Connect worklet to gain/compressor input chain
              const entryNode =
                gainNodeRef.current ||
                compressorRef.current ||
                audioCtx.destination;
              workletNode.connect(entryNode);
              console.log(
                "[SpatialAudioTest] Audio graph connected with DynamicsCompressorNode (-3dB)",
              );

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

  // Soundstage mouse dragging interactions with boundary clamping
  const handleSoundstageInteraction = (
    e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>,
  ) => {
    if (!soundstageRef.current) return;
    const rect = soundstageRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

    const xPx = clientX - (rect.left + rect.width / 2);
    const yPx = rect.top + rect.height / 2 - clientY; // standard Y is positive upwards

    const maxRadiusPx = Math.max(1, rect.width / 2);
    const maxRadiusMeters = 8.0; // represent up to 8m distance on map
    const scale = maxRadiusMeters / maxRadiusPx;

    const xMeters = xPx * scale;
    const yMeters = yPx * scale;

    // Radial distance clamping to prevent coordinate boundary drift
    const distMeters = Math.sqrt(xMeters * xMeters + yMeters * yMeters);
    let clampedX = xMeters;
    let clampedY = yMeters;
    if (distMeters > maxRadiusMeters) {
      clampedX = (xMeters / distMeters) * maxRadiusMeters;
      clampedY = (yMeters / distMeters) * maxRadiusMeters;
    }

    setSourceX(parseFloat(clampedX.toFixed(2)));
    setSourceY(parseFloat(clampedY.toFixed(2)));
  };

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // Map relative position coordinates back to screen pixels for visual display
  const mapXToPercent = (x: number) => {
    const maxRadiusMeters = 8.0;
    const clampedX = Math.max(-maxRadiusMeters, Math.min(maxRadiusMeters, x));
    return Math.max(0, Math.min(100, 50 + (clampedX / maxRadiusMeters) * 50));
  };

  const mapYToPercent = (y: number) => {
    const maxRadiusMeters = 8.0;
    const clampedY = Math.max(-maxRadiusMeters, Math.min(maxRadiusMeters, y));
    return Math.max(0, Math.min(100, 50 - (clampedY / maxRadiusMeters) * 50)); // invert back for HTML top percent
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

            {/* Input Gain & Dynamics Compressor Panel */}
            <div className="p-4 bg-zinc-900/50 rounded-2xl border border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                  Input Gain & Dynamics Limiter
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-teal-300 font-mono">
                  Compressor: -3dB
                </span>
              </div>

              {/* Input Gain Slider: clamped between 0.01 (-40dB) and 2.0 (+6dB) */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-zinc-400">
                  <span>Input Gain Slider</span>
                  <span className="text-teal-400 font-mono font-bold">
                    {inputGain >= 1.0
                      ? `+${(20 * Math.log10(inputGain)).toFixed(1)}`
                      : (20 * Math.log10(inputGain)).toFixed(1)}{" "}
                    dB ({inputGain.toFixed(2)}x)
                  </span>
                </div>
                <input
                  type="range"
                  min="0.01"
                  max="2"
                  step="0.01"
                  value={inputGain}
                  aria-label="Input Gain"
                  data-testid="input-gain-slider"
                  onChange={(e) => handleGainChange(parseFloat(e.target.value))}
                  className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-teal-400"
                />
                <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                  <span>-40 dB (0.01x)</span>
                  <span>0 dB (1.0x)</span>
                  <span>+6 dB (2.0x)</span>
                </div>
              </div>

              {/* Visual Peak Meter Indicator */}
              <div className="space-y-1 pt-1">
                <div className="flex justify-between text-xs text-zinc-400">
                  <span>Peak Output Level</span>
                  <span
                    className={`font-mono font-bold ${peakLevel >= 0.75 || inputGain > 1.4 ? "text-red-400" : "text-emerald-400"}`}
                  >
                    {isPlaying ? `${Math.round(peakLevel * 100)}%` : "0%"}
                  </span>
                </div>

                {/* Meter Bar */}
                <div
                  data-testid="peak-meter-indicator"
                  className="w-full h-2.5 bg-zinc-950 rounded-full overflow-hidden border border-zinc-800/80 p-0.5 flex items-center"
                >
                  <div
                    className={`h-full rounded-full transition-all duration-75 ${
                      peakLevel >= 0.75 || inputGain > 1.4
                        ? "bg-gradient-to-r from-emerald-500 via-amber-500 to-red-500 shadow-sm shadow-red-500/50"
                        : peakLevel >= 0.5
                          ? "bg-gradient-to-r from-emerald-500 to-amber-500"
                          : "bg-emerald-500"
                    }`}
                    style={{
                      width: `${isPlaying ? Math.max(2, Math.min(100, peakLevel * 100)) : 0}%`,
                    }}
                  />
                </div>

                {/* Warning message when signal enters red zone */}
                {(peakLevel >= 0.75 || inputGain > 1.4) && (
                  <div
                    data-testid="peak-meter-warning"
                    className="flex items-center gap-1.5 text-[11px] text-red-400 font-medium bg-red-950/40 border border-red-500/30 px-2 py-1 rounded-lg animate-pulse"
                  >
                    <span>
                      ⚠️ Warning: Signal entering red zone (-3dB threshold
                      compressing)
                    </span>
                  </div>
                )}
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
