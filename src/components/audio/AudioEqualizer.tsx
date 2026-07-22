"use client";

import { useEffect, useRef, useMemo, useId } from "react";
import { SlidersHorizontal, RotateCcw, Power } from "lucide-react";
import { useAudioEqualizer, type UseAudioEqualizerReturn } from "@/hooks/useAudioEqualizer";

const FREQ_LABELS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

function fmtFreq(hz: number): string {
  if (hz >= 1000) return `${(hz / 1000).toFixed(0)}k`;
  return String(hz);
}

export function AudioEqualizer() {
  const eq = useAudioEqualizer();
  const uid = useId();

  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60 shadow-md">
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-zinc-150 dark:border-zinc-850">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-5 w-5 text-blue-500 shrink-0" />
          <div>
            <p className="font-bold text-sm tracking-tight text-zinc-900 dark:text-zinc-50 uppercase">
              Parametric Equalizer
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              10-band WebAssembly audio equalizer
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={eq.toggleBypass}
            title={eq.state.bypass ? "Enable EQ" : "Bypass EQ"}
            className={`p-2 rounded-lg transition ${
              eq.state.bypass
                ? "bg-red-500/10 text-red-500 border border-red-500/20"
                : "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
            }`}
          >
            <Power className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={eq.resetBands}
            title="Reset to flat"
            className="p-2 rounded-lg bg-zinc-200/50 dark:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {eq.state.error && (
        <div className="mt-3 p-3 rounded-lg border border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-bold">
          {eq.state.error}
        </div>
      )}

      {!eq.state.isReady && !eq.state.error && (
        <div className="mt-8 flex items-center justify-center gap-2 text-sm text-zinc-400">
          <div className="w-4 h-4 rounded-full border-2 border-zinc-300 border-t-transparent animate-spin" />
          Initializing equalizer...
        </div>
      )}

      {eq.state.isReady && (
        <div className="mt-4 space-y-4">
          <FrequencyResponseCanvas eq={eq} />

          <div className="space-y-1.5">
            {eq.state.bands.map((band, i) => (
              <BandSlider
                key={`${uid}-band-${i}`}
                index={i}
                band={band}
                eq={eq}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FrequencyResponseCanvas({ eq }: { eq: UseAudioEqualizerReturn }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const dbRange = useMemo(() => {
    if (!eq.frequencyResponse) return { min: -12, max: 12 };
    let min = 0;
    let max = 0;
    for (let i = 0; i < eq.frequencyResponse.magnitudes.length; i++) {
      const m = eq.frequencyResponse.magnitudes[i];
      if (m < min) min = m;
      if (m > max) max = m;
    }
    const pad = Math.max(3, Math.ceil((max - min) * 0.15));
    return { min: Math.floor(min - pad), max: Math.ceil(max + pad) };
  }, [eq.frequencyResponse]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !eq.frequencyResponse) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const padL = 40;
    const padR = 10;
    const padT = 10;
    const padB = 18;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    ctx.clearRect(0, 0, width, height);

    const bg = getComputedStyle(canvas).backgroundColor || "transparent";
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const { frequencies, magnitudes } = eq.frequencyResponse;
    const { min: dbMin, max: dbMax } = dbRange;
    const dbSpan = dbMax - dbMin || 1;

    const minLog = Math.log10(20);
    const maxLog = Math.log10(20000);
    const logSpan = maxLog - minLog;

    for (let i = 0; i <= 4; i++) {
      const db = dbMin + (dbSpan * i) / 4;
      const y = padT + plotH - ((db - dbMin) / dbSpan) * plotH;
      ctx.strokeStyle = "rgba(128, 128, 128, 0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(width - padR, y);
      ctx.stroke();

      ctx.fillStyle = "rgba(128, 128, 128, 0.5)";
      ctx.font = "9px monospace";
      ctx.textAlign = "right";
      ctx.fillText(`${db > 0 ? "+" : ""}${db}dB`, padL - 4, y + 3);
    }

    for (const f of FREQ_LABELS) {
      const logF = Math.log10(f);
      const x = padL + ((logF - minLog) / logSpan) * plotW;
      ctx.strokeStyle = "rgba(128, 128, 128, 0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, height - padB);
      ctx.stroke();

      ctx.fillStyle = "rgba(128, 128, 128, 0.5)";
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(fmtFreq(f), x, height - 3);
    }

    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.beginPath();

    for (let i = 0; i < frequencies.length; i++) {
      const logF = Math.log10(frequencies[i]);
      const x = padL + ((logF - minLog) / logSpan) * plotW;
      const y = padT + plotH - ((magnitudes[i] - dbMin) / dbSpan) * plotH;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(59, 130, 246, 0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < frequencies.length; i++) {
      const logF = Math.log10(frequencies[i]);
      const x = padL + ((logF - minLog) / logSpan) * plotW;
      const y = padT + plotH - ((magnitudes[i] - dbMin) / dbSpan) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(
      padL + ((Math.log10(20000) - minLog) / logSpan) * plotW,
      padT,
    );
    ctx.lineTo(padL, padT);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(59, 130, 246, 0.8)";
    ctx.font = "8px monospace";
    ctx.textAlign = "left";
    ctx.fillText("0dB", width - padR - 30, padT + 10);
  }, [eq.frequencyResponse, dbRange]);

  return (
    <div className="bg-zinc-950/90 dark:bg-black/90 rounded-xl border border-zinc-800 overflow-hidden">
      <canvas
        ref={canvasRef}
        className="w-full h-36"
        style={{ backgroundColor: "transparent" }}
      />
    </div>
  );
}

function BandSlider({
  index,
  band,
  eq,
}: {
  index: number;
  band: { frequency: number; q: number; gain: number };
  eq: UseAudioEqualizerReturn;
}) {
  const label = fmtFreq(band.frequency);

  return (
    <div className="flex items-center gap-2">
      <span className="w-10 text-[10px] font-mono font-bold text-zinc-500 dark:text-zinc-400 shrink-0 text-right">
        {label}
      </span>
      <input
        type="range"
        min={-12}
        max={12}
        step={0.5}
        value={band.gain}
        onChange={(e) => eq.setBand(index, parseFloat(e.target.value))}
        className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer
          bg-zinc-200 dark:bg-zinc-700
          accent-blue-500
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:w-3.5
          [&::-webkit-slider-thumb]:h-3.5
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-blue-500
          [&::-webkit-slider-thumb]:shadow-md
          [&::-webkit-slider-thumb]:border-2
          [&::-webkit-slider-thumb]:border-white
          dark:[&::-webkit-slider-thumb]:border-zinc-900"
        aria-label={`${label}Hz band gain`}
      />
      <span className="w-12 text-[11px] font-mono font-bold text-right tabular-nums
        text-zinc-700 dark:text-zinc-300 shrink-0">
        {band.gain > 0 ? "+" : ""}{band.gain.toFixed(1)} dB
      </span>
      <button
        type="button"
        onClick={() => eq.setBand(index, 0)}
        className="p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition shrink-0"
        title={`Reset ${label}Hz band`}
        aria-label={`Reset ${label}Hz band to 0dB`}
      >
        <RotateCcw className="h-3 w-3" />
      </button>
    </div>
  );
}
