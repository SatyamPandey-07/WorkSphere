"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useAudioAnalyzer() {
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(true);

  const contextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);

  const stop = useCallback(async () => {
    generationRef.current += 1;

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
    }
  }, []);

  const start = useCallback(async () => {
    if (contextRef.current || streamRef.current) return;

    setError(null);

    if (
      typeof window === "undefined" ||
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof window.AudioContext !== "function"
    ) {
      setIsSupported(false);
      setError("Microphone audio analysis is not supported by this browser.");
      return;
    }

    const generation = ++generationRef.current;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      if (!mountedRef.current || generation !== generationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const context = new window.AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.8;

      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);

      contextRef.current = context;
      analyserRef.current = analyser;
      sourceRef.current = source;
      streamRef.current = stream;

      if (context.state === "suspended") {
        await context.resume();
      }

      if (!mountedRef.current || generation !== generationRef.current) {
        await stop();
        return;
      }

      setIsActive(true);
    } catch (cause) {
      if (generation === generationRef.current) {
        await stop();
        if (mountedRef.current) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to access the microphone. Check your permissions.",
          );
        }
      }
    }
  }, [stop]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      generationRef.current += 1;

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

  return {
    start,
    stop,
    analyser: analyserRef,
    isActive,
    error,
    isSupported,
  };
}
