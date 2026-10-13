"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Volume2,
  Mic,
  Square,
  Radio,
} from "lucide-react";
import {
  analyzeFrequencyBands,
  getFrequencyProfile,
  type FrequencyBandSpectrum,
} from "@/lib/noise/spectrumAnalyzer";
import { normalizeFrequencyGain } from "@/lib/noise/calibration";

export interface AmbientNoiseSpectrumVisualizerProps {
  venueId?: string;
  venueName?: string;
  noiseLevel?: string | null; // "quiet" | "moderate" | "loud" | etc.
  decibelBaseline?: number | null;
  className?: string;
}

// 24 standard 1/3 octave frequency bands (Hz)
const FREQUENCY_LABELS = [
  "32", "40", "50", "63", "80", "100", "125", "160",
  "200", "250", "315", "400", "500", "630", "800", "1k",
  "1.2k", "1.6k", "2k", "2.5k", "3.1k", "4k", "8k", "16k"
];

export function AmbientNoiseSpectrumVisualizer({
  venueId,
  venueName = "Venue",
  noiseLevel = "moderate",
  decibelBaseline,
  className = "",
}: AmbientNoiseSpectrumVisualizerProps) {
  const [isLiveMic, setIsLiveMic] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [bars, setBars] = useState<number[]>(() => new Array(24).fill(15));
  const [peaks, setPeaks] = useState<number[]>(() => new Array(24).fill(18));
  const [currentDb, setCurrentDb] = useState<number>(() => {
    if (typeof decibelBaseline === "number") return decibelBaseline;
    if (noiseLevel === "quiet") return 42;
    if (noiseLevel === "loud") return 74;
    return 56;
  });

  const [frequencySpectrum, setFrequencySpectrum] = useState<FrequencyBandSpectrum | null>(null);
  const radarCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const barsRef = useRef(bars);
  const peaksRef = useRef(peaks);
  const currentDbRef = useRef(currentDb);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const simIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Derive target average dB from venue noise level
  const targetAvgDb = useMemo(() => {
    if (typeof decibelBaseline === "number") return decibelBaseline;
    const clean = (noiseLevel || "moderate").toLowerCase();
    if (clean.includes("quiet") || clean.includes("silent")) return 42;
    if (clean.includes("loud") || clean.includes("noisy")) return 76;
    return 58;
  }, [noiseLevel, decibelBaseline]);

  // Clean up WebAudio on unmount or toggle
  const stopLiveMic = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setIsLiveMic(false);
    setMicError(null);
  }, []);

  // Start live microphone WebAudio FFT analyzer
  const startLiveMic = useCallback(async () => {
    try {
      setMicError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      mediaStreamRef.current = stream;

      const AudioCtx =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      if (!AudioCtx) {
        throw new Error("Web Audio API is not supported on this browser.");
      }

      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;
      source.connect(analyser);
      analyserRef.current = analyser;

      setIsLiveMic(true);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const renderLiveFrame = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        // Group into 24 bands
        const step = Math.max(1, Math.floor(bufferLength / 24));
        const newBars: number[] = [];
        let totalEnergy = 0;

        for (let i = 0; i < 24; i++) {
          const startIdx = i * step;
          let sum = 0;
          for (let j = 0; j < step && startIdx + j < bufferLength; j++) {
            sum += dataArray[startIdx + j];
          }
          const avgByte = sum / step;
          const normalizedPct = normalizeFrequencyGain(Math.round((avgByte / 255) * 100));
          newBars.push(normalizedPct);
          totalEnergy += avgByte;
        }

        const avgByteAll = totalEnergy / 24;
        const liveDbEst = Math.round(30 + (avgByteAll / 255) * 65);
        setCurrentDb(liveDbEst);

        setBars(newBars);
        setPeaks((prev) =>
          prev.map((p, idx) => Math.max(p * 0.95, newBars[idx] || 0)),
        );

        // Frequency band spectrum breakdown
        const spec = analyzeFrequencyBands(dataArray, audioCtx.sampleRate, analyser.fftSize);
        setFrequencySpectrum(spec);

        animFrameRef.current = requestAnimationFrame(renderLiveFrame);
      };

      animFrameRef.current = requestAnimationFrame(renderLiveFrame);
    } catch (err: any) {
      console.warn("[AmbientNoiseSpectrumVisualizer] Mic access denied:", err);
      setMicError("Microphone access unavailable. Using telemetry simulation.");
      setIsLiveMic(false);
    }
  }, []);

  // Simulated ambient acoustic spectrum when microphone is not active
  useEffect(() => {
    if (isLiveMic) return;

    const baseDb = targetAvgDb;
    const isQuiet = baseDb < 50;
    const isLoud = baseDb > 70;

    const generateSimulatedSpectrum = () => {
      const newBars: number[] = [];
      const baseHeight = (baseDb / 100) * 80;

      for (let i = 0; i < 24; i++) {
        // Natural pink-noise / acoustic curve: higher energy in low-mid vocal & bass, rolling off at high frequencies
        let bandWeight = 1.0;
        if (i < 4) bandWeight = isLoud ? 1.2 : 0.9; // Low rumble
        else if (i >= 4 && i <= 14) bandWeight = isQuiet ? 0.7 : 1.35; // Speech & cafe chatter
        else bandWeight = 0.55; // High clatter / steam

        const jitter = (Math.random() - 0.5) * 16;
        const val = Math.min(95, Math.max(8, Math.round(baseHeight * bandWeight + jitter)));
        newBars.push(val);
      }

      setBars(newBars);
      setPeaks((prev) =>
        prev.map((p, idx) => Math.max(p * 0.92, newBars[idx] || 0)),
      );

      // Synthesize 3-band breakdown
      const lowEnergy = newBars.slice(0, 6).reduce((a, b) => a + b, 0);
      const midEnergy = newBars.slice(6, 18).reduce((a, b) => a + b, 0);
      const highEnergy = newBars.slice(18).reduce((a, b) => a + b, 0);
      const sum = lowEnergy + midEnergy + highEnergy || 1;

      const lowPercentage = Math.round((lowEnergy / sum) * 100);
      const midPercentage = Math.round((midEnergy / sum) * 100);
      const highPercentage = 100 - lowPercentage - midPercentage;

      const profile = getFrequencyProfile(lowPercentage, midPercentage, highPercentage);
      setFrequencySpectrum({
        lowEnergy,
        midEnergy,
        highEnergy,
        lowPercentage,
        midPercentage,
        highPercentage,
        dominantBand: profile.dominantBand,
        profileTag: profile.tag,
        description: profile.description,
        badgeColor: profile.badgeColor,
      });

      const subtleDbJitter = Math.round(baseDb + (Math.random() - 0.5) * 4);
      setCurrentDb(subtleDbJitter);
    };

    generateSimulatedSpectrum();
    simIntervalRef.current = setInterval(generateSimulatedSpectrum, 250);

    return () => {
      if (simIntervalRef.current) {
        clearInterval(simIntervalRef.current);
      }
    };
  }, [isLiveMic, targetAvgDb]);

  useEffect(() => {
    return () => {
      stopLiveMic();
    };
  }, [stopLiveMic]);

  const getNoiseStatusLabel = (db: number) => {
    if (db < 45) return { label: "Deep Focus (Quiet)", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" };
    if (db <= 62) return { label: "Gentle Ambience (Moderate)", color: "text-teal-400 bg-teal-500/10 border-teal-500/30" };
    if (db <= 74) return { label: "Lively Workspace (Active)", color: "text-amber-400 bg-amber-500/10 border-amber-500/30" };
    return { label: "Energetic / High Energy (Loud)", color: "text-rose-400 bg-rose-500/10 border-rose-500/30" };
  };

  const status = getNoiseStatusLabel(currentDb);
  barsRef.current = bars;
  peaksRef.current = peaks;
  currentDbRef.current = currentDb;

  useEffect(() => {
    const canvas = radarCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    let frameId = 0;
    let lastFrameTime = 0;
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    const resizeObserver = new ResizeObserver(() => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(width * pixelRatio));
      canvas.height = Math.max(1, Math.round(height * pixelRatio));
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    });
    resizeObserver.observe(canvas);

    const drawRadar = (now: number) => {
      frameId = requestAnimationFrame(drawRadar);
      if (now - lastFrameTime < 1000 / 60) return;
      lastFrameTime = now;
      if (width <= 0 || height <= 0) return;

      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.max(1, Math.min(width, height) * 0.39);
      const ringLevels = [
        { db: 40, fraction: 0.34 },
        { db: 60, fraction: 0.67 },
        { db: 80, fraction: 1 },
      ];
      const barsNow = barsRef.current;
      const peaksNow = peaksRef.current;
      const dbNow = currentDbRef.current;

      context.clearRect(0, 0, width, height);
      context.fillStyle = "rgba(2, 12, 9, 0.94)";
      context.fillRect(0, 0, width, height);

      const background = context.createRadialGradient(
        centerX,
        centerY,
        radius * 0.05,
        centerX,
        centerY,
        radius * 1.2,
      );
      background.addColorStop(0, "rgba(13, 68, 44, 0.38)");
      background.addColorStop(1, "rgba(1, 10, 8, 0.05)");
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);

      context.save();
      context.translate(centerX, centerY);
      context.lineWidth = 1;
      context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";

      for (const ring of ringLevels) {
        const ringRadius = radius * ring.fraction;
        context.beginPath();
        context.arc(0, 0, ringRadius, 0, Math.PI * 2);
        context.strokeStyle = "rgba(74, 222, 128, 0.35)";
        context.setLineDash(ring.db === 60 ? [] : [3, 5]);
        context.stroke();
        context.setLineDash([]);
        context.fillStyle = "rgba(167, 243, 208, 0.78)";
        context.fillText(`${ring.db} dB`, -ringRadius + 5, -4);
      }

      context.strokeStyle = "rgba(74, 222, 128, 0.13)";
      for (let spoke = 0; spoke < 12; spoke++) {
        const angle = (spoke / 12) * Math.PI * 2 - Math.PI / 2;
        context.beginPath();
        context.moveTo(0, 0);
        context.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        context.stroke();
      }

      const measuredRadius =
        radius *
        (0.34 + ((Math.min(80, Math.max(40, dbNow)) - 40) / 40) * 0.66);
      context.beginPath();
      context.arc(0, 0, measuredRadius, 0, Math.PI * 2);
      context.strokeStyle = "rgba(134, 239, 172, 0.28)";
      context.setLineDash([2, 4]);
      context.stroke();
      context.setLineDash([]);

      const sweepAngle = (now / 4200) % (Math.PI * 2);
      const sweep = context.createLinearGradient(
        0,
        0,
        Math.cos(sweepAngle) * radius,
        Math.sin(sweepAngle) * radius,
      );
      sweep.addColorStop(0, "rgba(74, 222, 128, 0.02)");
      sweep.addColorStop(1, "rgba(74, 222, 128, 0.72)");
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(Math.cos(sweepAngle) * radius, Math.sin(sweepAngle) * radius);
      context.strokeStyle = sweep;
      context.lineWidth = 1.5;
      context.stroke();

      barsNow.forEach((level, index) => {
        const angle = (index / barsNow.length) * Math.PI * 2 - Math.PI / 2;
        const innerRadius = radius * 0.12;
        const normalizedLevel = normalizeFrequencyGain(level) / 100;
        const outerRadius = innerRadius + normalizedLevel * radius * 0.82;
        const hue = 112 + (index / barsNow.length) * 30;
        context.beginPath();
        context.moveTo(Math.cos(angle) * innerRadius, Math.sin(angle) * innerRadius);
        context.lineTo(Math.cos(angle) * outerRadius, Math.sin(angle) * outerRadius);
        context.strokeStyle = `hsla(${hue}, 95%, ${52 + normalizedLevel * 22}%, ${0.48 + normalizedLevel * 0.5})`;
        context.lineWidth = Math.max(2, (Math.PI * radius * 1.35) / barsNow.length);
        context.lineCap = "round";
        context.shadowColor = "rgba(74, 222, 128, 0.85)";
        context.shadowBlur = 4 + normalizedLevel * 12;
        context.stroke();
        const peakRadius =
          innerRadius + (normalizeFrequencyGain(peaksNow[index] ?? level) / 100) * radius * 0.82;
        context.beginPath();
        context.arc(
          Math.cos(angle) * peakRadius,
          Math.sin(angle) * peakRadius,
          1.6,
          0,
          Math.PI * 2,
        );
        context.fillStyle = "rgba(209, 250, 229, 0.9)";
        context.fill();
      });
      context.shadowBlur = 0;

      context.strokeStyle = "rgba(187, 247, 208, 0.9)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(-9, 0);
      context.lineTo(9, 0);
      context.moveTo(0, -9);
      context.lineTo(0, 9);
      context.stroke();
      context.beginPath();
      context.arc(0, 0, 3, 0, Math.PI * 2);
      context.fillStyle = "#bbf7d0";
      context.fill();
      context.restore();

      context.textAlign = "center";
      context.fillStyle = "rgba(167, 243, 208, 0.86)";
      context.font = "bold 10px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.fillText(`${dbNow} dBA`, centerX, centerY + radius * 0.16);
    };

    frameId = requestAnimationFrame(drawRadar);
    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div
      data-testid="ambient-noise-spectrum-visualizer"
      className={`p-5 bg-zinc-900/90 border border-zinc-800/80 rounded-2xl shadow-lg backdrop-blur-md transition-all ${className}`}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-zinc-800">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-pink-500/10 border border-pink-500/20 text-pink-400">
            <Volume2 className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h3 className="font-bold text-sm sm:text-base text-white flex items-center gap-2">
              <span>Ambient Noise Spectrum</span>
              {isLiveMic ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/40 animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                  Live Mic
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  <Radio className="w-3 h-3" />
                  Acoustic Telemetry
                </span>
              )}
            </h3>
            <p className="text-[11px] text-zinc-400">
              Real-time 24-band FFT frequency decibel analysis
            </p>
          </div>
        </div>

        {/* Live Mic Toggle Button */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
          <button
            type="button"
            onClick={isLiveMic ? stopLiveMic : startLiveMic}
            data-testid="toggle-live-mic-btn"
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${
              isLiveMic
                ? "bg-rose-600 text-white border-rose-500 shadow-md shadow-rose-500/20"
                : "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700"
            }`}
          >
            {isLiveMic ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop Mic</span>
              </>
            ) : (
              <>
                <Mic className="w-3.5 h-3.5 text-blue-400" />
                <span>Test Live Mic</span>
              </>
            )}
          </button>
        </div>
      </div>

      {micError && (
        <div className="mb-3 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 font-medium">
          {micError}
        </div>
      )}

      {/* Decibel & Classification Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-black/40 border border-white/5 rounded-xl p-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="text-2xl sm:text-3xl font-black text-white tracking-tight leading-none">
            {currentDb}{" "}
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
              dBA
            </span>
          </div>
          <span
            className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${status.color}`}
          >
            {status.label}
          </span>
        </div>

        {frequencySpectrum && (
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`font-semibold px-2 py-0.5 rounded-md border ${frequencySpectrum.badgeColor}`}
            >
              {frequencySpectrum.profileTag}
            </span>
          </div>
        )}
      </div>

      {/* Circular acoustic radar canvas */}
      <div className="relative flex h-64 w-full items-center justify-center overflow-hidden rounded-xl border border-emerald-500/20 bg-[#020c09] sm:h-80">
        <canvas
          ref={radarCanvasRef}
          role="img"
          aria-label={`360-degree ambient noise radar. ${currentDb} decibels A-weighted. ${status.label}. Concentric reference rings at 40, 60, and 80 decibels.`}
          className="h-full w-full"
        />
        <div className="pointer-events-none absolute inset-x-3 top-3 flex items-center justify-between">
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-200/70">
            360° Acoustic Radar
          </span>
          <span className={`rounded-md border px-2 py-1 text-[10px] font-bold ${status.color}`}>
            {status.label}
          </span>
        </div>
        <div className="pointer-events-none absolute inset-x-3 bottom-2 flex justify-between font-mono text-[9px] uppercase tracking-wider text-emerald-100/45">
          <span>Low · 32 Hz</span>
          <span>Mid · 1 kHz</span>
          <span>High · 16 kHz</span>
        </div>
      </div>

      {/* 3-Band Acoustic Distribution Summary */}
      {frequencySpectrum && (
        <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-zinc-800/80 text-center">
          <div className="p-2 bg-purple-500/5 border border-purple-500/15 rounded-xl">
            <span className="block text-[10px] font-bold text-purple-400 uppercase tracking-wider">
              Low (20-250Hz)
            </span>
            <span className="text-sm font-black text-white">
              {frequencySpectrum.lowPercentage}%
            </span>
            <span className="block text-[9px] text-zinc-400">Bass &amp; HVAC</span>
          </div>

          <div className="p-2 bg-teal-500/5 border border-teal-500/15 rounded-xl">
            <span className="block text-[10px] font-bold text-teal-400 uppercase tracking-wider">
              Mid (250-4kHz)
            </span>
            <span className="text-sm font-black text-white">
              {frequencySpectrum.midPercentage}%
            </span>
            <span className="block text-[9px] text-zinc-400">Speech &amp; Vocals</span>
          </div>

          <div className="p-2 bg-cyan-500/5 border border-cyan-500/15 rounded-xl">
            <span className="block text-[10px] font-bold text-cyan-400 uppercase tracking-wider">
              High (4k-20kHz)
            </span>
            <span className="text-sm font-black text-white">
              {frequencySpectrum.highPercentage}%
            </span>
            <span className="block text-[9px] text-zinc-400">Clatter &amp; Hiss</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default AmbientNoiseSpectrumVisualizer;
