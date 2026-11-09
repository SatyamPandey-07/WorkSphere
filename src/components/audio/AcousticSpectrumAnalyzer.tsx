"use client";

import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import {
  Play,
  Pause,
  Maximize2,
  Minimize2,
  Mic,
  MicOff,
  RotateCcw,
  X,
  Activity,
  Volume2,
  Sliders,
} from "lucide-react";

export const NUM_FREQUENCY_BARS = 32;

// Standard 32 acoustic frequency bands (Hz) spanning audible spectrum (20 Hz - 20 kHz)
export const FREQUENCY_BANDS_32 = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630,
  800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000,
  12500, 16000, 18000, 20000,
];

// Display labels for key anchor frequency bands
export const FREQUENCY_ANCHOR_LABELS: Record<number, string> = {
  0: "20",
  2: "31",
  5: "63",
  8: "125",
  11: "250",
  14: "500",
  17: "1k",
  20: "2k",
  23: "4k",
  26: "8k",
  29: "16k",
  31: "20k",
};

export interface AcousticSpectrumAnalyzerProps {
  analyserNode?: AnalyserNode | null;
  fftData?: Uint8Array | Float32Array;
  audioContext?: AudioContext | null;
  minDecibels?: number; // e.g. -70 dB
  maxDecibels?: number; // e.g. -10 dB or 0 dB
  peakDecayRateDbPerSec?: number; // Exactly 20 dB/sec by specification
  width?: number;
  height?: number;
  title?: string;
  showLabels?: boolean;
  showGrid?: boolean;
  showDbScale?: boolean;
  enableMicInput?: boolean;
  className?: string;
  onPauseChange?: (isPaused: boolean) => void;
  onExpandChange?: (isExpanded: boolean) => void;
}

