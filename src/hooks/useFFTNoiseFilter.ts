"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { resetFFTNoiseFilter } from "@/lib/wasm/fftNoiseFilter";

export interface FFTNoiseFilterState {
  isReady: boolean;
  isProcessing: boolean;
  isWasm: boolean;
  simdSupported: boolean;
  fftSize: number;
  numBins: number;
  error: string | null;
}

export interface FFTNoiseFilterCallbacks {
  onFrameProcessed?: (data: { rms: number; processingTimeMs: number }) => void;
  onSpectrum?: (data: { real: Float32Array; imag: Float32Array }) => void;
  onNoiseProfile?: (profile: Float32Array) => void;
  onError?: (error: string) => void;
}

export type UseFFTNoiseFilterReturn = {
  state: FFTNoiseFilterState;
  start: (constraints?: MediaStreamConstraints["audio"]) => Promise<void>;
  stop: () => void;
  setSensitivity: (value: number) => void;
  resetCalibration: () => void;
  requestSpectrum: () => void;
  requestNoiseProfile: () => void;
};

export function useFFTNoiseFilter(
  callbacks: FFTNoiseFilterCallbacks = {},
): UseFFTNoiseFilterReturn {
  const [state, setState] = useState<FFTNoiseFilterState>({
    isReady: false,
    isProcessing: false,
    isWasm: false,
    simdSupported: false,
    fftSize: 1024,
    numBins: 513,
    error: null,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const wasmBinary = await fetch("/fft-noise-filter.wasm")
          .then((r) => {
            if (!r.ok) throw new Error("WASM binary not found");
            return r.arrayBuffer();
          })
          .catch(() => null);

        if (!mounted) return;

        const AudioCtxClass =
          window.AudioContext ||
          (
            window as typeof window & {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext;

        if (!AudioCtxClass) {
          setState((prev) => ({
            ...prev,
            error: "Web Audio API not supported",
          }));
          return;
        }

        const ctx = new AudioCtxClass();
        audioContextRef.current = ctx;

        await ctx.audioWorklet.addModule("/lib/wasm/fftNoiseFilterWorklet.js");

        if (!mounted) return;

        const node = new AudioWorkletNode(ctx, "fft-noise-filter-processor", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });

        node.port.onmessage = (event) => {
          const data = event.data;
          switch (data.type) {
            case "ready":
              if (mounted) {
                setState((prev) => ({
                  ...prev,
                  isReady: true,
                  isWasm: true,
                  simdSupported: data.simdSupported,
                  fftSize: data.fftSize,
                  numBins: data.numBins,
                }));
              }
              break;
            case "frameProcessed":
              callbacksRef.current.onFrameProcessed?.({
                rms: data.rms,
                processingTimeMs: data.processingTimeMs,
              });
              break;
            case "spectrum":
              callbacksRef.current.onSpectrum?.({
                real: data.real,
                imag: data.imag,
              });
              break;
            case "noiseProfile":
              callbacksRef.current.onNoiseProfile?.(data.profile);
              break;
            case "error":
              if (mounted) {
                setState((prev) => ({ ...prev, error: data.error }));
              }
              callbacksRef.current.onError?.(data.error);
              break;
          }
        };

        workletNodeRef.current = node;

        if (wasmBinary) {
          node.port.postMessage({ type: "init", wasmBinary });
        } else {
          if (mounted) {
            setState((prev) => ({
              ...prev,
              isReady: true,
              isWasm: false,
            }));
          }
        }
      } catch (err) {
        if (mounted) {
          setState((prev) => ({
            ...prev,
            error: `Init failed: ${err instanceof Error ? err.message : String(err)}`,
          }));
        }
      }
    }

    init();

    return () => {
      mounted = false;
      workletNodeRef.current?.port.postMessage({ type: "destroy" });
      workletNodeRef.current?.disconnect();
      sourceNodeRef.current?.disconnect();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (
        audioContextRef.current &&
        audioContextRef.current.state !== "closed"
      ) {
        audioContextRef.current.close().catch(() => {});
      }
      audioContextRef.current = null;
      workletNodeRef.current = null;
      sourceNodeRef.current = null;
      streamRef.current = null;
      resetFFTNoiseFilter();
    };
  }, []);

  const start = useCallback(
    async (audioConstraints?: MediaStreamConstraints["audio"]) => {
      if (!audioContextRef.current || !workletNodeRef.current) {
        throw new Error("FFT Noise Filter not initialized");
      }

      const ctx = audioContextRef.current;
      if (ctx.state === "suspended") await ctx.resume();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints ?? {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
          sampleRate: 48000,
        },
      });

      streamRef.current = stream;
      const source = ctx.createMediaStreamSource(stream);
      sourceNodeRef.current = source;

      source.connect(workletNodeRef.current);
      workletNodeRef.current.connect(ctx.destination);

      setState((prev) => ({ ...prev, isProcessing: true, error: null }));
    },
    [],
  );

  const stop = useCallback(() => {
    sourceNodeRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    workletNodeRef.current?.port.postMessage({ type: "reset" });

    sourceNodeRef.current = null;
    streamRef.current = null;
    setState((prev) => ({ ...prev, isProcessing: false }));
  }, []);

  const setSensitivity = useCallback((value: number) => {
    workletNodeRef.current?.port.postMessage({
      type: "setSensitivity",
      sensitivity: Math.max(0, Math.min(1, value)),
    });
  }, []);

  const resetCalibration = useCallback(() => {
    workletNodeRef.current?.port.postMessage({ type: "reset" });
  }, []);

  const requestSpectrum = useCallback(() => {
    workletNodeRef.current?.port.postMessage({ type: "getSpectrum" });
  }, []);

  const requestNoiseProfile = useCallback(() => {
    workletNodeRef.current?.port.postMessage({ type: "getNoiseProfile" });
  }, []);

  return {
    state,
    start,
    stop,
    setSensitivity,
    resetCalibration,
    requestSpectrum,
    requestNoiseProfile,
  };
}
