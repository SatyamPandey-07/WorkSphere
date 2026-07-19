"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square, Volume2 } from "lucide-react";

export type NoiseMeasurement = {
  averageDb: number;
  peakDb: number;
};

type Props = {
  onMeasured: (measurement: NoiseMeasurement) => void;
};

function rmsToApproxDb(rms: number) {
  if (rms <= 0.00001) return 20;

  const dbfs = 20 * Math.log10(rms);
  return Math.max(20, Math.min(120, Math.round((dbfs + 100) * 10) / 10));
}

// Environment classification mapping helper
function getEnvironmentCategory(db: number) {
  if (db < 50) {
    return {
      label: "Quiet Focus",
      desc: "Perfect for high-concentration work, equivalent to a quiet library.",
      color:
        "border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400",
      badgeColor:
        "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
      progressBg:
        "bg-emerald-500 dark:bg-emerald-600 shadow-[0_0_10px_rgba(16,185,129,0.5)]",
      emoji: "🍃",
    };
  } else if (db < 70) {
    return {
      label: "Ambient Cafe",
      desc: "Moderate sound level, standard coffee shop chatter and soft background music.",
      color:
        "border-amber-500/20 bg-amber-500/5 text-amber-600 dark:text-amber-400",
      badgeColor:
        "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
      progressBg:
        "bg-amber-500 dark:bg-amber-600 shadow-[0_0_10px_rgba(245,158,11,0.5)]",
      emoji: "☕",
    };
  } else {
    return {
      label: "Loud Space",
      desc: "Loud environment, busy workspace or street noise. May need noise-canceling headphones.",
      color:
        "border-rose-500/20 bg-rose-500/5 text-rose-600 dark:text-rose-400",
      badgeColor:
        "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20",
      progressBg:
        "bg-rose-500 dark:bg-rose-600 shadow-[0_0_10px_rgba(244,63,94,0.5)]",
      emoji: "🔊",
    };
  }
}