export function AcousticSpectrumAnalyzer({
  analyserNode,
  fftData,
  audioContext,
  minDecibels = -70,
  maxDecibels = 0,
  peakDecayRateDbPerSec = 20, // 20 dB/sec decay
  width,
  height = 240,
  title = "Acoustic Spectrum Analyzer",
  showLabels = true,
  showGrid = true,
  showDbScale = true,
  enableMicInput = true,
  className = "",
  onPauseChange,
  onExpandChange,
}: AcousticSpectrumAnalyzerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modalCanvasRef = useRef<HTMLCanvasElement>(null);
  const modalContainerRef = useRef<HTMLDivElement>(null);

  const [isPaused, setIsPaused] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  // Stats for readouts
  const [activePeakFrequency, setActivePeakFrequency] = useState<number>(1000);
  const [activePeakDb, setActivePeakDb] = useState<number>(-60);

  // Internal Web Audio refs for live microphone capture
  const internalAudioCtxRef = useRef<AudioContext | null>(null);
  const internalAnalyserRef = useRef<AnalyserNode | null>(null);
  const internalMicStreamRef = useRef<MediaStream | null>(null);

  // Peak hold state for 32 bands in decibels (initialized to minDecibels)
  const peakDbValuesRef = useRef<Float32Array>(new Float32Array(NUM_FREQUENCY_BARS).fill(minDecibels));
  const currentDbValuesRef = useRef<Float32Array>(new Float32Array(NUM_FREQUENCY_BARS).fill(minDecibels));
  const lastFrameTimeRef = useRef<number>(performance.now());
  const animationFrameIdRef = useRef<number | null>(null);

  // Synthetic frequency phase tracker for demo mode
  const syntheticPhaseRef = useRef<number>(0);

  const dynamicRange = useMemo(() => {
    return Math.max(1, maxDecibels - minDecibels);
  }, [maxDecibels, minDecibels]);

  // Pause toggle
  const togglePause = useCallback(() => {
    setIsPaused((prev) => {
      const next = !prev;
      onPauseChange?.(next);
      return next;
    });
  }, [onPauseChange]);

  // Expand modal toggle
  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => {
      const next = !prev;
      onExpandChange?.(next);
      return next;
    });
  }, [onExpandChange]);

  // Reset peak hold values
  const resetPeaks = useCallback(() => {
    peakDbValuesRef.current.fill(minDecibels);
  }, [minDecibels]);

  // Microphone toggle
  const toggleMicrophone = useCallback(async () => {
    if (isMicActive) {
      // Disconnect mic
      if (internalMicStreamRef.current) {
        internalMicStreamRef.current.getTracks().forEach((track) => track.stop());
        internalMicStreamRef.current = null;
      }
      if (internalAudioCtxRef.current && internalAudioCtxRef.current.state !== "closed") {
        await internalAudioCtxRef.current.close().catch(() => {});
        internalAudioCtxRef.current = null;
      }
      internalAnalyserRef.current = null;
      setIsMicActive(false);
      setMicError(null);
    } else {
      // Connect mic
      try {
        setMicError(null);
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });

        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.75;
        analyser.minDecibels = minDecibels;
        analyser.maxDecibels = maxDecibels;

        source.connect(analyser);

        internalMicStreamRef.current = stream;
        internalAudioCtxRef.current = ctx;
        internalAnalyserRef.current = analyser;
        setIsMicActive(true);
      } catch (err: any) {
        setMicError(err?.message || "Microphone access denied");
        setIsMicActive(false);
      }
    }
  }, [isMicActive, minDecibels, maxDecibels]);

  // Keyboard shortcut listener (Space = pause/resume, F = fullscreen, Esc = close modal)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        togglePause();
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleExpand();
      } else if (e.key === "Escape" && isExpanded) {
        e.preventDefault();
        setIsExpanded(false);
        onExpandChange?.(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePause, toggleExpand, isExpanded, onExpandChange]);

  // Cleanup internal mic on unmount
  useEffect(() => {
    return () => {
      if (internalMicStreamRef.current) {
        internalMicStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (internalAudioCtxRef.current && internalAudioCtxRef.current.state !== "closed") {
        internalAudioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  /**
   * Main render loop for the 32 frequency bars and floating peak hold decay.
   */
  const renderFrame = useCallback(
    (now: number) => {
      const activeCanvas = isExpanded ? modalCanvasRef.current : canvasRef.current;
      if (!activeCanvas) {
        animationFrameIdRef.current = requestAnimationFrame(renderFrame);
        return;
      }

      const ctx = activeCanvas.getContext("2d");
      if (!ctx) {
        animationFrameIdRef.current = requestAnimationFrame(renderFrame);
        return;
      }

      // Compute elapsed delta time in seconds
      const deltaSec = Math.min(0.1, Math.max(0.001, (now - lastFrameTimeRef.current) / 1000));
      lastFrameTimeRef.current = now;

      // Handle retina / high-DPI scaling
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const displayWidth = activeCanvas.clientWidth || 600;
      const displayHeight = activeCanvas.clientHeight || height;

      const physicalWidth = Math.floor(displayWidth * dpr);
      const physicalHeight = Math.floor(displayHeight * dpr);

      if (activeCanvas.width !== physicalWidth || activeCanvas.height !== physicalHeight) {
        activeCanvas.width = physicalWidth;
        activeCanvas.height = physicalHeight;
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      const w = displayWidth;
      const h = displayHeight;

      // Determine active audio data source
      const activeAnalyser = internalAnalyserRef.current || analyserNode;
      const instantaneousDb = new Float32Array(NUM_FREQUENCY_BARS);

      if (!isPaused) {
        if (activeAnalyser) {
          const bufferLength = activeAnalyser.frequencyBinCount;
          const frequencyData = new Float32Array(bufferLength);
          activeAnalyser.getFloatFrequencyData(frequencyData);

          const sampleRate = (audioContext || internalAudioCtxRef.current)?.sampleRate || 44100;
          const nyquist = sampleRate / 2;

          for (let i = 0; i < NUM_FREQUENCY_BARS; i++) {
            const centerFreq = FREQUENCY_BANDS_32[i];
            const lowerFreq = i === 0 ? 20 : (FREQUENCY_BANDS_32[i - 1] + centerFreq) / 2;
            const upperFreq =
              i === NUM_FREQUENCY_BARS - 1
                ? 20000
                : (centerFreq + FREQUENCY_BANDS_32[i + 1]) / 2;

            const startBin = Math.max(0, Math.floor((lowerFreq / nyquist) * bufferLength));
            const endBin = Math.min(bufferLength - 1, Math.ceil((upperFreq / nyquist) * bufferLength));

            let maxVal = -160;
            for (let bin = startBin; bin <= endBin; bin++) {
              if (frequencyData[bin] > maxVal) {
                maxVal = frequencyData[bin];
              }
            }

            instantaneousDb[i] = Number.isFinite(maxVal) ? Math.max(minDecibels, maxVal) : minDecibels;
          }
        } else if (fftData && fftData.length > 0) {
          const step = Math.max(1, Math.floor(fftData.length / NUM_FREQUENCY_BARS));
          for (let i = 0; i < NUM_FREQUENCY_BARS; i++) {
            const rawVal = fftData[Math.min(fftData.length - 1, i * step)];
            // Map 0-255 uint8 to minDecibels - maxDecibels
            const normalized = rawVal / 255;
            instantaneousDb[i] = minDecibels + normalized * dynamicRange;
          }
        } else {
          // Synthetic acoustic room simulation (organic pink noise + room harmonics)
          syntheticPhaseRef.current += deltaSec * 2.5;
          const phase = syntheticPhaseRef.current;

          for (let i = 0; i < NUM_FREQUENCY_BARS; i++) {
            const freq = FREQUENCY_BANDS_32[i];
            // Pink noise 1/f spectral tilt
            const tilt = -10 * Math.log10(Math.max(1, freq / 100));

            // Dynamic oscillating acoustic harmonics
            const wave1 = Math.sin(phase * 1.2 + i * 0.4) * 8;
            const wave2 = Math.cos(phase * 2.1 - i * 0.6) * 5;
            const wave3 = Math.sin(phase * 0.5 + i * 0.2) * 6;
            const randomNoise = (Math.random() - 0.5) * 4;

            // Voice frequency emphasis around 500Hz - 2.5kHz
            const voiceBoost = freq >= 250 && freq <= 3000 ? 12 : 0;

            const simDb = -35 + tilt + wave1 + wave2 + wave3 + randomNoise + voiceBoost;
            instantaneousDb[i] = Math.max(minDecibels, Math.min(maxDecibels - 2, simDb));
          }
        }

        // Apply 20 dB/sec decay to floating peaks and update current bars
        let maxPeakValue = minDecibels;
        let maxPeakIndex = 0;

        for (let i = 0; i < NUM_FREQUENCY_BARS; i++) {
          const current = instantaneousDb[i];
          currentDbValuesRef.current[i] = current;

          const prevPeak = peakDbValuesRef.current[i];
          if (current >= prevPeak) {
            // Instantaneous attack on rise
            peakDbValuesRef.current[i] = current;
          } else {
            // Drop smoothly at exactly 20 dB/sec
            const decayed = prevPeak - peakDecayRateDbPerSec * deltaSec;
            peakDbValuesRef.current[i] = Math.max(minDecibels, decayed);
          }

          if (peakDbValuesRef.current[i] > maxPeakValue) {
            maxPeakValue = peakDbValuesRef.current[i];
            maxPeakIndex = i;
          }
        }

        setActivePeakFrequency(FREQUENCY_BANDS_32[maxPeakIndex]);
        setActivePeakDb(Math.round(maxPeakValue));
      }

      // --- CLEAR CANVAS ---
      ctx.clearRect(0, 0, w, h);

      // Deep cyber dark acoustic background
      ctx.fillStyle = "#07070a";
      ctx.fillRect(0, 0, w, h);

      // Bottom baseline space for frequency labels
      const labelHeight = showLabels ? 24 : 8;
      const leftScaleWidth = showDbScale ? 36 : 8;
      const rightPadding = 12;

      const chartX = leftScaleWidth;
      const chartY = 12;
      const chartWidth = Math.max(10, w - chartX - rightPadding);
      const chartHeight = Math.max(10, h - chartY - labelHeight);

      // --- DRAW DB GRID LINES ---
      if (showGrid) {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);

        const dbSteps = [0, -12, -24, -36, -48, -60];
        for (const db of dbSteps) {
          if (db < minDecibels || db > maxDecibels) continue;
          const normY = (maxDecibels - db) / dynamicRange;
          const y = chartY + normY * chartHeight;

          ctx.beginPath();
          ctx.moveTo(chartX, y);
          ctx.lineTo(chartX + chartWidth, y);
          ctx.stroke();

          if (showDbScale) {
            ctx.fillStyle = "rgba(148, 163, 184, 0.6)"; // slate-400
            ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
            ctx.textAlign = "right";
            ctx.textBaseline = "middle";
            ctx.fillText(`${db}dB`, chartX - 4, y);
          }
        }
        ctx.setLineDash([]);
      }

      // --- DRAW 32 FREQUENCY BARS & FLOATING PEAK DECAY INDICATORS ---
      const totalBarSpace = chartWidth;
      const gap = Math.max(1.5, Math.floor(totalBarSpace / (NUM_FREQUENCY_BARS * 6)));
      const barWidth = Math.max(2, (totalBarSpace - gap * (NUM_FREQUENCY_BARS - 1)) / NUM_FREQUENCY_BARS);

      for (let i = 0; i < NUM_FREQUENCY_BARS; i++) {
        const barX = chartX + i * (barWidth + gap);

        // Normalize bar height (0 at minDecibels, 1 at maxDecibels)
        const currentDb = currentDbValuesRef.current[i];
        const barNorm = Math.max(0, Math.min(1, (currentDb - minDecibels) / dynamicRange));
        const barHeight = Math.max(2, barNorm * chartHeight);
        const barY = chartY + chartHeight - barHeight;

        // Peak normalization
        const peakDb = peakDbValuesRef.current[i];
        const peakNorm = Math.max(0, Math.min(1, (peakDb - minDecibels) / dynamicRange));
        const peakY = chartY + chartHeight - peakNorm * chartHeight;

        // 1. NEON GREEN-TO-CYAN GRADIENT SHADING
        const barGradient = ctx.createLinearGradient(0, chartY + chartHeight, 0, chartY);
        // Base: Neon Green
        barGradient.addColorStop(0, "rgba(16, 185, 129, 0.85)"); // emerald-500
        barGradient.addColorStop(0.3, "rgba(0, 240, 160, 0.9)"); // vibrant neon green
        // Mid-to-Top: Neon Cyan
        barGradient.addColorStop(0.7, "rgba(6, 182, 212, 0.95)"); // cyan-500
        barGradient.addColorStop(1, "rgba(0, 240, 255, 1.0)"); // glowing electric cyan

        ctx.fillStyle = barGradient;

        // Draw bar with slight top rounded corners if supported
        const cornerRadius = Math.min(3, barWidth / 2);
        if (typeof ctx.roundRect === "function") {
          ctx.beginPath();
          ctx.roundRect(barX, barY, barWidth, barHeight, [cornerRadius, cornerRadius, 0, 0]);
          ctx.fill();
        } else {
          ctx.fillRect(barX, barY, barWidth, barHeight);
        }

        // Horizontal Segment Lines for acoustic visualizer styling
        ctx.fillStyle = "rgba(7, 7, 10, 0.4)";
        const segmentGap = 4;
        for (let segY = chartY + chartHeight; segY > barY; segY -= segmentGap) {
          ctx.fillRect(barX, segY, barWidth, 1);
        }

        // 2. FLOATING PEAK HOLD DECAY INDICATORS (Neon Cyan / Overdrive White Cap)
        if (peakNorm > 0.02) {
          const capHeight = 2.5;
          const capY = Math.max(chartY, Math.min(chartY + chartHeight - capHeight, peakY - capHeight));

          // Neon glowing cyan peak cap
          ctx.shadowColor = "#00f0ff";
          ctx.shadowBlur = 6;
          ctx.fillStyle = peakNorm > 0.85 ? "#ffffff" : "#22d3ee"; // Overdrive white at top, cyan below
          ctx.fillRect(barX, capY, barWidth, capHeight);

          // Reset shadow
          ctx.shadowBlur = 0;
        }

        // 3. FREQUENCY LABELS
        if (showLabels) {
          const anchorText = FREQUENCY_ANCHOR_LABELS[i];
          if (anchorText) {
            ctx.fillStyle = "rgba(161, 161, 170, 0.7)"; // zinc-400
            ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillText(anchorText, barX + barWidth / 2, chartY + chartHeight + 6);
          }
        }
      }

      // --- PAUSED OVERLAY WATERMARK ---
      if (isPaused) {
        ctx.fillStyle = "rgba(7, 7, 10, 0.65)";
        ctx.fillRect(chartX, chartY, chartWidth, chartHeight);

        ctx.fillStyle = "rgba(244, 63, 94, 0.9)"; // rose-500
        ctx.font = "bold 13px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("PAUSED", chartX + chartWidth / 2, chartY + chartHeight / 2);
      }

      ctx.restore();

      animationFrameIdRef.current = requestAnimationFrame(renderFrame);
    },
    [
      isExpanded,
      height,
      minDecibels,
      maxDecibels,
      peakDecayRateDbPerSec,
      dynamicRange,
      analyserNode,
      fftData,
      audioContext,
      showGrid,
      showDbScale,
      showLabels,
      isPaused,
    ],
  );

  // Start / maintain RAF loop
  useEffect(() => {
    lastFrameTimeRef.current = performance.now();
    animationFrameIdRef.current = requestAnimationFrame(renderFrame);

    return () => {
      if (animationFrameIdRef.current !== null) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, [renderFrame]);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Acoustic spectrum analyzer visualizer"
      data-testid="acoustic-spectrum-analyzer"
      className={`relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-[#07070a] shadow-xl text-white ${className}`}
    >
      {/* Header Controls Bar */}
      <div className="flex flex-wrap items-center justify-between border-b border-white/10 px-4 py-3 bg-white/[0.02]">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                isPaused ? "bg-amber-400" : "bg-cyan-400"
              }`}
            />
            <span
              className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                isPaused ? "bg-amber-500" : "bg-cyan-400"
              }`}
            />
          </span>

          <h3 className="text-sm font-semibold tracking-wide text-zinc-100 flex items-center gap-1.5">
            <Activity className="h-4 w-4 text-cyan-400" />
            {title}
          </h3>

          <span
            data-testid="spectrum-bars-badge"
            className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] text-cyan-300 font-medium"
          >
            32 BANDS
          </span>

          <span
            data-testid="spectrum-decay-badge"
            title="Floating Peak Hold Decay Rate"
            className="hidden sm:inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-300 font-medium"
          >
            20 dB/s DECAY
          </span>
        </div>

        {/* Real-time stats & controls */}
        <div className="flex items-center gap-2">
          {/* Active Peak Readout */}
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-white/5 bg-white/[0.03] text-xs font-mono text-zinc-300">
            <span className="text-zinc-500">PEAK:</span>
            <span className="text-cyan-300 font-semibold">{activePeakFrequency}Hz</span>
            <span className="text-zinc-500">|</span>
            <span className="text-emerald-300 font-semibold">{activePeakDb} dB</span>
          </div>

          {/* Microphone Live Toggle */}
          {enableMicInput && (
            <button
              type="button"
              data-testid="spectrum-mic-button"
              onClick={toggleMicrophone}
              title={isMicActive ? "Mute Microphone Input" : "Capture Live Microphone Audio"}
              className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all ${
                isMicActive
                  ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]"
                  : "border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10"
              }`}
            >
              {isMicActive ? <Mic className="h-3.5 w-3.5 text-emerald-400" /> : <MicOff className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{isMicActive ? "Mic Live" : "Mic"}</span>
            </button>
          )}

          {/* Reset Peaks */}
          <button
            type="button"
            data-testid="spectrum-reset-peaks-button"
            onClick={resetPeaks}
            title="Reset peak hold indicators"
            className="flex items-center rounded-lg border border-white/10 bg-white/5 p-1.5 text-zinc-300 hover:bg-white/10 active:scale-95 transition-all"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>

          {/* Pause / Resume Button */}
          <button
            type="button"
            data-testid="spectrum-pause-button"
            onClick={togglePause}
            title={isPaused ? "Resume visualizer (Space)" : "Pause visualizer (Space)"}
            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all ${
              isPaused
                ? "border-amber-500/40 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
                : "border-cyan-500/40 bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30"
            }`}
          >
            {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            <span>{isPaused ? "Resume" : "Pause"}</span>
          </button>

          {/* Expand Fullscreen Modal Button */}
          <button
            type="button"
            data-testid="spectrum-expand-button"
            onClick={toggleExpand}
            title="Expand to Full-Screen Modal (F)"
            className="flex items-center rounded-lg border border-white/10 bg-white/5 p-1.5 text-zinc-300 hover:bg-white/10 active:scale-95 transition-all"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {micError && (
        <div className="bg-rose-500/10 border-b border-rose-500/20 px-4 py-1.5 text-xs text-rose-300 flex items-center justify-between">
          <span>Microphone notice: {micError}</span>
          <button type="button" onClick={() => setMicError(null)} className="text-rose-400 hover:text-white">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Main 2D Canvas Viewport */}
      <div className="relative w-full p-2" style={{ height: `${height}px` }}>
        <canvas
          ref={canvasRef}
          data-testid="acoustic-spectrum-canvas"
          className="h-full w-full rounded-xl block"
          style={{ width: "100%", height: "100%" }}
        />
      </div>

      {/* Footer Info / Legend Bar */}
      <div className="flex items-center justify-between border-t border-white/5 px-4 py-2 bg-black/40 text-[11px] text-zinc-500 font-mono">
        <span className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-[#00f0ff]" />
          <span>Neon Cyan Peak Crests</span>
          <span className="inline-block h-2 w-2 rounded-full bg-[#10b981] ml-2" />
          <span>Neon Green Base</span>
        </span>
        <span className="hidden sm:inline">20 Hz – 20 kHz • 20 dB/s Smooth Decay</span>
      </div>

      {/* FULL-SCREEN EXPANSION MODAL */}
      {isExpanded && (
        <div
          data-testid="spectrum-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Full-screen acoustic spectrum analyzer"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsExpanded(false);
              onExpandChange?.(false);
            }
          }}
          className="fixed inset-0 z-50 flex flex-col bg-[#07070a]/95 backdrop-blur-xl p-4 md:p-8 animate-in fade-in duration-200"
        >
          {/* Modal Header */}
          <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-4">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-400" />
              </span>

              <div>
                <h2 className="text-lg md:text-xl font-bold tracking-tight text-white flex items-center gap-2">
                  <Activity className="h-5 w-5 text-cyan-400" />
                  {title} — Full Screen View
                </h2>
                <p className="text-xs text-zinc-400">
                  High-fidelity 32-band acoustic spectrum with 20 dB/sec floating peak decay
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Modal Peak Readout */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 text-sm font-mono text-zinc-200">
                <span className="text-zinc-500">DOMINANT:</span>
                <span className="text-cyan-400 font-bold">{activePeakFrequency} Hz</span>
                <span className="text-zinc-500">@</span>
                <span className="text-emerald-400 font-bold">{activePeakDb} dB</span>
              </div>

              {/* Pause in Modal */}
              <button
                type="button"
                data-testid="spectrum-modal-pause-button"
                onClick={togglePause}
                className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-1.5 text-xs font-semibold transition-all ${
                  isPaused
                    ? "border-amber-500/40 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
                    : "border-cyan-500/40 bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30"
                }`}
              >
                {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                <span>{isPaused ? "Resume" : "Pause"}</span>
              </button>

              {/* Close Modal Button */}
              <button
                type="button"
                data-testid="spectrum-modal-close"
                onClick={() => {
                  setIsExpanded(false);
                  onExpandChange?.(false);
                }}
                title="Exit Full Screen (Esc)"
                className="flex items-center gap-1 rounded-xl border border-white/20 bg-white/10 p-2 text-zinc-200 hover:bg-white/20 active:scale-95 transition-all"
              >
                <Minimize2 className="h-4 w-4" />
                <span className="text-xs font-medium hidden sm:inline">Exit</span>
              </button>
            </div>
          </div>

          {/* Expanded Modal Canvas */}
          <div ref={modalContainerRef} className="relative flex-1 w-full min-h-[350px]">
            <canvas
              ref={modalCanvasRef}
              data-testid="acoustic-spectrum-modal-canvas"
              className="h-full w-full rounded-2xl block"
              style={{ width: "100%", height: "100%" }}
            />
          </div>

          {/* Modal Footer Controls & Keybindings */}
          <div className="flex flex-wrap items-center justify-between border-t border-white/10 pt-4 mt-4 text-xs font-mono text-zinc-400">
            <div className="flex items-center gap-4">
              <span>Dynamic Range: {minDecibels} dB to {maxDecibels} dB</span>
              <span>Decay: {peakDecayRateDbPerSec} dB/sec</span>
              <span>Bands: 32 vertical log-spaced</span>
            </div>
            <div className="flex items-center gap-3 text-zinc-500">
              <span>[Space] Pause / Resume</span>
              <span>[F / Esc] Toggle Modal</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AcousticSpectrumAnalyzer;
