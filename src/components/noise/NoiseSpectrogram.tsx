"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square, Activity } from "lucide-react";
import {
  FFT_SIZE,
  FRAME_INTERVAL_MS,
  averageDbFromFrequencyBins,
  classifyNoise,
  normalizeBinDb,
  peakDbFromFrequencyBins,
  spectrogramColor,
  type NoiseClass,
} from "@/lib/noise/fftSpectrogram";

type Status = "idle" | "requesting" | "running" | "error";

/**
 * Real-time 60fps FFT spectrum bars + rolling waterfall spectrogram
 * via WebAudio AnalyserNode (fftSize 2048).
 */
export function NoiseSpectrogram() {
  const [status, setStatus] = useState<Status>("idle");
  const [liveDb, setLiveDb] = useState(0);
  const [peakDb, setPeakDb] = useState(0);
  const [noiseClass, setNoiseClass] = useState<NoiseClass>("Quiet");

  const spectrumRef = useRef<HTMLCanvasElement | null>(null);
  const waterfallRef = useRef<HTMLCanvasElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const sessionPeakRef = useRef(20);

  useEffect(() => {
    return () => cleanupRef.current?.();
  }, []);

  const stop = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    setStatus("requesting");
    sessionPeakRef.current = 20;
    setPeakDb(20);
    setLiveDb(20);
    setNoiseClass("Quiet");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      const AudioContextClass =
        window.AudioContext ||
        (
          window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;

      if (!AudioContextClass) {
        throw new Error("Web Audio API is not supported");
      }

      const audioContext = new AudioContextClass();
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.7;
      analyser.minDecibels = -100;
      analyser.maxDecibels = -10;
      source.connect(analyser);

      const bins = new Float32Array(analyser.frequencyBinCount);
      let raf = 0;
      let lastTick: number | null = null;

      const cleanup = () => {
        cancelAnimationFrame(raf);
        try {
          source.disconnect();
        } catch {
          /* already disconnected */
        }
        try {
          analyser.disconnect();
        } catch {
          /* already disconnected */
        }
        stream.getTracks().forEach((t) => t.stop());
        if (audioContext.state !== "closed") {
          audioContext.close().catch(() => {});
        }
      };

      cleanupRef.current = cleanup;
      setStatus("running");

      const tick = (timestamp: number) => {
        if (lastTick !== null) {
          const delta = timestamp - lastTick;
          if (delta < FRAME_INTERVAL_MS) {
            raf = requestAnimationFrame(tick);
            return;
          }
          lastTick = timestamp - (delta % FRAME_INTERVAL_MS);
        } else {
          lastTick = timestamp;
        }

        analyser.getFloatFrequencyData(bins);

        const peak = peakDbFromFrequencyBins(bins);
        const avg = averageDbFromFrequencyBins(bins);
        if (peak > sessionPeakRef.current) {
          sessionPeakRef.current = peak;
        }

        setLiveDb(avg);
        setPeakDb(sessionPeakRef.current);
        setNoiseClass(classifyNoise(avg));

        drawSpectrumBars(spectrumRef.current, bins);
        drawWaterfallColumn(waterfallRef.current, bins);

        raf = requestAnimationFrame(tick);
      };

      raf = requestAnimationFrame(tick);
    } catch (err) {
      console.error("[NoiseSpectrogram] mic/analyser failed:", err);
      setStatus("error");
    }
  }, []);

  const classStyles = classBadge(noiseClass);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 shadow-md dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <div>
          <p className="text-sm font-bold uppercase tracking-tight text-zinc-900 dark:text-zinc-50">
            FFT Noise Spectrogram
          </p>
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            WebAudio AnalyserNode · fftSize {FFT_SIZE} · 60fps spectrum +
            waterfall
          </p>
        </div>
        <Activity className="h-5 w-5 shrink-0 text-sky-500" />
      </div>

      {status === "running" && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                Live level
              </p>
              <p className="text-3xl font-black tracking-tighter text-zinc-900 dark:text-white">
                {liveDb.toFixed(1)}
                <span className="ml-1 text-xs font-bold text-zinc-400">dB</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                Peak
              </p>
              <p className="text-xl font-black text-zinc-900 dark:text-zinc-50">
                {peakDb.toFixed(1)}{" "}
                <span className="text-xs font-bold text-zinc-400">dB</span>
              </p>
            </div>
            <span
              className={`rounded-lg border px-2.5 py-1 text-xs font-black uppercase tracking-wider ${classStyles}`}
            >
              {noiseClass}
            </span>
          </div>

          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
            <p className="px-3 pt-2 text-[9px] font-bold uppercase tracking-widest text-zinc-500">
              Frequency spectrum
            </p>
            <canvas
              ref={spectrumRef}
              width={640}
              height={120}
              className="block h-28 w-full"
              aria-label="Frequency spectrum bar chart"
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
            <p className="px-3 pt-2 text-[9px] font-bold uppercase tracking-widest text-zinc-500">
              Waterfall history
            </p>
            <canvas
              ref={waterfallRef}
              width={640}
              height={160}
              className="block h-40 w-full"
              aria-label="Rolling spectrogram waterfall"
            />
          </div>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        {status === "running" ? (
          <button
            type="button"
            onClick={stop}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-800 px-4 py-2.5 text-sm font-bold text-white hover:bg-zinc-700"
          >
            <Square className="h-4 w-4 fill-current" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={status === "requesting"}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl accent-bg px-4 py-2.5 text-sm font-bold uppercase tracking-tight text-white accent-bg-hover disabled:opacity-50"
          >
            <Mic className="h-4 w-4" />
            {status === "requesting" ? "Requesting mic…" : "Start spectrogram"}
          </button>
        )}
      </div>

      {status === "error" && (
        <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs font-bold text-red-600 dark:text-red-400">
          Microphone access failed. Check permissions and try again.
        </p>
      )}
    </div>
  );
}

