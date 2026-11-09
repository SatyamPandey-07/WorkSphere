"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  Volume2,
  VolumeX,
  AlertTriangle,
  X,
  Sparkles,
  ArrowRight,
  Mic,
  Square,
  Bell,
  BellOff,
} from "lucide-react";
import { getMicCalibration, rmsToCalibratedDb } from "@/lib/noise/calibration";

export interface NoiseSample {
  timestamp: number;
  db: number;
}

export interface NoiseMonitorProps {
  thresholdDb?: number;
  windowSeconds?: number;
  initialDb?: number;
  onAlertTriggered?: (avgDb: number) => void;
  quietSearchUrl?: string;
  alertsEnabled?: boolean;
  onAlertsEnabledChange?: (enabled: boolean) => void;
}

export function NoiseMonitor({
  thresholdDb = 75,
  windowSeconds = 5,
  initialDb = 45,
  onAlertTriggered,
  quietSearchUrl = "/?vibe=quiet",
  alertsEnabled: initialAlertsEnabled = true,
  onAlertsEnabledChange,
}: NoiseMonitorProps) {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [currentDb, setCurrentDb] = useState(initialDb);
  const [samples, setSamples] = useState<NoiseSample[]>([]);
  const [alertsEnabled, setAlertsEnabled] = useState(initialAlertsEnabled);
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [alertDismissedTimestamp, setAlertDismissedTimestamp] = useState<
    number | null
  >(null);

  useEffect(() => {
    setAlertsEnabled(initialAlertsEnabled);
  }, [initialAlertsEnabled]);

  const handleToggleAlerts = useCallback(() => {
    setAlertsEnabled((prev) => {
      const next = !prev;
      onAlertsEnabledChange?.(next);
      if (!next) {
        setAlertDismissed(true);
      }
      return next;
    });
  }, [onAlertsEnabledChange]);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const stopMonitoring = useCallback(() => {
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
    setIsMonitoring(false);
  }, []);

  const addSample = useCallback(
    (db: number) => {
      const now = Date.now();
      setCurrentDb(db);
      setSamples((prev) => {
        const cutoff = now - windowSeconds * 1000;
        const filtered = prev.filter((s) => s.timestamp >= cutoff);
        return [...filtered, { timestamp: now, db }];
      });
    },
    [windowSeconds],
  );

  const startMonitoring = async () => {
    try {
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
        (
          window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;

      if (!AudioCtx) {
        throw new Error("Web Audio API not supported");
      }

      const ctx = new AudioCtx();
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      audioContextRef.current = ctx;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.3;
      analyserRef.current = analyser;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      const buffer = new Float32Array(analyser.fftSize);
      setIsMonitoring(true);
      setAlertDismissed(false);

      let lastSampleTime = 0;
      const update = () => {
        analyser.getFloatTimeDomainData(buffer);
        let sumSquares = 0;
        for (let i = 0; i < buffer.length; i++) {
          sumSquares += buffer[i] * buffer[i];
        }
        const rms = Math.sqrt(sumSquares / buffer.length);
        const calibrated = rmsToCalibratedDb(rms, getMicCalibration());
        const clampedDb = Math.max(
          0,
          Math.min(130, Math.round(calibrated * 10) / 10),
        );

        const now = Date.now();
        if (now - lastSampleTime >= 200) {
          lastSampleTime = now;
          addSample(clampedDb);
        }

        animationFrameRef.current = requestAnimationFrame(update);
      };

      animationFrameRef.current = requestAnimationFrame(update);
    } catch {
      stopMonitoring();
    }
  };

  useEffect(() => {
    return () => {
      stopMonitoring();
    };
  }, [stopMonitoring]);

  // Compute 5-second rolling average
  const now = Date.now();
  const cutoff = now - windowSeconds * 1000;
  const activeSamples = samples.filter((s) => s.timestamp >= cutoff);

  const rollingAvgDb =
    activeSamples.length > 0
      ? Math.round(
          (activeSamples.reduce((acc, s) => acc + s.db, 0) /
            activeSamples.length) *
            10,
        ) / 10
      : currentDb;

  const isLoudSustained =
    activeSamples.length >= 3 && rollingAvgDb > thresholdDb;

  // Trigger alert callback when threshold is crossed and alerts are enabled
  useEffect(() => {
    if (isLoudSustained && alertsEnabled && !alertDismissed) {
      onAlertTriggered?.(rollingAvgDb);
    }
  }, [isLoudSustained, alertsEnabled, alertDismissed, rollingAvgDb, onAlertTriggered]);

  const handleDismiss = () => {
    setAlertDismissed(true);
    setAlertDismissedTimestamp(Date.now());
  };

  // Re-enable alert if noise drops below threshold and rises again after dismissal
  useEffect(() => {
    if (
      alertDismissed &&
      alertDismissedTimestamp &&
      rollingAvgDb <= thresholdDb - 5
    ) {
      setAlertDismissed(false);
      setAlertDismissedTimestamp(null);
    }
  }, [alertDismissed, alertDismissedTimestamp, rollingAvgDb, thresholdDb]);

  return (
    <div
      data-testid="noise-monitor"
      className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-sm space-y-4"
    >
      {/* Alert Banner when sustained loud noise is detected and alerts are enabled */}
      {isLoudSustained && alertsEnabled && !alertDismissed && (
        <div
          role="alert"
          data-testid="decibel-threshold-alert"
          className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 text-amber-900 dark:text-amber-200 transition-all animate-in fade-in slide-in-from-top-2"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="p-1.5 bg-amber-100 dark:bg-amber-900/60 rounded-lg text-amber-700 dark:text-amber-400 mt-0.5 shrink-0">
                <AlertTriangle className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">
                    Loud Environment Detected
                  </span>
                  <span
                    data-testid="warning-badge"
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-200 dark:bg-amber-900 text-amber-800 dark:text-amber-200"
                  >
                    Avg: {rollingAvgDb} dB (&gt;{thresholdDb} dB)
                  </span>
                </div>
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  Ambient noise has exceeded {thresholdDb} dB for over{" "}
                  {windowSeconds} seconds. Sustained loud noise can affect deep
                  focus.
                </p>
                <div className="pt-2 flex items-center gap-2 flex-wrap">
                  <Link
                    href={quietSearchUrl}
                    className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Find Quiet Workspaces
                    <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
                  </Link>
                  <button
                    type="button"
                    onClick={handleToggleAlerts}
                    data-testid="mute-alerts-btn"
                    className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/40 hover:bg-amber-200 dark:hover:bg-amber-900/60 text-amber-900 dark:text-amber-200 border border-amber-300/50 dark:border-amber-700/50 transition-colors"
                  >
                    <BellOff className="w-3.5 h-3.5" />
                    Mute Alerts
                  </button>
                </div>
              </div>
            </div>

            <button
              onClick={handleDismiss}
              data-testid="dismiss-alert-btn"
              aria-label="Dismiss loud noise alert"
              className="p-1 rounded-lg text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Monitor Header & Stats */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
            {isMonitoring ? (
              <Volume2 className="w-5 h-5 text-emerald-500 animate-pulse" />
            ) : (
              <VolumeX className="w-5 h-5 text-zinc-400" />
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Ambient Noise Monitor
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {isMonitoring
                ? `Active • Rolling ${windowSeconds}s average`
                : "Idle • Press start to monitor microphone"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Ambient Noise Alert Toggle */}
          <button
            type="button"
            onClick={handleToggleAlerts}
            data-testid="noise-alert-toggle"
            role="switch"
            aria-checked={alertsEnabled}
            aria-label={alertsEnabled ? "Mute ambient noise level alerts" : "Enable ambient noise level alerts"}
            title={alertsEnabled ? "Ambient noise alerts enabled" : "Ambient noise alerts muted"}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
              alertsEnabled
                ? "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/80 hover:bg-amber-100 dark:hover:bg-amber-900/60"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            {alertsEnabled ? (
              <>
                <Bell className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>Alerts On</span>
              </>
            ) : (
              <>
                <BellOff className="w-3.5 h-3.5 text-zinc-400" />
                <span>Alerts Muted</span>
              </>
            )}
          </button>

          <button
            onClick={isMonitoring ? stopMonitoring : startMonitoring}
            data-testid="toggle-monitoring-btn"
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
              isMonitoring
                ? "bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900 hover:bg-red-100"
                : "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90"
            }`}
          >
            {isMonitoring ? (
              <>
                <Square className="w-3.5 h-3.5" /> Stop
              </>
            ) : (
              <>
                <Mic className="w-3.5 h-3.5" /> Start Monitoring
              </>
            )}
          </button>
        </div>
      </div>

      {/* Real-time Decibel Indicators */}
      <div className="grid grid-cols-2 gap-3 pt-2">
        <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Current Level
          </span>
          <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mt-0.5">
            {currentDb}{" "}
            <span className="text-xs font-normal text-zinc-500">dB</span>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {windowSeconds}s Rolling Average
          </span>
          <div
            data-testid="rolling-avg-db"
            className={`text-2xl font-bold mt-0.5 ${
              rollingAvgDb > thresholdDb
                ? "text-amber-600 dark:text-amber-400"
                : "text-zinc-900 dark:text-zinc-100"
            }`}
          >
            {rollingAvgDb}{" "}
            <span className="text-xs font-normal text-zinc-500">dB</span>
          </div>
        </div>
      </div>
    </div>
  );
}
