"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  downloadAcousticsHistoryCSV,
  formatAcousticsHistoryFilename,
  calculateQuietScore,
  type AcousticsHistoryRow,
} from "@/lib/export/acousticsHistoryExport";

export interface FrequencyBandEnergy {
  low: number;
  mid: number;
  high: number;
}

export interface NoiseSpectrogramProps {
  className?: string;
  fftSize?: number;
  venueId?: string;
  historicalReadings?: AcousticsHistoryRow[];
  onExportCsv?: () => void;
}

const NOTCH_FREQUENCY_HZ = 60;
const NOTCH_Q = 10;

function configureNotchFilter(filter: BiquadFilterNode): void {
  filter.type = "notch";
  filter.frequency.value = NOTCH_FREQUENCY_HZ;
  filter.Q.value = NOTCH_Q;
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
    } else if (frequencyHz < 3000) {
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
  venueId,
  historicalReadings,
  onExportCsv,
}: NoiseSpectrogramProps) {
  const [isActive, setIsActive] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [isNotchEnabled, setIsNotchEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [energy, setEnergy] = useState<FrequencyBandEnergy>({
    low: 0,
    mid: 0,
    high: 0,
  });
  const [sampleRate, setSampleRate] = useState<number | null>(null);

  const handleExportCsv = useCallback(async () => {
    if (onExportCsv) {
      onExportCsv();
      return;
    }

    if (historicalReadings && historicalReadings.length > 0) {
      downloadAcousticsHistoryCSV(venueId || "current", historicalReadings);
      return;
    }

    if (venueId) {
      try {
        const res = await fetch(
          `/api/venues/${venueId}/acoustics/history?format=csv`
        );
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = formatAcousticsHistoryFilename(venueId);
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          return;
        }
      } catch {
        // Fall back to client-side generation
      }
    }

    const fallbackRows: AcousticsHistoryRow[] = [
      {
        timestamp: new Date().toISOString(),
        average_db: Math.round(energy.mid * 0.8 + 35),
        peak_db: Math.round(energy.high * 0.9 + 45),
        dominant_frequency_hz:
          energy.high > energy.mid
            ? 3500
            : energy.mid > energy.low
              ? 1000
              : 250,
        quiet_score: calculateQuietScore(Math.round(energy.mid * 0.8 + 35)),
      },
    ];
    downloadAcousticsHistoryCSV(venueId || "current", fallbackRows);
  }, [venueId, historicalReadings, onExportCsv, energy]);

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const notchFilterRef = useRef<BiquadFilterNode | null>(null);
  const notchEnabledRef = useRef(false);
  const notchActiveRef = useRef(false);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const frameRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const isActiveRef = useRef(false);
  const startGenerationRef = useRef(0);
  const startPendingRef = useRef(false);
  const trackEndedHandlerRef = useRef<(() => void) | null>(null);
  const spectrumCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const releaseAudio = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    sourceRef.current?.disconnect();
    notchFilterRef.current?.disconnect();
    analyserRef.current?.disconnect();
    sourceRef.current = null;
    notchFilterRef.current = null;
    analyserRef.current = null;
    notchActiveRef.current = false;
    isActiveRef.current = false;

    const stream = streamRef.current;
    const trackEndedHandler = trackEndedHandlerRef.current;
    stream?.getTracks().forEach((track) => {
      if (trackEndedHandler) {
        track.removeEventListener("ended", trackEndedHandler);
      }
      track.stop();
    });
    streamRef.current = null;
    trackEndedHandlerRef.current = null;

    const context = contextRef.current;
    contextRef.current = null;
    return context;
  }, []);

  const stop = useCallback(async () => {
    startGenerationRef.current += 1;
    startPendingRef.current = false;
    const context = releaseAudio();
    if (context && context.state !== "closed") {
      try {
        await context.close();
      } catch (cause) {
        if (mountedRef.current) {
          setError(
            `Unable to close audio context: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }
      }
    }

    if (mountedRef.current) {
      setIsActive(false);
      setEnergy({ low: 0, mid: 0, high: 0 });
    }
  }, [releaseAudio]);

  const applyNotchFilter = useCallback((enabled: boolean) => {
    const context = contextRef.current;
    const source = sourceRef.current;
    const analyser = analyserRef.current;
    if (!context || !source || !analyser || enabled === notchActiveRef.current) {
      return;
    }

    if (enabled) {
      const filter =
        notchFilterRef.current ?? context.createBiquadFilter();
      configureNotchFilter(filter);
      notchFilterRef.current = filter;

      source.disconnect(analyser);
      try {
        source.connect(filter);
        filter.connect(analyser);
        notchActiveRef.current = true;
      } catch (cause) {
        try {
          source.disconnect(filter);
          filter.disconnect(analyser);
        } catch {
          // A partially connected route may already have been disconnected.
        }
        source.connect(analyser);
        throw cause;
      }
      return;
    }

    const filter = notchFilterRef.current;
    if (!filter) return;

    source.disconnect(filter);
    filter.disconnect(analyser);
    try {
      source.connect(analyser);
      notchActiveRef.current = false;
    } catch (cause) {
      source.connect(filter);
      filter.connect(analyser);
      throw cause;
    }
  }, []);

  const toggleNotchFilter = useCallback(async () => {
    const enabled = !notchEnabledRef.current;
    notchEnabledRef.current = enabled;
    setIsNotchEnabled(enabled);

    const context = contextRef.current;
    if (!context || !sourceRef.current || !analyserRef.current) return;

    try {
      if (context.state === "suspended") {
        await context.resume();
      }
      if (contextRef.current === context) {
        applyNotchFilter(notchEnabledRef.current);
      }
    } catch (cause) {
      const actualState = notchActiveRef.current;
      notchEnabledRef.current = actualState;
      if (mountedRef.current) {
        setIsNotchEnabled(actualState);
        setError(
          `Unable to update acoustic notch filter: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    }
  }, [applyNotchFilter]);

  const start = useCallback(async () => {
    if (isActiveRef.current || startPendingRef.current) return;
    const generation = ++startGenerationRef.current;
    startPendingRef.current = true;
    setError(null);

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof window === "undefined" ||
      typeof window.AudioContext !== "function"
    ) {
      startPendingRef.current = false;
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
      if (!mountedRef.current || generation !== startGenerationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      const context = new window.AudioContext();
      contextRef.current = context;
      if (context.state === "suspended") {
        await context.resume();
      }
      if (!mountedRef.current || generation !== startGenerationRef.current) {
        return;
      }

      const analyser = context.createAnalyser();
      analyser.fftSize = fftSize;
      analyser.smoothingTimeConstant = 0.8;
      const source = context.createMediaStreamSource(stream);
      sourceRef.current = source;
      analyserRef.current = analyser;

      if (notchEnabledRef.current) {
        const filter = context.createBiquadFilter();
        configureNotchFilter(filter);
        notchFilterRef.current = filter;
        source.connect(filter);
        filter.connect(analyser);
        notchActiveRef.current = true;
      } else {
        source.connect(analyser);
      }

      const onTrackEnded = () => {
        if (mountedRef.current) void stop();
      };
      trackEndedHandlerRef.current = onTrackEnded;
      stream.getTracks().forEach((track) => {
        track.addEventListener("ended", onTrackEnded);
      });

      setSampleRate(context.sampleRate);
      startPendingRef.current = false;
      isActiveRef.current = true;
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
        drawSpectrum(
          spectrumCanvasRef.current,
          buffer,
          activeAnalyser.context.sampleRate,
          notchEnabledRef.current,
        );
        frameRef.current = requestAnimationFrame(sample);
      };
      frameRef.current = requestAnimationFrame(sample);
    } catch (cause) {
      if (generation !== startGenerationRef.current) return;
      startPendingRef.current = false;
      const context = releaseAudio();
      if (context && context.state !== "closed") {
        try {
          await context.close();
        } catch (closeCause) {
          setError(
            `Unable to close audio context: ${closeCause instanceof Error ? closeCause.message : String(closeCause)}`,
          );
        }
      }
      const message =
        cause instanceof Error ? cause.message : "Microphone access was denied.";
      setError(
        message.toLowerCase().includes("permission")
          ? "Allow microphone access to view live frequency bands."
          : message,
      );
    }
  }, [fftSize, releaseAudio, stop]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startGenerationRef.current += 1;
      startPendingRef.current = false;
      const context = releaseAudio();
      if (context && context.state !== "closed") {
        void context.close().catch(() => undefined);
      }
    };
  }, [releaseAudio]);

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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            aria-label="Export CSV"
            data-testid="export-acoustics-csv-button"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => (isActive ? void stop() : void start())}
            className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            aria-pressed={isActive}
          >
            {isActive ? "Stop spectrum" : "Start spectrum"}
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => void toggleNotchFilter()}
        className="mt-4 rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        aria-pressed={isNotchEnabled}
      >
        Simulate Acoustic Notch Filter
      </button>

      {isActive && (
        <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-zinc-950">
          <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            Frequency spectrum
          </p>
          <canvas
            ref={spectrumCanvasRef}
            width={640}
            height={96}
            className="block h-20 w-full"
            aria-label="Live frequency spectrum"
          />
        </div>
      )}

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

