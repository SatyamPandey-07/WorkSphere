"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Mic,
  Square,
  Volume2,
  Settings2,
  RotateCcw,
  Waves,
} from "lucide-react";
import {
  initAudioDSP,
  startAudioProcessing,
  setSensitivity,
  resetCalibration,
} from "@/lib/wasm/audioDSPManager";

export type NoiseMeasurement = {
  averageDb: number;
  peakDb: number;
};

export const MIN_DB = 30;
export const MAX_DB = 120;

/**
 * Filter out -Infinity, NaN, null, undefined, or negative values from raw decibel inputs,
 * clamping strictly between 30 dB (whisper quiet baseline) and 120 dB (maximum safety threshold).
 */
export function sanitizeDecibel(rawDb: number | null | undefined): number {
  if (
    rawDb === null ||
    rawDb === undefined ||
    Number.isNaN(rawDb) ||
    rawDb === -Infinity
  ) {
    return MIN_DB;
  }
  if (!Number.isFinite(rawDb)) {
    return rawDb > 0 ? MAX_DB : MIN_DB;
  }
  if (rawDb < MIN_DB) {
    return MIN_DB;
  }
  if (rawDb > MAX_DB) {
    return MAX_DB;
  }
  return Math.round(rawDb * 10) / 10;
}

/**
 * Calculate needle position percentage (0% to 100%) mapped strictly across [MIN_DB, MAX_DB].
 */
export function calculateNeedlePosition(db: number): number {
  const safeDb = sanitizeDecibel(db);
  const percent = ((safeDb - MIN_DB) / (MAX_DB - MIN_DB)) * 100;
  return Math.min(100, Math.max(0, Math.round(percent * 100) / 100));
}

/**
 * Safely parse frequency data from analyser.getFloatFrequencyData(), filtering out
 * -Infinity, NaN, or anomalous values during audio track initialization.
 */
export function frequencyDataToDb(
  frequencyBins: Float32Array | number[],
): number {
  if (!frequencyBins || frequencyBins.length === 0) return MIN_DB;
  let sum = 0;
  let validCount = 0;
  for (let i = 0; i < frequencyBins.length; i++) {
    const val = frequencyBins[i];
    if (Number.isFinite(val) && !Number.isNaN(val)) {
      sum += val;
      validCount++;
    }
  }
  if (validCount === 0) return MIN_DB;
  const avgDbfs = sum / validCount;
  // Convert dBFS (typical range -100 to 0) to approximate SPL dB
  return sanitizeDecibel(avgDbfs + 100);
}

export function rmsToDb(rms: number): number {
  if (!Number.isFinite(rms) || Number.isNaN(rms) || rms <= 0.00001) {
    return MIN_DB;
  }
  const dbfs = 20 * Math.log10(rms);
  if (!Number.isFinite(dbfs) || Number.isNaN(dbfs)) {
    return MIN_DB;
  }
  return sanitizeDecibel(dbfs + 100);
}