function classBadge(noiseClass: NoiseClass): string {
  if (noiseClass === "Quiet") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-500";
  }
  if (noiseClass === "Moderate") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-500";
  }
  return "border-rose-500/30 bg-rose-500/10 text-rose-500";
}

function drawSpectrumBars(
  canvas: HTMLCanvasElement | null,
  bins: Float32Array,
): void {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { width, height } = canvas;
  ctx.fillStyle = "#09090b";
  ctx.fillRect(0, 0, width, height);

  // Skip DC; draw a subset of bins for readable bars
  const usable = bins.length - 1;
  const barCount = Math.min(96, usable);
  const step = usable / barCount;
  const gap = 1;
  const barWidth = Math.max(1, width / barCount - gap);

  for (let i = 0; i < barCount; i++) {
    const binIndex = 1 + Math.floor(i * step);
    const t = normalizeBinDb(bins[binIndex]);
    const barH = t * (height - 4);
    const x = i * (barWidth + gap);
    const y = height - barH;
    const [r, g, b] = spectrogramColor(t);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, y, barWidth, barH);
  }
}

function drawWaterfallColumn(
  canvas: HTMLCanvasElement | null,
  bins: Float32Array,
): void {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { width, height } = canvas;

  // Scroll history left by 1px
  const image = ctx.getImageData(1, 0, width - 1, height);
  ctx.putImageData(image, 0, 0);

  const col = ctx.createImageData(1, height);
  const usable = bins.length - 1;

  for (let y = 0; y < height; y++) {
    // Low frequencies at the bottom
    const binIndex =
      1 + Math.floor(((height - 1 - y) / height) * usable);
    const t = normalizeBinDb(bins[Math.min(binIndex, bins.length - 1)]);
    const [r, g, b] = spectrogramColor(t);
    const o = y * 4;
    col.data[o] = r;
    col.data[o + 1] = g;
    col.data[o + 2] = b;
    col.data[o + 3] = 255;
  }

  ctx.putImageData(col, width - 1, 0);
}
