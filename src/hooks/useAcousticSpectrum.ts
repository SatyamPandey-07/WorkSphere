"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  attachAutoResumeListeners,
  AUDIO_RESUME_INTERACTION_EVENTS,
  type AudioResumeInteractionEvent,
  type AutoResumeOptions,
} from "@/lib/audio/spatialAudioEngine";

export {
  attachAutoResumeListeners,
  AUDIO_RESUME_INTERACTION_EVENTS,
  type AudioResumeInteractionEvent,
  type AutoResumeOptions,
};

export interface UseAcousticSpectrumOptions {
  /** Optional AudioContext to manage. */
  audioContext?: AudioContext | null;
  /** Optional AnalyserNode for spectrum FFT readouts. */
  analyserNode?: AnalyserNode | null;
  /** Whether to automatically attach global one-time interaction listeners for suspended context (#7766). Default: true. */
  autoResume?: boolean;
  /** Callback fired whenever AudioContext state transitions (e.g. suspended -> running). */
  onStateChange?: (state: AudioContextState) => void;
}

export interface UseAcousticSpectrumReturn {
  audioContext: AudioContext | null;
  analyserNode: AnalyserNode | null;
  audioState: AudioContextState | "uninitialized";
  isResumed: boolean;
  resumeAudio: () => Promise<void>;
  getFrequencyData: () => Float32Array;
}

/**
 * useAcousticSpectrum
 *
 * Custom React hook for Web Audio visualizer and acoustic spectrum management (#7766).
 * Automatically resumes suspended AudioContext upon the first user interaction
 * (click, keydown, touchstart) and tears down interaction listeners once running or on unmount.
 */
export function useAcousticSpectrum(
  optionsOrContext?: UseAcousticSpectrumOptions | AudioContext | null,
  maybeOptions?: UseAcousticSpectrumOptions,
): UseAcousticSpectrumReturn {
  const options: UseAcousticSpectrumOptions =
    optionsOrContext && "resume" in optionsOrContext
      ? { audioContext: optionsOrContext as AudioContext, ...maybeOptions }
      : (optionsOrContext as UseAcousticSpectrumOptions) || {};

  const {
    audioContext = null,
    analyserNode = null,
    autoResume = true,
    onStateChange,
  } = options;

  const [audioState, setAudioState] = useState<
    AudioContextState | "uninitialized"
  >(audioContext?.state || "uninitialized");
  const [isResumed, setIsResumed] = useState<boolean>(
    audioContext?.state === "running",
  );

  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  // Synchronize state when AudioContext prop changes or state changes
  useEffect(() => {
    if (!audioContext) {
      setAudioState("uninitialized");
      setIsResumed(false);
      return;
    }

    setAudioState(audioContext.state);
    setIsResumed(audioContext.state === "running");

    const handleState = () => {
      setAudioState(audioContext.state);
      setIsResumed(audioContext.state === "running");
      onStateChangeRef.current?.(audioContext.state);
    };

    if (typeof audioContext.addEventListener === "function") {
      audioContext.addEventListener("statechange", handleState);
      return () => {
        try {
          audioContext.removeEventListener("statechange", handleState);
        } catch {
          // Safe no-op
        }
      };
    }
  }, [audioContext]);

  // One-time global interaction listener to resume suspended audio context
  useEffect(() => {
    if (!autoResume || !audioContext || audioContext.state !== "suspended") {
      return;
    }

    const cleanup = attachAutoResumeListeners(audioContext, () => {
      setAudioState(audioContext.state);
      setIsResumed(audioContext.state === "running");
      onStateChangeRef.current?.(audioContext.state);
    });

    return cleanup;
  }, [audioContext, autoResume]);

  // Programmatic manual resume
  const resumeAudio = useCallback(async () => {
    if (!audioContext || audioContext.state !== "suspended") return;
    try {
      const p = audioContext.resume();
      if (p && typeof p.catch === "function") {
        await p.catch(() => {});
      }
    } catch {
      // Safe no-op
    } finally {
      const currentState = audioContext.state as AudioContextState;
      setAudioState(currentState);
      setIsResumed(currentState === "running");
      onStateChangeRef.current?.(currentState);
    }
  }, [audioContext]);

  // Cached buffer for frequency data reads
  const dataArrayRef = useRef<Float32Array | null>(null);

  const getFrequencyData = useCallback(() => {
    if (!analyserNode) {
      return new Float32Array(0);
    }
    const binCount = analyserNode.frequencyBinCount;
    if (!dataArrayRef.current || dataArrayRef.current.length !== binCount) {
      dataArrayRef.current = new Float32Array(binCount);
    }
    analyserNode.getFloatFrequencyData(dataArrayRef.current as any);
    return dataArrayRef.current;
  }, [analyserNode]);

  return {
    audioContext,
    analyserNode,
    audioState,
    isResumed,
    resumeAudio,
    getFrequencyData,
  };
}

export default useAcousticSpectrum;