export function getEnvironmentCategory(db: number) {
  const safeDb = sanitizeDecibel(db);
  if (safeDb < 50) {
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
  } else if (safeDb < 70) {
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

type Props = {
  onMeasured: (measurement: NoiseMeasurement) => void;
  initialDb?: number;
  initialStatus?: "idle" | "requesting" | "measuring" | "done" | "error";
};

export function EnhancedNoiseMeter({
  onMeasured,
  initialDb,
  initialStatus,
}: Props) {
  const [status, setStatus] = useState<
    "idle" | "requesting" | "measuring" | "done" | "error"
  >(initialStatus ?? "idle");
  const [remaining, setRemaining] = useState(5);
  const [liveDb, setLiveDb] = useState(initialDb ?? MIN_DB);
  const [result, setResult] = useState<NoiseMeasurement | null>(null);
  const [sensitivity, setSensitivityState] = useState(0.5);
  const [dspReady, setDspReady] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const valuesRef = useRef<number[]>([]);
  const peakRef = useRef(MIN_DB);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    initAudioDSP()
      .then(() => setDspReady(true))
      .catch(() => setDspReady(false));
    return () => {
      cleanupRef.current?.();
      if (timerRef.current) clearTimeout(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const handleSensitivityChange = useCallback((value: number) => {
    setSensitivityState(value);
    setSensitivity(value);
  }, []);

  const measure = useCallback(async () => {
    setStatus("requesting");
    setResult(null);

    try {
      if (!dspReady) {
        await initAudioDSP();
        setDspReady(true);
      }

      resetCalibration();
      valuesRef.current = [];
      peakRef.current = MIN_DB;

      let timer = 5;
      setRemaining(timer);

      const cleanup = await startAudioProcessing(
        (rms) => {
          const db = rmsToDb(rms);
          valuesRef.current.push(db);
          if (db > peakRef.current) peakRef.current = db;
          setLiveDb(db);

          const canvas = canvasRef.current;
          if (canvas) {
            const ctx = canvas.getContext("2d");
            if (ctx) {
              const width = canvas.width;
              const height = canvas.height;
              ctx.clearRect(0, 0, width, height);

              ctx.strokeStyle = "rgba(63, 63, 70, 0.2)";
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(0, height / 2);
              ctx.lineTo(width, height / 2);
              ctx.stroke();

              let strokeColor = "#10b981";
              if (db >= 70) strokeColor = "#f43f5e";
              else if (db >= 50) strokeColor = "#f59e0b";

              ctx.strokeStyle = strokeColor;
              ctx.lineWidth = 2;
              ctx.lineJoin = "round";
              ctx.beginPath();

              const samples = valuesRef.current.slice(-200);
              const sliceWidth = width / samples.length;
              let x = 0;

              for (let i = 0; i < samples.length; i++) {
                const normalizedDb = Math.min(
                  1,
                  Math.max(
                    0,
                    (sanitizeDecibel(samples[i]) - MIN_DB) / (MAX_DB - MIN_DB),
                  ),
                );
                const y = height - normalizedDb * height;

                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
                x += sliceWidth;
              }
              ctx.stroke();
            }
          }
        },
        {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      );

      cleanupRef.current = cleanup;
      setStatus("measuring");

      countdownRef.current = setInterval(() => {
        timer -= 1;
        setRemaining(Math.max(timer, 0));
      }, 1000);

      timerRef.current = setTimeout(() => {
        if (countdownRef.current) clearInterval(countdownRef.current);
        cleanup();
        cleanupRef.current = null;

        const usable = valuesRef.current
          .map((v) => sanitizeDecibel(v))
          .filter((v) => Number.isFinite(v));
        if (usable.length === 0) {
          setStatus("error");
          return;
        }

        const averageDb =
          Math.round(
            (usable.reduce((sum, v) => sum + v, 0) / usable.length) * 10,
          ) / 10;
        const peakDb = sanitizeDecibel(peakRef.current);

        const measurement = { averageDb, peakDb };
        setResult(measurement);
        setStatus("done");
        onMeasured(measurement);
      }, 5000);
    } catch (error) {
      console.error("Enhanced noise measurement failed:", error);
      setStatus("error");
    }
  }, [dspReady, onMeasured]);

  const clampedLiveDb = sanitizeDecibel(liveDb);
  const needlePercent = calculateNeedlePosition(clampedLiveDb);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60 shadow-md">
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-zinc-150 dark:border-zinc-850">
        <div>
          <p className="font-bold text-sm tracking-tight text-zinc-900 dark:text-zinc-50 uppercase flex items-center gap-1.5">
            <Waves className="w-4 h-4 text-blue-500" />
            WASM SIMD Noise Analyzer
          </p>
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            Real-time noise suppression with WebAssembly SIMD acceleration.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${dspReady ? "bg-green-500" : "bg-zinc-400"}`}
          />
          <Volume2 className="h-5 w-5 text-blue-500 shrink-0" />
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="mt-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
              Noise Gate Sensitivity
            </span>
            <span className="text-[10px] text-zinc-400">
              {(sensitivity * 100).toFixed(0)}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={sensitivity * 100}
            onChange={(e) =>
              handleSensitivityChange(Number(e.target.value) / 100)
            }
            className="w-full h-2 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <div className="flex justify-between text-[9px] text-zinc-400">
            <span>Aggressive</span>
            <span>Minimal</span>
          </div>
          <button
            onClick={() => {
              resetCalibration();
              valuesRef.current = [];
              peakRef.current = MIN_DB;
            }}
            className="flex items-center gap-1.5 text-[10px] font-bold text-blue-500 hover:text-blue-600"
          >
            <RotateCcw className="w-3 h-3" />
            Reset Calibration
          </button>
        </div>
      )}

      {status === "measuring" && (
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl shrink-0">
                {getEnvironmentCategory(clampedLiveDb).emoji}
              </span>
              <div>
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest leading-none">
                  Vibe Classification
                </p>
                <p className="text-xs font-black text-zinc-900 dark:text-zinc-50 uppercase tracking-tight mt-1">
                  {getEnvironmentCategory(clampedLiveDb).label}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-3xl font-black tracking-tighter text-zinc-900 dark:text-white leading-none">
                {clampedLiveDb.toFixed(1)}
                <span className="ml-1 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                  dB
                </span>
              </p>
            </div>
          </div>

          <div className="relative bg-zinc-950/95 dark:bg-black/95 p-3 rounded-xl border border-zinc-850 overflow-hidden flex flex-col items-center justify-center h-20 shadow-inner">
            <canvas
              ref={canvasRef}
              width={400}
              height={80}
              className="w-full h-full opacity-80"
            />
            <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-zinc-900/90 border border-zinc-850 text-[9px] font-black uppercase text-zinc-400">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span>SIMD DSP</span>
            </div>
          </div>

          {/* Real-time decibel progress gauge with ease-out needle */}
          <div className="space-y-1.5" data-testid="decibel-gauge">
            <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-zinc-400">
              <span>{MIN_DB} dB</span>
              <span>{MAX_DB} dB</span>
            </div>
            <div className="relative h-3 rounded-full bg-zinc-200 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 shadow-inner overflow-hidden">
              <div
                data-testid="meter-progress"
                className={`h-full rounded-full transition-all duration-200 ease-out ${getEnvironmentCategory(clampedLiveDb).progressBg}`}
                style={{
                  width: `${needlePercent}%`,
                  transitionTimingFunction: "ease-out",
                }}
              />
              <div
                data-testid="meter-needle"
                className="absolute top-0 bottom-0 w-1.5 -ml-0.5 rounded-full bg-white dark:bg-zinc-100 shadow-md transition-all duration-200 ease-out pointer-events-none"
                style={{
                  left: `${needlePercent}%`,
                  transitionTimingFunction: "ease-out",
                }}
              />
            </div>
          </div>

          <div className="text-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-100 dark:bg-zinc-850 px-2 py-1 rounded-md">
              Measuring... {remaining} seconds remaining
            </span>
          </div>
        </div>
      )}

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

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={measure}
          disabled={status === "requesting" || status === "measuring"}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl accent-bg px-4 py-2.5 text-sm font-black uppercase tracking-tight text-white transition accent-bg-hover disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98] shadow-md accent-shadow-sm"
        >
          {status === "measuring" ? (
            <>
              <Square className="h-4 w-4 fill-current" />
              Analyzing...
            </>
          ) : (
            <>
              <Mic className="h-4 w-4" />
              {result ? "Measure Again" : "Measure Noise"}
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => setShowSettings(!showSettings)}
          className="p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <Settings2 className="h-4 w-4 text-zinc-500" />
        </button>
      </div>

      {status === "error" && (
        <div className="mt-3 p-3 rounded-lg border border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-bold">
          Microphone access failed. Please check browser permissions and try
          again.
        </div>
      )}
    </div>
  );
}
