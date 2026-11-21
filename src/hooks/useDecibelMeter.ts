import { useState, useRef, useCallback, useEffect } from "react";
import { useWebAudioAutoPause } from "./useWebAudioAutoPause";

/**
 * Safely computes the Root Mean Square (RMS) of audio samples.
 * Validates empty buffers, silence, non-finite values (NaN, Infinity), and extreme amplitudes.
 */
export function calculateSafeRMS(samples: Float32Array): number {
  if (!samples || samples.length === 0) {
    return 0;
  }

  let sum = 0;
  let validCount = 0;

  for (let i = 0; i < samples.length; i++) {
    const val = samples[i];
    if (Number.isFinite(val)) {
      sum += val * val;
      validCount++;
    }
  }

  if (validCount === 0 || !Number.isFinite(sum) || sum <= 0) {
    return 0;
  }

  const meanSquare = sum / validCount;
  const rms = Math.sqrt(meanSquare);

  return Number.isFinite(rms) && rms > 0 ? rms : 0;
}

/**
 * Converts RMS amplitude to decibels, clamped to the non-negative sensory range [0, 120] dB.
 * Guards against silence (RMS <= 0), NaN, and non-finite values by returning 0 dB.
 */
export function computeSafeDecibels(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) {
    return 0;
  }

  // Safe minimum epsilon to prevent Math.log10(0) evaluating to -Infinity
  const safeRms = Math.max(1e-5, rms);
  const computedDb = 20 * Math.log10(safeRms);

  return Number.isFinite(computedDb)
    ? Math.max(0, Math.min(120, computedDb))
    : 0;
}

interface UseDecibelMeterResult {
  start: () => Promise<void>;
  stop: () => void;
  decibel: number | null;
  isMeasuring: boolean;
  error: string | null;
}

export function useDecibelMeter(): UseDecibelMeterResult {
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [decibel, setDecibel] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const requestRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const dbFramesRef = useRef<number[]>([]);

  const stop = useCallback(() => {
    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
      requestRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    sourceRef.current = null;
    analyserRef.current = null;

    setIsMeasuring(false);
  }, []);

  useEffect(() => () => stop(), [stop]);

  useWebAudioAutoPause({
    isActive: isMeasuring,
    onPause: stop,
  });

  const tick = useCallback(
    function tickFn() {
      if (!analyserRef.current || !startTimeRef.current) return;

      const dataArray = new Float32Array(analyserRef.current.fftSize);
      analyserRef.current.getFloatTimeDomainData(dataArray);

      const rms = calculateSafeRMS(dataArray);
      const computedDb = computeSafeDecibels(rms);
      const db = Number.isFinite(computedDb)
        ? Math.max(0, Math.min(120, computedDb))
        : 0;

      dbFramesRef.current.push(db);

      const now = Date.now();
      const elapsed = now - startTimeRef.current;

      if (elapsed >= 5000) {
        // Finished 5 seconds
        const avgDb =
          dbFramesRef.current.length > 0
            ? dbFramesRef.current.reduce((a, b) => a + b, 0) /
              dbFramesRef.current.length
            : 0;
        const clampedAvg = Number.isFinite(avgDb)
          ? Math.max(0, Math.min(120, avgDb))
          : 0;
        setDecibel(Math.round(clampedAvg * 10) / 10);
        stop();
      } else {
        // Update UI with latest reading (live feedback)
        setDecibel(Math.round(db * 10) / 10);
        requestRef.current = requestAnimationFrame(tickFn);
      }
    },
    [stop],
  );

  const start = useCallback(async () => {
    stop();
    setError(null);
    setDecibel(null);
    dbFramesRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false,
        },
      });
      streamRef.current = stream;

      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error("Web Audio API is not supported in this browser.");
      }

      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;

      source.connect(analyser);
      // We explicitly do NOT connect the analyser to the audioContext.destination
      // to avoid playback and ensure no data leaves the node locally.

      setIsMeasuring(true);
      startTimeRef.current = Date.now();
      requestRef.current = requestAnimationFrame(tick);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to access microphone. Please check permissions.",
      );
      stop();
    }
  }, [stop, tick]);

  return { start, stop, decibel, isMeasuring, error };
}
