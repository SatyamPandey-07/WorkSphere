// src/hooks/useAvionicsAudio.ts

import { useState, useEffect, useRef, useCallback } from 'react';

const SINK_STORAGE_KEY = 'avionics_preferred_audio_sink_id';

export function useAvionicsAudio() {
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedSinkId, setSelectedSinkId] = useState<string>('default');
  const audioContextRef = useRef<AudioContext | null>(null);

  // Load preferred sinkId from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(SINK_STORAGE_KEY);
      if (saved) {
        setSelectedSinkId(saved);
      }
    }
  }, []);

  // Enumerate available audio output devices
  useEffect(() => {
    async function fetchDevices() {
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const outputs = devices.filter((device) => device.kind === 'audiooutput');
          setAudioDevices(outputs);
        }
      } catch (e) {
        console.error('Failed to enumerate audio output devices:', e);
      }
    }

    fetchDevices();

    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', fetchDevices);
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', fetchDevices);
      };
    }
  }, []);

  // Update sinkId and persist in localStorage
  const setAudioSink = useCallback(async (deviceId: string) => {
    setSelectedSinkId(deviceId);
    if (typeof window !== 'undefined') {
      localStorage.setItem(SINK_STORAGE_KEY, deviceId);
    }

    if (audioContextRef.current) {
      const ctx = audioContextRef.current as AudioContext & { setSinkId?: (id: string) => Promise<void> };
      if (typeof ctx.setSinkId === 'function') {
        try {
          await ctx.setSinkId(deviceId);
        } catch (e) {
          console.error('Error applying audio context setSinkId:', e);
        }
      }
    }
  }, []);

  // Get or initialize AudioContext with sinkId routing
  const getAudioContext = useCallback(async () => {
    if (!audioContextRef.current) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextClass() as AudioContext & { setSinkId?: (id: string) => Promise<void> };

      if (typeof ctx.setSinkId === 'function' && selectedSinkId) {
        try {
          await ctx.setSinkId(selectedSinkId);
        } catch (e) {
          console.error('Failed to set initial audio sinkId:', e);
        }
      }
      audioContextRef.current = ctx;
    }
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, [selectedSinkId]);

  return {
    audioDevices,
    selectedSinkId,
    setAudioSink,
    getAudioContext,
  };
}