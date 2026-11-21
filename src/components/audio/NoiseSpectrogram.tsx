"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface FrequencyBandEnergy {
  low: number;
  mid: number;
  high: number;
}

export interface NoiseSpectrogramProps {
  className?: string;
  fftSize?: number;
}

/**
 * Aggregates Web Audio frequency bins into low (<300 Hz), mid (300–3000 Hz),
 * and high (>3000 Hz) bands. Each result is the mean bin magnitude (0–100%).
 */
export function calculateFrequencyBandEnergy(
  frequencyData: Uint8Array,
  sampleRate: number,
  fftSize: number,
): FrequencyBandEnergy {
  if (
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0 ||
    !Number.isFinite(fftSize) ||
    fftSize <= 0
  ) {
    throw new RangeError("sampleRate and fftSize must be positive finite numbers.");
  }

  const totals = { low: 0, mid: 0, high: 0 };
  const counts = { low: 0, mid: 0, high: 0 };
  const binWidthHz = sampleRate / fftSize;

  for (let index = 0; index < frequencyData.length; index += 1) {
    const frequencyHz = index * binWidthHz;
    const magnitude = frequencyData[index] / 255;

    if (frequencyHz < 300) {
      totals.low += magnitude;
      counts.low += 1;
    } else if (frequencyHz <= 3000) {
      totals.mid += magnitude;
      counts.mid += 1;
    } else {
      totals.high += magnitude;
      counts.high += 1;
    }
  }

  return {
    low: counts.low ? (totals.low / counts.low) * 100 : 0,
    mid: counts.mid ? (totals.mid / counts.mid) * 100 : 0,
    high: counts.high ? (totals.high / counts.high) * 100 : 0,
  };
}

const BANDS: Array<{
  key: keyof FrequencyBandEnergy;
  label: string;
  range: string;
  colorClass: string;
}> = [
  { key: "low", label: "Low", range: "< 300 Hz", colorClass: "bg-sky-400" },
  { key: "mid", label: "Mid", range: "300–3000 Hz", colorClass: "bg-violet-400" },
  { key: "high", label: "High", range: "> 3000 Hz", colorClass: "bg-rose-400" },
];

export function NoiseSpectrogram({
  className = "",
  fftSize = 2048,
}: NoiseSpectrogramProps) {
  const [isActive, setIsActive] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [energy, setEnergy] = useState<FrequencyBandEnergy>({
    low: 0,
    mid: 0,
    high: 0,
  });
  const [sampleRate, setSampleRate] = useState<number | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const frameRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const stop = useCallback(async () => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== "closed") {
      await context.close().catch(() => undefined);
    }

    if (mountedRef.current) {
      setIsActive(false);
      setEnergy({ low: 0, mid: 0, high: 0 });
    }
  }, []);

  const start = useCallback(async () => {
    if (isActive) return;
    setError(null);

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof window === "undefined" ||
      typeof window.AudioContext !== "function"
    ) {
      setIsSupported(false);
      setError("Live frequency analysis is not supported by this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const context = new window.AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = fftSize;
      analyser.smoothingTimeConstant = 0.8;
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);

      streamRef.current = stream;
      contextRef.current = context;
      sourceRef.current = source;
      analyserRef.current = analyser;
      setSampleRate(context.sampleRate);
      setIsActive(true);

      const buffer = new Uint8Array(analyser.frequencyBinCount);
      const sample = () => {
        const activeAnalyser = analyserRef.current;
        if (!activeAnalyser || !mountedRef.current) return;
        activeAnalyser.getByteFrequencyData(buffer);
        setEnergy(
          calculateFrequencyBandEnergy(
            buffer,
            activeAnalyser.context.sampleRate,
            activeAnalyser.fftSize,
          ),
        );
        frameRef.current = requestAnimationFrame(sample);
      };
      frameRef.current = requestAnimationFrame(sample);
    } catch (cause) {
      await stop();
      const message =
        cause instanceof Error ? cause.message : "Microphone access was denied.";
      setError(
        message.toLowerCase().includes("permission")
          ? "Allow microphone access to view live frequency bands."
          : message,
      );
    }
  }, [fftSize, isActive, stop]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      sourceRef.current?.disconnect();
      analyserRef.current?.disconnect();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      const context = contextRef.current;
      contextRef.current = null;
      if (context && context.state !== "closed") {
        void context.close().catch(() => undefined);
      }
    };
  }, []);

  return (
    <section
      className={`rounded-2xl border border-white/10 bg-zinc-950/70 p-4 ${className}`}
      aria-label="Ambient noise frequency spectrogram"
      data-testid="noise-spectrogram"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">
            Ambient Frequency Bands
          </h3>
          <p className="mt-1 text-xs text-zinc-400">
            Live microphone spectrum · low, mid and high frequency energy
          </p>
        </div>
        <button
          type="button"
          onClick={() => (isActive ? void stop() : void start())}
          className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          aria-pressed={isActive}
        >
          {isActive ? "Stop spectrum" : "Start spectrum"}
        </button>
      </div>

      <div className="mt-5 space-y-4" aria-live="polite">
        {BANDS.map((band) => {
          const value = Math.round(energy[band.key]);
          return (
            <div key={band.key} data-testid={`spectrogram-band-${band.key}`}>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="font-medium text-zinc-200">{band.label}</span>
                <span className="font-mono text-zinc-400">
                  {band.range} · {isActive ? `${value}%` : "—"}
                </span>
              </div>
              <div
                className="h-3 overflow-hidden rounded-full bg-white/10"
                role="meter"
                aria-label={`${band.label} frequency energy`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={isActive ? value : 0}
              >
                <div
                  className={`h-full rounded-full transition-[width] duration-150 ease-out ${band.colorClass}`}
                  style={{ width: `${isActive ? value : 0}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 text-[11px] text-zinc-500">
        <span>
          {isActive
            ? `Sampling at ${sampleRate ?? "—"} Hz`
            : "Microphone starts only after you press Start"}
        </span>
        <span>{isActive ? "Live · not recorded" : "No audio is uploaded"}</span>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-rose-300">
          {error}
        </p>
      )}
      {!isSupported && (
        <p className="sr-only">
          Browser microphone and Web Audio support is required.
        </p>
      )}
    </section>
  );
}

export default NoiseSpectrogram;
