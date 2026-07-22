"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  initEqualizer,
  updateBand,
  processAudioBlock,
  getFrequencyResponse,
  resetEqualizer,
  DEFAULT_BANDS,
  type EqBand,
  type FrequencyResponse,
} from "@/lib/wasm/audioEqualizer";

export type EqState = {
  bands: EqBand[];
  bypass: boolean;
  isReady: boolean;
  isProcessing: boolean;
  error: string | null;
};

export type UseAudioEqualizerReturn = {
  state: EqState;
  setBand: (index: number, gain: number) => Promise<void>;
  setBandFull: (index: number, frequency: number, q: number, gain: number) => Promise<void>;
  toggleBypass: () => void;
  resetBands: () => Promise<void>;
  frequencyResponse: FrequencyResponse | null;
  refreshResponse: () => Promise<void>;
  processAudio: (samples: Float32Array) => Promise<Float32Array>;
};

export function useAudioEqualizer(
  initialBands: EqBand[] = DEFAULT_BANDS,
  sampleRate = 44100,
): UseAudioEqualizerReturn {
  const [state, setState] = useState<EqState>({
    bands: initialBands,
    bypass: false,
    isReady: false,
    isProcessing: false,
    error: null,
  });
  const [frequencyResponse, setFrequencyResponse] = useState<FrequencyResponse | null>(null);
  const bandsRef = useRef(initialBands);
  const sampleRateRef = useRef(sampleRate);

  useEffect(() => {
    let mounted = true;

    async function setup() {
      try {
        await initEqualizer(initialBands, sampleRate);
        if (mounted) {
          setState((prev) => ({ ...prev, isReady: true }));
          const resp = await getFrequencyResponse(initialBands, sampleRate);
          if (mounted) setFrequencyResponse(resp);
        }
      } catch (err) {
        if (mounted) {
          setState((prev) => ({
            ...prev,
            error: `Failed to initialize equalizer: ${err instanceof Error ? err.message : String(err)}`,
          }));
        }
      }
    }

    setup();

    return () => {
      mounted = false;
      resetEqualizer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setBand = useCallback(async (index: number, gain: number) => {
    const bands = bandsRef.current;
    if (index < 0 || index >= bands.length) return;

    const updated = bands.map((b, i) =>
      i === index ? { ...b, gain } : b,
    );
    bandsRef.current = updated;

    setState((prev) => ({ ...prev, bands: updated, isProcessing: true }));

    try {
      await updateBand(index, bands[index].frequency, bands[index].q, gain);
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: `Failed to update band: ${err instanceof Error ? err.message : String(err)}`,
      }));
    } finally {
      setState((prev) => ({ ...prev, isProcessing: false }));
    }
  }, []);

  const setBandFull = useCallback(
    async (index: number, frequency: number, q: number, gain: number) => {
      const bands = bandsRef.current;
      if (index < 0 || index >= bands.length) return;

      const updated = bands.map((b, i) =>
        i === index ? { frequency, q, gain } : b,
      );
      bandsRef.current = updated;

      setState((prev) => ({ ...prev, bands: updated, isProcessing: true }));

      try {
        await updateBand(index, frequency, q, gain);
      } catch (err) {
        setState((prev) => ({
          ...prev,
          error: `Failed to update band: ${err instanceof Error ? err.message : String(err)}`,
        }));
      } finally {
        setState((prev) => ({ ...prev, isProcessing: false }));
      }
    },
    [],
  );

  const toggleBypass = useCallback(() => {
    setState((prev) => ({ ...prev, bypass: !prev.bypass }));
  }, []);

  const resetBands = useCallback(async () => {
    bandsRef.current = DEFAULT_BANDS;
    setState((prev) => ({ ...prev, bands: DEFAULT_BANDS, isProcessing: true }));

    try {
      await initEqualizer(DEFAULT_BANDS, sampleRateRef.current);
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: `Failed to reset: ${err instanceof Error ? err.message : String(err)}`,
      }));
    } finally {
      setState((prev) => ({ ...prev, isProcessing: false }));
    }
  }, []);

  const refreshResponse = useCallback(async () => {
    try {
      const resp = await getFrequencyResponse(bandsRef.current, sampleRateRef.current);
      setFrequencyResponse(resp);
    } catch {
      // silently fail for response refresh
    }
  }, []);

  const processAudio = useCallback(
    async (samples: Float32Array) => {
      if (state.bypass) return samples;
      return processAudioBlock(samples);
    },
    [state.bypass],
  );

  return {
    state,
    setBand,
    setBandFull,
    toggleBypass,
    resetBands,
    frequencyResponse,
    refreshResponse,
    processAudio,
  };
}
