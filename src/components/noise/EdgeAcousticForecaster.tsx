"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Activity,
  Mic,
  MicOff,
  Volume2,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Sparkles,
  Clock,
  Coffee,
  Radio,
  RefreshCw,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  classifyAcousticSpectrum,
  type VenueNoiseForecastReport,
  type AcousticClassification,
} from "@/lib/noise/acousticForecaster";

export interface EdgeAcousticForecasterProps {
  venueId?: string;
  venueName?: string;
  className?: string;
  "data-testid"?: string;
  initialReport?: VenueNoiseForecastReport | null;
}

export function EdgeAcousticForecaster({
  venueId = "venue-sf-01",
  venueName = "Mission Focus Coworking & Cafe",
  className,
  "data-testid": testId = "edge-acoustic-forecaster",
  initialReport = null,
}: EdgeAcousticForecasterProps) {
  const [report, setReport] = useState<VenueNoiseForecastReport | null>(initialReport);
  const [loading, setLoading] = useState(!initialReport);
  const [isLiveListening, setIsLiveListening] = useState(false);
  const [liveClassification, setLiveClassification] = useState<AcousticClassification | null>(null);
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const fetchForecast = async () => {
    if (initialReport && report) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/analytics/noise-forecast?venueId=${encodeURIComponent(venueId)}`);
      const data = await res.json();
      if (data?.success && data?.report) {
        setReport(data.report);
      }
    } catch (err) {
      console.error("Failed to load noise forecast:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialReport) {
      fetchForecast();
    } else {
      setReport(initialReport);
      setLoading(false);
    }
  }, [venueId, initialReport]);

  const stopLiveListening = () => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsLiveListening(false);
    setLiveClassification(null);
  };

  // Teardown cleanup on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Live microphone FFT analysis
  const startLiveListening = async () => {
    try {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      audioContextRef.current = ctx;
      analyserRef.current = analyser;
      setIsLiveListening(true);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const processAudio = () => {
        analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = bufferLength > 0 ? sum / bufferLength : 0;
        const liveDb = Math.round(30 + (avg / 255) * 55); // map to 30-85 dB range

        const classified = classifyAcousticSpectrum(liveDb, dataArray);
        setLiveClassification(classified);

        animFrameRef.current = requestAnimationFrame(processAudio);
      };

      processAudio();
    } catch (err) {
      console.error("Mic access denied or unsupported:", err);
    }
  };

  const activeClassification = liveClassification || report?.currentClassification;

  return (
    <div
      data-testid={testId}
      className={cn("w-full max-w-5xl mx-auto space-y-6", className)}
    >
      {/* Header Banner */}
      <div
        data-testid="forecast-header-banner"
        className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 border border-indigo-500/30 p-6 md:p-8 backdrop-blur-xl shadow-2xl"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold uppercase tracking-wider">
              <Radio className="w-3.5 h-3.5 animate-pulse" /> Edge-AI Acoustic Profiler
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              24-Hour Predictive Noise Forecasting
            </h1>
            <p className="text-xs md:text-sm text-slate-300 max-w-2xl">
              On-device FFT spectral classification predicts noise levels, espresso rush hours, and video call clarity for {venueName} before you book.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {isLiveListening ? (
              <button
                type="button"
                data-testid="live-mic-btn"
                onClick={stopLiveListening}
                className="px-4 py-2.5 rounded-2xl bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-300 text-xs font-bold flex items-center gap-2 transition"
              >
                <MicOff className="w-4 h-4" /> Stop Live Mic FFT
              </button>
            ) : (
              <button
                type="button"
                data-testid="live-mic-btn"
                onClick={startLiveListening}
                className="px-4 py-2.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/30 flex items-center gap-2 transition"
              >
                <Mic className="w-4 h-4" /> Run Edge Mic Classifier
              </button>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div
          data-testid="forecast-loading-indicator"
          className="p-12 rounded-3xl bg-slate-900/40 border border-slate-800 flex flex-col items-center justify-center gap-3 text-slate-400"
        >
          <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
          <p className="text-sm">Synthesizing acoustic time-series and crowd models...</p>
        </div>
      ) : report ? (
        <div data-testid="forecast-report-container" className="space-y-6">
          {/* Main 24-Hour Forecast Bar Chart */}
          <div
            data-testid="forecast-chart-container"
            className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-5 backdrop-blur-md shadow-lg"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-400" /> 24-Hour Predictive Decibel Curve
                </h2>
                <span className="text-xs text-slate-400">Hover over hours to inspect expected noise</span>
              </div>

              {/* Legend */}
              <div className="flex items-center gap-3 text-[11px] font-mono">
                <span className="flex items-center gap-1 text-emerald-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> &lt;42 dB (Call Ready)
                </span>
                <span className="flex items-center gap-1 text-amber-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> 43-58 dB (Buzz)
                </span>
                <span className="flex items-center gap-1 text-rose-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> &gt;58 dB (Hazard)
                </span>
              </div>
            </div>

            {/* Bars Grid */}
            <div className="grid grid-cols-12 md:grid-cols-24 gap-1.5 h-44 items-end pt-4 border-b border-slate-800 pb-2">
              {Array.isArray(report.hourlyForecast) &&
                report.hourlyForecast.map((item) => {
                  const heightPct = Math.min(100, Math.max(15, ((item.predictedDecibelsDb - 25) / 55) * 100));
                  const isHovered = hoveredHour === item.hour;

                  return (
                    <div
                      key={item.hour}
                      data-testid={`forecast-hour-bar-${item.hour}`}
                      onMouseEnter={() => setHoveredHour(item.hour)}
                      onMouseLeave={() => setHoveredHour(null)}
                      className="flex flex-col items-center gap-1 h-full justify-end cursor-pointer group"
                    >
                      <div
                        className={`w-full rounded-t-lg transition-all duration-200 ${
                          item.predictedDecibelsDb < 42
                            ? "bg-emerald-500 hover:bg-emerald-400"
                            : item.predictedDecibelsDb <= 56
                            ? "bg-amber-500 hover:bg-amber-400"
                            : "bg-rose-500 hover:bg-rose-400"
                        } ${isHovered ? "ring-2 ring-white scale-105" : "opacity-80"}`}
                        style={{ height: `${heightPct}%` }}
                      />
                      <span className="text-[9px] font-mono text-slate-500 group-hover:text-white">
                        {item.hour % 3 === 0 ? item.timeLabel?.slice(0, 2) : ""}
                      </span>
                    </div>
                  );
                })}
            </div>

            {/* Peak & Quiet Windows */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
              <div
                data-testid="quiet-work-hours-badge"
                className="p-3 rounded-2xl bg-slate-950/60 border border-slate-800 flex items-center gap-2.5"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <div>
                  <span className="text-slate-500 block text-[10px]">Optimal Call Windows</span>
                  <strong className="text-emerald-300 text-xs">{report.quietestWorkHours}</strong>
                </div>
              </div>

              <div
                data-testid="peak-hazard-hours-badge"
                className="p-3 rounded-2xl bg-slate-950/60 border border-slate-800 flex items-center gap-2.5"
              >
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <div>
                  <span className="text-slate-500 block text-[10px]">Peak Rush Hazards</span>
                  <strong className="text-amber-300 text-xs">{report.peakHazardHours}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Real-time Spectral Breakdown Grid */}
          {activeClassification && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Spectral Bands Energy */}
              <div
                data-testid="spectral-bands-card"
                className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-4 backdrop-blur-md shadow-lg"
              >
                <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Zap className="w-4 h-4 text-emerald-400" /> Spectral Energy Bands
                </h3>

                <div className="space-y-3 text-xs">
                  <div className="space-y-1">
                    <div className="flex justify-between text-slate-400">
                      <span>Human Speech (250Hz - 3.5kHz)</span>
                      <strong className="text-white font-mono">{activeClassification.spectralBands?.speechBandPct ?? 0}%</strong>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-400"
                        style={{ width: `${activeClassification.spectralBands?.speechBandPct ?? 0}%` }}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-slate-400">
                      <span>Machinery / Steam (3.5k - 12kHz)</span>
                      <strong className="text-white font-mono">{activeClassification.spectralBands?.highFreqClatterPct ?? 0}%</strong>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-400"
                        style={{ width: `${activeClassification.spectralBands?.highFreqClatterPct ?? 0}%` }}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-slate-400">
                      <span>Low Rumble / HVAC (20Hz - 250Hz)</span>
                      <strong className="text-white font-mono">{activeClassification.spectralBands?.lowFreqRumblePct ?? 0}%</strong>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-400"
                        style={{ width: `${activeClassification.spectralBands?.lowFreqRumblePct ?? 0}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Dominant Classification */}
              <div
                data-testid="dominant-profile-card"
                className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-4 backdrop-blur-md shadow-lg"
              >
                <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Radio className="w-4 h-4 text-cyan-400" /> Dominant Profile
                </h3>

                <div className="space-y-2">
                  <div className="text-4xl font-black text-white font-mono">
                    {activeClassification.decibelsDb} <span className="text-sm text-slate-400">dB</span>
                  </div>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 inline-block">
                    {activeClassification.dominantCategory?.replace(/_/g, " ")}
                  </span>
                  <p className="text-xs text-slate-400 pt-1">
                    Signal-to-Noise Ratio: <strong className="text-white font-mono">{activeClassification.signalToNoiseRatioDb} dB</strong>
                  </p>
                </div>
              </div>

              {/* Call Readiness Recommendation */}
              <div
                data-testid="video-call-advisory-card"
                className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-4 backdrop-blur-md shadow-lg"
              >
                <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" /> Video Call Advisory
                </h3>

                <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 text-xs space-y-2">
                  <span className="text-xs font-bold text-emerald-400 block">
                    {activeClassification.suitability?.replace(/_/g, " ")}
                  </span>
                  <p className="text-slate-300 text-xs leading-relaxed">
                    {activeClassification.recommendation}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default EdgeAcousticForecaster;
