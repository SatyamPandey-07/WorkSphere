import { useState, useRef, useCallback } from "react";
import { calculateRMS, rmsToDecibels } from "@/lib/audio";

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

  const tick = useCallback(
    function tickFn() {
      if (!analyserRef.current || !startTimeRef.current) return;

      const dataArray = new Float32Array(analyserRef.current.fftSize);
      analyserRef.current.getFloatTimeDomainData(dataArray);

      const rms = calculateRMS(dataArray);
      const db = rmsToDecibels(rms);
      dbFramesRef.current.push(db);

      const now = Date.now();
      const elapsed = now - startTimeRef.current;

      if (elapsed >= 5000) {
        // Finished 5 seconds
        const avgDb =
          dbFramesRef.current.reduce((a, b) => a + b, 0) /
          dbFramesRef.current.length;
        setDecibel(Math.round(avgDb * 10) / 10);
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
