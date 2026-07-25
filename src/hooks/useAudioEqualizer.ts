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

// Standard preset gain configurations (assuming 10-band EQ)
export const AUDIO_PRESETS: Record<string, number[]> = {
  "Flat": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "Voice Clarity": [-4, -2, 0, 2, 4, 4, 3, 1, 0, -2],
  "Noise Suppression": [-6, -6, -3, 0, 2, 2, 0, -3, -6, -6],
  "Bass Boost": [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
};

export type EqState = {
  bands: EqBand[];
  bypass: boolean;
  isReady: boolean;
  isProcessing: boolean;
  error: string | null;
  activePreset: string;
};

export type UseAudioEqualizerReturn = {
  state: EqState;
  setBand: (index: number, gain: number) => Promise<void>;
  setBandFull: (
    index: number,
    frequency: number,
    q: number,
    gain: number,
  ) => Promise<void>;
  applyPreset: (presetName: string) => Promise<void>;
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
    activePreset: "Flat",
  });
  
  const [frequencyResponse, setFrequencyResponse] =
    useState<FrequencyResponse | null>(null);
  
  const bandsRef = useRef(initialBands);
  const sampleRateRef = useRef(sampleRate);
  const audioContextRef = useRef<AudioContext | null>(null);
  const filterNodesRef = useRef<Array<AudioWorkletNode | AudioNode>>([]);

  useEffect(() => {
    let mounted = true;

    async function setup() {
      try {
        if (
          typeof window !== "undefined" &&
          ("AudioContext" in window || "webkitAudioContext" in window)
        ) {
          const AudioCtxClass =
            window.AudioContext || (window as any).webkitAudioContext;
          if (AudioCtxClass && !audioContextRef.current) {
            audioContextRef.current = new AudioCtxClass();
          }
        }

        // Load preset from localStorage
        let setupBands = initialBands;
        let savedPreset = "Flat";
        if (typeof window !== "undefined") {
          savedPreset = window.localStorage.getItem("eq_preset") || "Flat";
          if (AUDIO_PRESETS[savedPreset]) {
            const gains = AUDIO_PRESETS[savedPreset];
            setupBands = initialBands.map((b, i) => ({
              ...b,
              gain: gains[i] ?? 0,
            }));
          }
        }

        bandsRef.current = setupBands;
        
        if (mounted) {
          setState((prev) => ({ 
            ...prev, 
            bands: setupBands, 
            activePreset: savedPreset 
          }));
        }

        await initEqualizer(setupBands, sampleRate);
        
        if (mounted) {
          setState((prev) => ({ ...prev, isReady: true }));
          const resp = await getFrequencyResponse(setupBands, sampleRate);
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
      // Disconnect all AudioWorkletNode filter bands explicitly in cleanup function (#1285)
      if (filterNodesRef.current && filterNodesRef.current.length > 0) {
        filterNodesRef.current.forEach((node) => {
          try {
            node.disconnect();
          } catch {
            // Already disconnected
          }
        });
        filterNodesRef.current = [];
      }

      // Close AudioContext instance when parent component unmounts (#1285)
      if (
        audioContextRef.current &&
        audioContextRef.current.state !== "closed"
      ) {
        try {
          audioContextRef.current.close();
        } catch {
          // Already closed
        }
        audioContextRef.current = null;
      }

      resetEqualizer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyPreset = useCallback(async (presetName: string) => {
    const gains = AUDIO_PRESETS[presetName];
    if (!gains) return;

    if (typeof window !== "undefined") {
      window.localStorage.setItem("eq_preset", presetName);
    }

    const currentBands = bandsRef.current;
    const updated = currentBands.map((b, i) => ({
      ...b,
      gain: gains[i] ?? 0,
    }));

    bandsRef.current = updated;
    setState((prev) => ({ 
      ...prev, 
      bands: updated, 
      isProcessing: true, 
      activePreset: presetName 
    }));

    try {
      // Sequentially update all nodes
      for (let i = 0; i < updated.length; i++) {
        await updateBand(i, updated[i].frequency, updated[i].q, updated[i].gain);
      }
      
      const resp = await getFrequencyResponse(updated, sampleRateRef.current);
      setFrequencyResponse(resp);
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: `Failed to apply preset: ${err instanceof Error ? err.message : String(err)}`,
      }));
    } finally {
      setState((prev) => ({ ...prev, isProcessing: false }));
    }
  }, []);

  const setBand = useCallback(async (index: number, gain: number) => {
    const bands = bandsRef.current;
    if (index < 0 || index >= bands.length) return;

    const updated = bands.map((b, i) => (i === index ? { ...b, gain } : b));
    bandsRef.current = updated;

    if (typeof window !== "undefined") {
      window.localStorage.setItem("eq_preset", "Custom");
    }

    setState((prev) => ({ 
      ...prev, 
      bands: updated, 
      isProcessing: true, 
      activePreset: "Custom" 
    }));

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

      if (typeof window !== "undefined") {
        window.localStorage.setItem("eq_preset", "Custom");
      }

      setState((prev) => ({ 
        ...prev, 
        bands: updated, 
        isProcessing: true,
        activePreset: "Custom" 
      }));

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
    
    if (typeof window !== "undefined") {
      window.localStorage.setItem("eq_preset", "Flat");
    }
    
    setState((prev) => ({ 
      ...prev, 
      bands: DEFAULT_BANDS, 
      isProcessing: true,
      activePreset: "Flat"
    }));

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
      const resp = await getFrequencyResponse(
        bandsRef.current,
        sampleRateRef.current,
      );
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
    applyPreset,
    toggleBypass,
    resetBands,
    frequencyResponse,
    refreshResponse,
    processAudio,
  };
}
