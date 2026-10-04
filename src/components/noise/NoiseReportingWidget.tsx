"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Volume2,
  Send,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Mic,
  Sliders,
  Square,
  Play,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { MicCalibrationWizard } from "@/components/noise/MicCalibrationWizard";
import {
  getMicCalibration,
  rmsToCalibratedDb,
  MicCalibrationProfile,
} from "@/lib/noise/calibration";
import {
  getDailyNoiseExposure,
  recordNoiseExposure,
  resetDailyNoiseExposure,
  type DailyNoiseExposureSummary,
  DOSE_WARNING_THRESHOLD,
  DOSE_DANGER_THRESHOLD,
} from "@/lib/noise/dosimeter";
import { Activity, ShieldAlert, ShieldCheck } from "lucide-react";

type Bucket = {
  key: string;
  label: string;
  averageDb: number | null;
  peakDb: number | null;
  samples: number;
};

interface NoiseReportingWidgetProps {
  venueId: string;
  venueName?: string;
  onSubmitted?: (decibels: number) => void;
}

export function NoiseReportingWidget({
  venueId,
  venueName,
  onSubmitted,
}: NoiseReportingWidgetProps) {
  const [decibels, setDecibels] = useState<number>(50);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dailyDoseSummary, setDailyDoseSummary] = useState<DailyNoiseExposureSummary | null>(null);

  const loadDailyDose = useCallback(async () => {
    try {
      const summary = await getDailyNoiseExposure();
      setDailyDoseSummary(summary);
    } catch (err) {
      console.warn("Failed to load daily noise exposure:", err);
    }
  }, []);

  useEffect(() => {
    loadDailyDose();
  }, [loadDailyDose]);

  const handleResetDose = async () => {
    try {
      await resetDailyNoiseExposure();
      await loadDailyDose();
    } catch (err) {
      console.warn("Failed to reset daily noise exposure:", err);
    }
  };

  // Calibration and Live Mic Measurement State
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [calibration, setCalibration] = useState<MicCalibrationProfile>(getMicCalibration());
  const [isLiveMeasuring, setIsLiveMeasuring] = useState(false);
  const [liveMicDb, setLiveMicDb] = useState<number | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const handleCalibrationChanged = (e: Event) => {
      const detail = (e as CustomEvent<MicCalibrationProfile>).detail;
      if (detail) setCalibration(detail);
    };
    window.addEventListener("worksphere:mic-calibration-changed", handleCalibrationChanged);
    return () => {
      window.removeEventListener("worksphere:mic-calibration-changed", handleCalibrationChanged);
    };
  }, []);

  const stopLiveMic = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setIsLiveMeasuring(false);
    setLiveMicDb(null);
  }, []);

  useEffect(() => {
    return () => {
      stopLiveMic();
    };
  }, [stopLiveMic]);

  const startLiveMic = async () => {
    try {
      stopLiveMic();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;

      const AudioCtx =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      analyserRef.current = analyser;

      setIsLiveMeasuring(true);

      const buffer = new Float32Array(analyser.fftSize);

      const sample = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getFloatTimeDomainData(buffer);
        let sumSquares = 0;
        for (let i = 0; i < buffer.length; i++) {
          sumSquares += buffer[i] * buffer[i];
        }
        const rms = Math.sqrt(sumSquares / buffer.length);
        const calibrated = rmsToCalibratedDb(rms, calibration);
        const rounded = Math.round(calibrated);
        setLiveMicDb(calibrated);
        setDecibels(rounded);

        animationFrameRef.current = requestAnimationFrame(sample);
      };

      sample();
    } catch (err) {
      console.error("Failed to start live mic measurement:", err);
      setErrorMessage("Could not access microphone for live dB measurement.");
      setIsLiveMeasuring(false);
    }
  };

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetch(
        `/api/venues/${encodeURIComponent(venueId)}/noise-metrics`,
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to load noise metrics");
      }
      if (Array.isArray(data.buckets)) {
        setBuckets(data.buckets);
      }
    } catch (err: unknown) {
      console.error("Error loading noise metrics:", err);
      setErrorMessage(err instanceof Error ? err.message : "Failed to load noise metrics");
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    if (venueId) {
      fetchMetrics();
    }
  }, [venueId, fetchMetrics]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch(
        `/api/venues/${encodeURIComponent(venueId)}/noise-metrics`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decibels }),
        },
      );

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to submit noise metric");
      }

      setSubmitted(true);
      if (Array.isArray(data.buckets)) {
        setBuckets(data.buckets);
      }
      if (onSubmitted) {
        onSubmitted(decibels);
      }
      if (isLiveMeasuring) {
        stopLiveMic();
      }
      try {
        await recordNoiseExposure(decibels, 300);
        await loadDailyDose();
      } catch (err) {
        console.warn("Failed to record exposure:", err);
      }
      setTimeout(() => setSubmitted(false), 4000);
    } catch (err: unknown) {
      console.error("Error submitting noise metric:", err);
      setErrorMessage(err instanceof Error ? err.message : "Failed to submit reading");
    } finally {
      setSubmitting(false);
    }
  };

  // Noise classification badge helpers
  const getNoiseClassification = (db: number) => {
    if (db < 45) {
      return {
        label: "Quiet (Library / Silent)",
        color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
        barColor: "#10b981",
      };
    }
    if (db <= 65) {
      return {
        label: "Moderate (Cafe Chatter)",
        color: "text-amber-400 bg-amber-500/10 border-amber-500/30",
        barColor: "#f59e0b",
      };
    }
    return {
      label: "Loud (Busy Workspace)",
      color: "text-rose-400 bg-rose-500/10 border-rose-500/30",
      barColor: "#f43f5e",
    };
  };

  const currentClassification = getNoiseClassification(decibels);

  const getBarColor = (db: number | null) => {
    if (db === null) return "#3f3f46";
    if (db < 45) return "#10b981";
    if (db <= 65) return "#f59e0b";
    return "#f43f5e";
  };

  const chartData = buckets.map((bucket) => ({
    label: bucket.label,
    db: bucket.averageDb ?? 0,
    peak: bucket.peakDb ?? 0,
    samples: bucket.samples,
    hasData: bucket.averageDb !== null,
  }));

  return (
    <div className="w-full rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/90 text-zinc-900 dark:text-zinc-100">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-blue-500/10 text-blue-500 border border-blue-500/20">
            <Volume2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-zinc-900 dark:text-white leading-tight">
              Live Noise Telemetry Report
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {venueName
                ? `Report noise levels for ${venueName}`
                : "Report current decibel reading"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Mic Calibration Wizard Trigger */}
          <button
            type="button"
            onClick={() => setIsWizardOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
            title="Open Microphone dB Calibration Wizard"
          >
            <Sliders className="w-3.5 h-3.5 text-blue-500" />
            <span className="hidden sm:inline">Calibrate Mic</span>
            {calibration.offsetDb !== 0 && (
              <span className="text-[10px] font-mono text-blue-500">
                ({calibration.offsetDb > 0 ? `+${calibration.offsetDb}` : calibration.offsetDb}dB)
              </span>
            )}
          </button>

          <button
            onClick={fetchMetrics}
            disabled={loading}
            className="p-2 text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-800 transition-colors"
            title="Refresh Data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Interactive Decibel Input Slider & Mic Auto-Measure */}
      <form onSubmit={handleSubmit} className="mb-6 space-y-4">
        <div className="bg-zinc-50 dark:bg-zinc-950/60 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <label
              htmlFor="decibel-slider"
              className="text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 flex items-center gap-1.5"
            >
              <span>Observed Decibels (dB)</span>
              {isLiveMeasuring && (
                <span className="inline-flex items-center gap-1 text-[10px] text-red-500 font-mono animate-pulse">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  Live Mic ({liveMicDb?.toFixed(1)} dB)
                </span>
              )}
            </label>
            <span
              className={`text-xs font-bold px-2.5 py-1 rounded-full border ${currentClassification.color}`}
            >
              {decibels} dB — {currentClassification.label}
            </span>
          </div>

          <input
            id="decibel-slider"
            type="range"
            min={30}
            max={90}
            step={1}
            value={decibels}
            onChange={(e) => {
              if (isLiveMeasuring) stopLiveMic();
              setDecibels(Number(e.target.value));
            }}
            className="w-full h-2 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500 focus:outline-none"
          />

          <div className="flex justify-between items-center text-[10px] text-zinc-400 font-mono">
            <span>30 dB (Quiet)</span>
            {/* Live Mic Auto-Detect Button */}
            <button
              type="button"
              onClick={isLiveMeasuring ? stopLiveMic : startLiveMic}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${
                isLiveMeasuring
                  ? "bg-red-500 text-white shadow-sm"
                  : "bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/20"
              }`}
            >
              <Mic className="w-3 h-3" />
              <span>{isLiveMeasuring ? "Stop Live Sampling" : "Auto-Measure with Mic"}</span>
            </button>
            <span>90 dB (Loud)</span>
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold uppercase tracking-wider rounded-xl shadow-lg shadow-blue-500/20 active:scale-[0.98] transition-all disabled:opacity-50"
        >
          {submitting ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          {submitting ? "Submitting Telemetry…" : "Submit Noise Update"}
        </button>

        {submitted && (
          <div className="flex items-center gap-2 p-3 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl animate-in fade-in">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>
              Noise telemetry submitted successfully! Live chart updated.
            </span>
          </div>
        )}

        {errorMessage && (
          <div className="flex items-center gap-2 p-3 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl animate-in fade-in">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
      </form>

      {/* NIOSH Daily Noise Exposure Dosimeter (24h Rolling Window) */}
      <div className="mb-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-500" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
              NIOSH Daily Noise Dose (24h Rolling)
            </h4>
          </div>
          <button
            type="button"
            onClick={handleResetDose}
            className="text-[10px] text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:underline"
            title="Reset 24h accumulated dose"
          >
            Reset 24h
          </button>
        </div>

        {(() => {
          const dose = dailyDoseSummary?.dosePercentage ?? 0;
          const isDanger = dose >= DOSE_DANGER_THRESHOLD;
          const isWarning = dose >= DOSE_WARNING_THRESHOLD && !isDanger;

          const size = 80;
          const strokeWidth = 7;
          const radius = (size - strokeWidth) / 2;
          const circumference = 2 * Math.PI * radius;
          const center = size / 2;
          const progressFraction = Math.min(1, Math.max(0, dose / 100));
          const offset = circumference * (1 - progressFraction);

          const ringColor = isDanger ? "#f43f5e" : isWarning ? "#f59e0b" : "#10b981";

          return (
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                {/* Circular Progress Ring */}
                <div
                  className="relative shrink-0 flex items-center justify-center"
                  style={{ width: size, height: size }}
                  role="progressbar"
                  aria-valuenow={Math.min(100, Math.round(dose))}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Daily Noise Dose: ${dose.toFixed(1)}%`}
                >
                  <svg width={size} height={size} className="rotate-[-90deg]">
                    <circle
                      cx={center}
                      cy={center}
                      r={radius}
                      fill="none"
                      stroke="currentColor"
                      className="text-zinc-200 dark:text-zinc-800"
                      strokeWidth={strokeWidth}
                    />
                    <circle
                      cx={center}
                      cy={center}
                      r={radius}
                      fill="none"
                      stroke={ringColor}
                      strokeWidth={strokeWidth}
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={offset}
                      className="transition-all duration-500 ease-out"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="text-xs font-bold font-mono leading-none" style={{ color: ringColor }}>
                      {dose.toFixed(0)}%
                    </span>
                    <span className="text-[9px] text-zinc-400 font-medium mt-0.5">Dose</span>
                  </div>
                </div>

                {/* Dosimetry Details & Threshold Warning */}
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    {isDanger ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/10 text-rose-500 border border-rose-500/30">
                        <ShieldAlert className="w-3 h-3 shrink-0" />
                        Danger: Daily REL Exceeded!
                      </span>
                    ) : isWarning ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/30">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        Warning: Approaching Limit (≥80%)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/30">
                        <ShieldCheck className="w-3 h-3 shrink-0" />
                        Safe Exposure (&lt;80%)
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-tight">
                    {isDanger
                      ? "Cumulative noise has exceeded the NIOSH 85 dBA recommended daily limit. Rest your ears in a quiet space."
                      : isWarning
                      ? "Noise exposure is nearing maximum recommended occupational levels. Consider moving to a quieter area."
                      : "Cumulative 24-hour acoustic exposure is well within recommended safe guidelines."}
                  </p>

                  <div className="grid grid-cols-3 gap-2 pt-1 text-[10px] text-zinc-500 dark:text-zinc-400 font-mono">
                    <div>
                      <span className="text-zinc-400 text-[9px] block">8-hr TWA</span>
                      <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                        {dailyDoseSummary?.twa ? `${dailyDoseSummary.twa} dBA` : "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-400 text-[9px] block">Avg Leq</span>
                      <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                        {dailyDoseSummary?.leq ? `${dailyDoseSummary.leq} dBA` : "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-400 text-[9px] block">Exposure</span>
                      <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                        {dailyDoseSummary?.totalExposureSeconds
                          ? `${Math.round(dailyDoseSummary.totalExposureSeconds / 60)}m`
                          : "0m"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Historic Noise Level Averages by Time of Day (Recharts Bar Chart) */}
      <div>
        <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 mb-2">
          Historic Averages by Time of Day
        </h4>

        {loading ? (
          <div className="h-44 flex items-center justify-center text-xs text-zinc-500">
            Loading noise pattern chart…
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-44 flex items-center justify-center text-xs text-zinc-500">
            No noise telemetry data available yet.
          </div>
        ) : (
          <div className="h-44 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
              >
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#888888" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  tickFormatter={(val) => `${val}dB`}
                  tick={{ fontSize: 10, fill: "#888888" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.05)" }}
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-zinc-900 border border-zinc-700 p-2.5 rounded-lg shadow-xl text-xs">
                          <p className="font-bold text-white">{data.label}</p>
                          {data.hasData ? (
                            <>
                              <p className="text-blue-400 font-medium">
                                Avg: {data.db} dB
                              </p>
                              {data.peak > 0 && (
                                <p className="text-amber-400 text-[10px]">
                                  Peak: {data.peak} dB
                                </p>
                              )}
                              <p className="text-[10px] text-zinc-400 mt-1">
                                {data.samples} sample
                                {data.samples === 1 ? "" : "s"}
                              </p>
                            </>
                          ) : (
                            <p className="text-zinc-500 italic">No samples</p>
                          )}
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="db" radius={[6, 6, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={getBarColor(entry.hasData ? entry.db : null)}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Mic Calibration Wizard Modal */}
      <MicCalibrationWizard
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        onCalibrationSaved={(newProf) => setCalibration(newProf)}
      />
    </div>
  );
}
