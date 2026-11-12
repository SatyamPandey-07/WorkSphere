"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, AlertCircle, Volume2 } from "lucide-react";

export type NoiseBand = "quiet" | "moderate" | "loud";

export interface NoiseBandInfo {
  band: NoiseBand;
  label: string;
  strokeClass: string;
  textClass: string;
  badgeClass: string;
}

export function classifyDecibels(db: number): NoiseBandInfo {
  if (db < 45) {
    return {
      band: "quiet",
      label: "Quiet",
      strokeClass: "stroke-emerald-400",
      textClass: "text-emerald-400",
      badgeClass: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
    };
  }
  if (db <= 65) {
    return {
      band: "moderate",
      label: "Moderate",
      strokeClass: "stroke-amber-400",
      textClass: "text-amber-400",
      badgeClass: "border-amber-500/30 bg-amber-500/15 text-amber-300",
    };
  }
  return {
    band: "loud",
    label: "Loud",
    strokeClass: "stroke-rose-400",
    textClass: "text-rose-400",
    badgeClass: "border-rose-500/30 bg-rose-500/15 text-rose-300",
  };
}

export function computeDecibelsFromTimeDomain(samples: Float32Array): number {
  if (samples.length === 0) return 30;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const val = samples[i];
    sumSquares += val * val;
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  // Map normalized RMS (0..1) into realistic ambient dB SPL range (30 dB..100 dB)
  const rawDb = rms > 0 ? 20 * Math.log10(rms) + 95 : 30;
  return Math.max(30, Math.min(100, Math.round(rawDb)));
}

interface NoiseVisualizerProps {
  isActive?: boolean;
  onSampleRating?: (rating: {
    db: number;
    band: NoiseBand;
    label: string;
  }) => void;
}

export const NoiseVisualizer: React.FC<NoiseVisualizerProps> = ({
  isActive = true,
  onSampleRating,
}) => {
  const [isListening, setIsListening] = useState(false);
  const [decibels, setDecibels] = useState<number>(35);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  const cleanupAudio = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      if (audioContextRef.current.state !== "closed") {
        void audioContextRef.current.close();
      }
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    setIsListening(false);
  }, []);

  // Immediately terminate microphone tracks & AudioContext when modal closes or unmounts
  useEffect(() => {
    if (!isActive) {
      cleanupAudio();
    }
    return () => {
      cleanupAudio();
    };
  }, [isActive, cleanupAudio]);

  const startSampling = async () => {
    if (isListening) return;
    setPermissionError(null);

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      setPermissionError("Microphone access is not supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const audioContext = new AudioCtx();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyserRef.current = analyser;

      const buffer = new Float32Array(analyser.fftSize);
      setIsListening(true);

      const updateMeter = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getFloatTimeDomainData(buffer);
        const currentDb = computeDecibelsFromTimeDomain(buffer);
        setDecibels(currentDb);
        rafRef.current = requestAnimationFrame(updateMeter);
      };

      rafRef.current = requestAnimationFrame(updateMeter);
    } catch (err: unknown) {
      cleanupAudio();
      if (
        err instanceof Error &&
        (err.name === "NotAllowedError" || err.name === "PermissionDeniedError")
      ) {
        setPermissionError(
          "Microphone permission denied. Enable mic access to sample ambient noise.",
        );
      } else {
        setPermissionError(
          "Unable to access microphone. Check your audio input device.",
        );
      }
    }
  };

  const bandInfo = classifyDecibels(decibels);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const normalizedProgress = Math.max(0, Math.min(1, (decibels - 30) / 70));
  const strokeDashoffset = circumference * (1 - normalizedProgress);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 text-slate-100">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Volume2 className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-slate-100">
            Live Ambient Noise Meter
          </h3>
        </div>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors duration-300 ${bandInfo.badgeClass}`}
        >
          {bandInfo.label}
        </span>
      </div>

      <div className="mt-4 flex flex-col items-center justify-center">
        <div className="relative flex h-36 w-36 items-center justify-center">
          <svg
            className="h-full w-full -rotate-90 transform"
            viewBox="0 0 128 128"
            role="img"
            aria-label={`Ambient noise level ${decibels} decibels (${bandInfo.label})`}
          >
            <circle
              cx="64"
              cy="64"
              r={radius}
              strokeWidth="10"
              fill="transparent"
              className="stroke-slate-800"
            />
            <circle
              cx="64"
              cy="64"
              r={radius}
              strokeWidth="10"
              strokeLinecap="round"
              fill="transparent"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className={`transition-all duration-300 ease-out ${bandInfo.strokeClass}`}
            />
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span
              data-testid="noise-db-value"
              className={`text-2xl font-bold tabular-nums transition-colors duration-300 ${bandInfo.textClass}`}
            >
              {decibels}
            </span>
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
              dB SPL
            </span>
          </div>
        </div>

        {permissionError && (
          <div
            role="alert"
            className="mt-3 flex w-full items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-300"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            <span>{permissionError}</span>
          </div>
        )}

        <div className="mt-4 flex w-full items-center gap-2">
          {!isListening ? (
            <button
              type="button"
              onClick={startSampling}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-cyan-500"
            >
              <Mic className="h-3.5 w-3.5" />
              <span>Start Noise Check</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={cleanupAudio}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
              >
                <MicOff className="h-3.5 w-3.5 text-rose-400" />
                <span>Stop</span>
              </button>
              {onSampleRating && (
                <button
                  type="button"
                  onClick={() =>
                    onSampleRating({
                      db: decibels,
                      band: bandInfo.band,
                      label: bandInfo.label,
                    })
                  }
                  className="inline-flex flex-1 items-center justify-center rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500"
                >
                  Share Rating
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default NoiseVisualizer;