function drawSpectrum(
  canvas: HTMLCanvasElement | null,
  frequencyData: Uint8Array,
  sampleRate: number,
  showNotch: boolean,
): void {
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return;

  const { width, height } = canvas;
  context.fillStyle = "#09090b";
  context.fillRect(0, 0, width, height);

  const barCount = Math.min(frequencyData.length, width);
  const binStep = frequencyData.length / barCount;
  const barWidth = width / barCount;
  for (let index = 0; index < barCount; index += 1) {
    const magnitude = frequencyData[Math.floor(index * binStep)] / 255;
    const barHeight = magnitude * (height - 2);
    context.fillStyle = "#38bdf8";
    context.fillRect(
      index * barWidth,
      height - barHeight,
      Math.max(1, barWidth - 1),
      barHeight,
    );
  }

  if (showNotch && sampleRate > 0) {
    const nyquistFrequency = sampleRate / 2;
    const centerX = (NOTCH_FREQUENCY_HZ / nyquistFrequency) * width;
    const bandwidth = NOTCH_FREQUENCY_HZ / NOTCH_Q;
    const leftX =
      ((NOTCH_FREQUENCY_HZ - bandwidth / 2) / nyquistFrequency) * width;
    const rightX =
      ((NOTCH_FREQUENCY_HZ + bandwidth / 2) / nyquistFrequency) * width;

    context.fillStyle = "rgba(56, 189, 248, 0.12)";
    context.fillRect(leftX, 0, rightX - leftX, height);
    context.fillStyle = "rgba(125, 211, 252, 0.85)";
    context.fillRect(centerX, 0, 1, height);
  }
}

export default NoiseSpectrogram;