export function NoiseMeter({ onMeasured }: Props) {
  const [status, setStatus] = useState<
    "idle" | "requesting" | "measuring" | "done" | "error"
  >("idle");
  const [remaining, setRemaining] = useState(5);
  const [liveDb, setLiveDb] = useState(0);
  const [result, setResult] = useState<NoiseMeasurement | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => cleanupRef.current?.();
  }, []);

  async function measure() {
    setStatus("requesting");
    setResult(null);

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
        throw new Error("Web Audio API is not supported in this browser.");
      }

      const audioContext = new AudioContextClass();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();

      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.25;
      source.connect(analyser);

      const samples = new Float32Array(analyser.fftSize);
      const values: number[] = [];
      let animationFrame = 0;
      let timer = 5;

      const cleanup = () => {
        cancelAnimationFrame(animationFrame);
        stream.getTracks().forEach((track) => track.stop());
        audioContext.close().catch(() => {});
      };

      cleanupRef.current = cleanup;
      setStatus("measuring");
      setRemaining(timer);

      const tick = () => {
        analyser.getFloatTimeDomainData(samples);

        let sumSquares = 0;
        for (let i = 0; i < samples.length; i += 1) {
          sumSquares += samples[i] * samples[i];
        }

        const rms = Math.sqrt(sumSquares / samples.length);
        const db = rmsToApproxDb(rms);

        values.push(db);
        setLiveDb(db);

        // Waveform canvas rendering
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext("2d");
          if (ctx) {
            const width = canvas.width;
            const height = canvas.height;
            ctx.clearRect(0, 0, width, height);

            // Draw center baseline grid
            ctx.strokeStyle = "rgba(63, 63, 70, 0.2)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, height / 2);
            ctx.lineTo(width, height / 2);
            ctx.stroke();

            // Dynamic color determination based on decibel level
            let strokeColor = "#10b981"; // Quiet
            if (db >= 70) {
              strokeColor = "#f43f5e"; // Loud
            } else if (db >= 50) {
              strokeColor = "#f59e0b"; // Moderate
            }

            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 2;
            ctx.lineJoin = "round";
            ctx.beginPath();

            const sliceWidth = width / samples.length;
            let x = 0;

            for (let i = 0; i < samples.length; i++) {
              const v = samples[i] * 2.0; // gain amplifier factor
              const y = (v * height) / 2 + height / 2;

              if (i === 0) {
                ctx.moveTo(x, y);
              } else {
                ctx.lineTo(x, y);
              }

              x += sliceWidth;
            }

            ctx.lineTo(width, height / 2);
            ctx.stroke();
          }
        }

        animationFrame = requestAnimationFrame(tick);
      };

      // Small delay to ensure browser rendering context resolves canvasRef
      setTimeout(() => {
        tick();
      }, 50);

      const countdown = window.setInterval(() => {
        timer -= 1;
        setRemaining(Math.max(timer, 0));
      }, 1000);

      window.setTimeout(() => {
        window.clearInterval(countdown);
        cleanup();
        cleanupRef.current = null;

        const usable = values.filter((value) => Number.isFinite(value));

        if (usable.length === 0) {
          setStatus("error");
          return;
        }

        const averageDb =
          Math.round(
            (usable.reduce((sum, value) => sum + value, 0) / usable.length) *
              10,
          ) / 10;

        const peakDb = Math.round(Math.max(...usable) * 10) / 10;

        const measurement = { averageDb, peakDb };

        setResult(measurement);
        setStatus("done");
        onMeasured(measurement);
      }, 5000);
    } catch (error) {
      console.error("Noise measurement failed:", error);
      setStatus("error");
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60 shadow-md">
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-zinc-150 dark:border-zinc-850">
        <div>
          <p className="font-bold text-sm tracking-tight text-zinc-900 dark:text-zinc-50 uppercase">
            ⚡ Decibel Noise Monitor
          </p>
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            Measures a 5-second microphone sample. Audio is analyzed locally.
          </p>
        </div>

        <Volume2 className="h-5 w-5 text-blue-500 shrink-0" />
      </div>

      {/* Real-time measurement HUD */}
      {status === "measuring" && (
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl shrink-0">
                {getEnvironmentCategory(liveDb).emoji}
              </span>
              <div>
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest leading-none">
                  Vibe Classification
                </p>
                <p className="text-xs font-black text-zinc-900 dark:text-zinc-50 uppercase tracking-tight mt-1">
                  {getEnvironmentCategory(liveDb).label}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-3xl font-black tracking-tighter text-zinc-900 dark:text-white leading-none">
                {liveDb.toFixed(1)}
                <span className="ml-1 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                  dB
                </span>
              </p>
            </div>
          </div>

          {/* Oscilloscope canvas visualizer */}
          <div className="relative bg-zinc-950/95 dark:bg-black/95 p-3 rounded-xl border border-zinc-850 overflow-hidden flex flex-col items-center justify-center h-20 shadow-inner">
            <canvas
              ref={canvasRef}
              width={400}
              height={80}
              className="w-full h-full opacity-80"
            />
            <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-zinc-900/90 border border-zinc-800 text-[9px] font-black uppercase text-zinc-400">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span>LIVE FREQ</span>
            </div>
          </div>

          {/* Real-time decibel progress gauge */}
          <div className="space-y-1">
            <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-zinc-400">
              <span>0 dB</span>
              <span>120 dB</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 shadow-inner">
              <div
                className={`h-full rounded-full transition-all duration-75 ${getEnvironmentCategory(liveDb).progressBg}`}
                style={{
                  width: `${Math.min(100, Math.max(5, ((liveDb - 20) / 100) * 100))}%`,
                }}
              />
            </div>
          </div>

          <div className="text-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-100 dark:bg-zinc-850 px-2 py-1 rounded-md">
              ⏳ Measuring... {remaining} seconds remaining
            </span>
          </div>
        </div>
      )}

      {/* Finished state summary briefs */}
      {result && (
        <div className="mt-4 space-y-4">
          <div
            className={`p-4 rounded-2xl border-2 transition-all duration-300 flex flex-col gap-2 ${getEnvironmentCategory(result.averageDb).color}`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-2xl shrink-0">
                  {getEnvironmentCategory(result.averageDb).emoji}
                </span>
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-400 leading-none">
                    Classified Workspace Vibe
                  </h4>
                  <h3 className="text-sm font-black uppercase tracking-tight text-zinc-900 dark:text-zinc-50 mt-1.5">
                    {getEnvironmentCategory(result.averageDb).label}
                  </h3>
                </div>
              </div>
              <span
                className={`px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wider shrink-0 ${getEnvironmentCategory(result.averageDb).badgeColor}`}
              >
                {result.averageDb.toFixed(1)} dB Avg
              </span>
            </div>
            <p className="text-xs font-semibold leading-relaxed text-zinc-600 dark:text-zinc-400 mt-1">
              {getEnvironmentCategory(result.averageDb).desc}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-850 dark:bg-zinc-900 shadow-sm flex flex-col items-start gap-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                Average Level
              </span>
              <span className="text-lg font-black text-zinc-900 dark:text-zinc-50">
                {result.averageDb.toFixed(1)}{" "}
                <span className="text-xs font-bold text-zinc-500">dB</span>
              </span>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-850 dark:bg-zinc-900 shadow-sm flex flex-col items-start gap-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                Peak Level
              </span>
              <span className="text-lg font-black text-zinc-900 dark:text-zinc-50">
                {result.peakDb.toFixed(1)}{" "}
                <span className="text-xs font-bold text-zinc-500">dB</span>
              </span>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={measure}
        disabled={status === "requesting" || status === "measuring"}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-black uppercase tracking-tight text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98] shadow-md shadow-blue-500/10"
      >
        {status === "measuring" ? (
          <>
            <Square className="h-4 w-4 fill-current" />
            Analyzing sound waves...
          </>
        ) : (
          <>
            <Mic className="h-4 w-4" />
            {result ? "Measure again" : "Measure Ambient Noise"}
          </>
        )}
      </button>

      {status === "error" && (
        <div className="mt-3 p-3 rounded-lg border border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-bold">
          ⚠️ Microphone access failed. Please check browser permissions and try
          again.
        </div>
      )}
    </div>
  );
}
