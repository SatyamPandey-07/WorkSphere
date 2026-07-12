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

export function NoiseMeter({ onMeasured }: Props) {
  const [status, setStatus] = useState<
    "idle" | "requesting" | "measuring" | "done" | "error"
  >("idle");
  const [remaining, setRemaining] = useState(5);
  const [liveDb, setLiveDb] = useState(0);
  const [result, setResult] = useState<NoiseMeasurement | null>(null);
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

        animationFrame = requestAnimationFrame(tick);
      };

      tick();

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
            (usable.reduce((sum, value) => sum + value, 0) / usable.length) * 10,
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
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/60">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            Ambient Noise Measurement
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Captures a 5-second local microphone sample. Raw audio is not uploaded.
          </p>
        </div>

        <Volume2 className="h-5 w-5 text-blue-500" />
      </div>

      {status === "measuring" && (
        <div className="mt-4">
          <div className="flex items-end justify-between">
            <span className="text-sm text-zinc-500">
              Measuring… {remaining}s
            </span>
            <span className="text-3xl font-semibold text-zinc-900 dark:text-white">
              {liveDb.toFixed(1)}
              <span className="ml-1 text-sm font-normal text-zinc-500">dB</span>
            </span>
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
            <div
              className="h-full rounded-full bg-blue-500 transition-all"
              style={{
                width: `${Math.min(100, Math.max(5, ((liveDb - 20) / 100) * 100))}%`,
              }}
            />
          </div>
        </div>
      )}

      {result && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-white p-3 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Average</p>
            <p className="mt-1 text-xl font-semibold">
              {result.averageDb.toFixed(1)} dB
            </p>
          </div>

          <div className="rounded-xl bg-white p-3 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Peak</p>
            <p className="mt-1 text-xl font-semibold">
              {result.peakDb.toFixed(1)} dB
            </p>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={measure}
        disabled={status === "requesting" || status === "measuring"}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "measuring" ? (
          <>
            <Square className="h-4 w-4" />
            Measuring ambient sound
          </>
        ) : (
          <>
            <Mic className="h-4 w-4" />
            {result ? "Measure again" : "Measure Noise"}
          </>
        )}
      </button>

      {status === "error" && (
        <p className="mt-3 text-xs text-red-500">
          Microphone access failed. Check browser permission and try again.
        </p>
      )}
    </div>
  );
}
