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
  const [isFilterEnabled, setIsFilterEnabled] = useState(false);
  const [notchFrequency, setNotchFrequency] = useState<60 | 1000>(60);
  const [isStarting, setIsStarting] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const filterRef = useRef<BiquadFilterNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const lifecycleRef = useRef(0);
  const startRequestSequenceRef = useRef(0);
  const startInFlightRef = useRef<number | null>(null);
  const filterEnabledRef = useRef(false);
  const notchFrequencyRef = useRef<60 | 1000>(60);

  const reconnectAudioGraph = useCallback(
    (enabled: boolean, frequency: 60 | 1000) => {
      const source = sourceRef.current;
      const analyser = analyserRef.current;
      const context = contextRef.current;
      if (!source || !analyser || !context) return;

      source.disconnect();
      filterRef.current?.disconnect();

      if (!enabled) {
        source.connect(analyser);
        return;
      }

      let filter = filterRef.current;
      if (!filter) {
        filter = context.createBiquadFilter();
        filter.type = "notch";
        filter.frequency.value = frequency;
        filter.Q.value = 10;
        filterRef.current = filter;
      } else {
        filter.frequency.setTargetAtTime(
          frequency,
          context.currentTime,
          0.01,
        );
      }

      source.connect(filter);
      filter.connect(analyser);
    },
    [],
  );

  const handleFilterToggle = useCallback(() => {
    const nextEnabled = !filterEnabledRef.current;
    filterEnabledRef.current = nextEnabled;
    setIsFilterEnabled(nextEnabled);
    reconnectAudioGraph(nextEnabled, notchFrequencyRef.current);
  }, [reconnectAudioGraph]);

  const handleFrequencyChange = useCallback(
    (frequency: 60 | 1000) => {
      notchFrequencyRef.current = frequency;
      setNotchFrequency(frequency);

      const filter = filterRef.current;
      const context = contextRef.current;
      if (filter && context && filterEnabledRef.current) {
        filter.frequency.setTargetAtTime(
          frequency,
          context.currentTime,
          0.01,
        );
      } else if (filter) {
        filter.frequency.value = frequency;
      }
    },
    [],
  );

  const stop = useCallback(async () => {
    lifecycleRef.current += 1;
    startInFlightRef.current = null;
    if (mountedRef.current) setIsStarting(false);
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    filterRef.current?.disconnect();
    filterRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    const context = contextRef.current;
    contextRef.current = null;

    if (mountedRef.current) {
      setIsActive(false);
      setIsFilterEnabled(false);
      filterEnabledRef.current = false;
      setEnergy({ low: 0, mid: 0, high: 0 });
    }

    if (context && context.state !== "closed") {
      void context.close().catch(() => undefined);
    }
  }, []);

  const start = useCallback(async () => {
    if (isActive || startInFlightRef.current !== null) return;
    const startRequest = ++startRequestSequenceRef.current;
    startInFlightRef.current = startRequest;
    const lifecycle = lifecycleRef.current;
    if (mountedRef.current) setIsStarting(true);
    let acquiredStream: MediaStream | null = null;
    let acquiredContext: AudioContext | null = null;
    let acquiredSource: MediaStreamAudioSourceNode | null = null;
    let acquiredAnalyser: AnalyserNode | null = null;
    setError(null);

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof window === "undefined" ||
      typeof window.AudioContext !== "function"
    ) {
      setIsSupported(false);
      setError("Live frequency analysis is not supported by this browser.");
      if (startInFlightRef.current === startRequest) {
        startInFlightRef.current = null;
      }
      if (mountedRef.current) setIsStarting(false);
      return;
    }

    try {
      acquiredStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (!mountedRef.current || lifecycleRef.current !== lifecycle) {
        acquiredStream.getTracks().forEach((track) => track.stop());
        acquiredStream = null;
        return;
      }

      acquiredContext = new window.AudioContext();
      if (acquiredContext.state === "suspended") {
        await acquiredContext.resume();
      }
      if (!mountedRef.current || lifecycleRef.current !== lifecycle) {
        acquiredStream.getTracks().forEach((track) => track.stop());
        acquiredStream = null;
        if (acquiredContext.state !== "closed") {
          await acquiredContext.close().catch(() => undefined);
        }
        acquiredContext = null;
        return;
      }

      acquiredAnalyser = acquiredContext.createAnalyser();
      acquiredAnalyser.fftSize = fftSize;
      acquiredAnalyser.smoothingTimeConstant = 0.8;
      acquiredSource = acquiredContext.createMediaStreamSource(acquiredStream);
      acquiredSource.connect(acquiredAnalyser);

      if (!mountedRef.current || lifecycleRef.current !== lifecycle) {
        acquiredSource.disconnect();
        acquiredAnalyser.disconnect();
        acquiredStream.getTracks().forEach((track) => track.stop());
        if (acquiredContext.state !== "closed") {
          await acquiredContext.close().catch(() => undefined);
        }
        acquiredSource = null;
        acquiredAnalyser = null;
        acquiredStream = null;
        acquiredContext = null;
        return;
      }

      streamRef.current = acquiredStream;
      contextRef.current = acquiredContext;
      sourceRef.current = acquiredSource;
      analyserRef.current = acquiredAnalyser;
      filterEnabledRef.current = false;
      filterRef.current = null;
      if (mountedRef.current) {
        setSampleRate(acquiredContext.sampleRate);
        setIsActive(true);
        setIsStarting(false);
      }
      acquiredStream = null;
      acquiredContext = null;
      acquiredSource = null;
      acquiredAnalyser = null;

      const buffer = new Uint8Array(analyserRef.current!.frequencyBinCount);
      const sample = () => {
        frameRef.current = null;
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

        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;
          const width = Math.max(1, Math.floor(rect.width * dpr));
          const height = Math.max(1, Math.floor(rect.height * dpr));
          if (canvas.width !== width) canvas.width = width;
          if (canvas.height !== height) canvas.height = height;

          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.clearRect(0, 0, width, height);
            ctx.fillStyle = "#18181b";
            ctx.fillRect(0, 0, width, height);

            const nyquist = activeAnalyser.context.sampleRate / 2;
            const binWidth = activeAnalyser.context.sampleRate / activeAnalyser.fftSize;
            const activeBins = buffer.length;
            for (let index = 0; index < activeBins; index += 1) {
              const frequency = index * binWidth;
              const x = (frequency / nyquist) * width;
              const amplitude = buffer[index] / 255;
              ctx.fillStyle =
                frequency < 300
                  ? "rgba(56, 189, 248, 0.75)"
                  : frequency <= 3000
                    ? "rgba(167, 139, 250, 0.75)"
                    : "rgba(251, 113, 133, 0.75)";
              ctx.fillRect(
                x,
                height - amplitude * height,
                Math.max(1, (width / activeBins) + dpr),
                amplitude * height,
              );
            }

            if (filterEnabledRef.current) {
              const notchX =
                (notchFrequencyRef.current / nyquist) * width;
              ctx.save();
              ctx.strokeStyle = "rgba(251, 191, 36, 0.95)";
              ctx.lineWidth = Math.max(1, dpr);
              ctx.setLineDash([4 * dpr, 3 * dpr]);
              ctx.beginPath();
              ctx.moveTo(notchX, 0);
              ctx.lineTo(notchX, height);
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.fillStyle = "rgba(251, 191, 36, 0.95)";
              ctx.font = `${10 * dpr}px ui-monospace, monospace`;
              ctx.textAlign = notchX > width - 50 * dpr ? "right" : "left";
              ctx.fillText(
                notchFrequencyRef.current === 1000 ? "1 kHz" : "60 Hz",
                notchX + (notchX > width - 50 * dpr ? -4 * dpr : 4 * dpr),
                12 * dpr,
              );
              ctx.restore();
            }
          }
        }
        frameRef.current = requestAnimationFrame(sample);
      };
      frameRef.current = requestAnimationFrame(sample);
    } catch (cause) {
      if (acquiredSource) acquiredSource.disconnect();
      if (acquiredAnalyser) acquiredAnalyser.disconnect();
      if (acquiredStream) {
        acquiredStream.getTracks().forEach((track) => track.stop());
      }
      if (acquiredContext && acquiredContext.state !== "closed") {
        await acquiredContext.close().catch(() => undefined);
      }
      const message =
        cause instanceof Error ? cause.message : "Microphone access was denied.";
      if (mountedRef.current && lifecycleRef.current === lifecycle) {
        setError(
          message.toLowerCase().includes("permission")
            ? "Allow microphone access to view live frequency bands."
            : message,
        );
        setIsActive(false);
        setEnergy({ low: 0, mid: 0, high: 0 });
      }
    } finally {
      if (startInFlightRef.current === startRequest) {
        startInFlightRef.current = null;
        if (mountedRef.current) setIsStarting(false);
      }
    }
  }, [fftSize, isActive]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      lifecycleRef.current += 1;
      startInFlightRef.current = null;
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      sourceRef.current?.disconnect();
      filterRef.current?.disconnect();
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
          onClick={() =>
            isActive || isStarting ? void stop() : void start()
          }
          className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          aria-pressed={isActive || isStarting}
        >
          {isActive || isStarting ? "Stop spectrum" : "Start spectrum"}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <button
          type="button"
          role="switch"
          aria-checked={isFilterEnabled}
          aria-label="Simulate Acoustic Notch Filter"
          data-testid="acoustic-notch-filter-toggle"
          disabled={!isActive}
          onClick={handleFilterToggle}
          className="inline-flex items-center gap-2 text-xs font-semibold text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span
            aria-hidden="true"
            className={`relative h-5 w-9 rounded-full border transition-colors ${
              isFilterEnabled
                ? "border-amber-400/70 bg-amber-400/30"
                : "border-white/20 bg-white/10"
            }`}
          >
            <span
              className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                isFilterEnabled ? "translate-x-[18px]" : "translate-x-0.5"
              }`}
            />
          </span>
          <span>Simulate Acoustic Notch Filter</span>
          <span className="font-mono text-[10px] text-zinc-400">
            {isFilterEnabled ? "On" : "Off"}
          </span>
        </button>

        <label className="flex items-center gap-2 text-xs text-zinc-300">
          <span>Target</span>
          <select
            data-testid="acoustic-notch-frequency"
            aria-label="Notch filter frequency"
            value={notchFrequency}
            disabled={!isActive}
            onChange={(event) =>
              handleFrequencyChange(
                event.target.value === "1000" ? 1000 : 60,
              )
            }
            className="rounded-md border border-white/15 bg-zinc-900 px-2 py-1 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value={60}>60 Hz</option>
            <option value={1000}>1 kHz</option>
          </select>
        </label>
      </div>

      <canvas
        ref={canvasRef}
        data-testid="noise-spectrogram-canvas"
        aria-label={
          isFilterEnabled
            ? `Filtered spectrogram with a notch at ${
                notchFrequency === 1000 ? "1 kHz" : "60 Hz"
              }`
            : "Live audio spectrogram"
        }
        role="img"
        className="mt-4 h-36 w-full rounded-lg border border-white/10 bg-zinc-900"
      />

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
