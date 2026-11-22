import { useEffect, useRef, useState } from 'react';
import {
  AdaptiveAudioBitrateController,
  MAX_AUDIO_BITRATE_BPS,
  type AdaptiveAudioTelemetryEvent,
} from '@/lib/realtime/webrtc/meshConnection';

export interface UseMeshDataChannelsOptions {
  peerId: string;
  peerConnection: (Pick<RTCPeerConnection, 'getStats' | 'getSenders'> & {
    addEventListener?: RTCPeerConnection['addEventListener'];
  }) | null;
  sampleIntervalMs?: number;
  onTelemetry?: (event: AdaptiveAudioTelemetryEvent) => void;
}

export function useMeshDataChannels({
  peerId,
  peerConnection,
  sampleIntervalMs = 1_000,
  onTelemetry,
}: UseMeshDataChannelsOptions) {
  const [audioBitrateBps, setAudioBitrateBps] = useState<number>(
    MAX_AUDIO_BITRATE_BPS
  );
  const [lastTelemetry, setLastTelemetry] =
    useState<AdaptiveAudioTelemetryEvent | null>(null);
  const controllerRef = useRef<AdaptiveAudioBitrateController | null>(null);

  useEffect(() => {
    const controller = new AdaptiveAudioBitrateController(peerId, {
      onTelemetry: (evt) => {
        setLastTelemetry(evt);
        setAudioBitrateBps(evt.nextBitrateBps);
        onTelemetry?.(evt);
      },
    });
    controllerRef.current = controller;

    if (!peerConnection) return;

    let cancelled = false;
    const poll = async () => {
      if (cancelled || !controllerRef.current) return;
      const next = await controllerRef.current.sampleAndAdapt(
        peerConnection,
        Date.now()
      );
      if (!cancelled) {
        setAudioBitrateBps(next);
      }
    };

    const timerId = setInterval(() => {
      void poll();
    }, sampleIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(timerId);
    };
  }, [peerId, peerConnection, sampleIntervalMs, onTelemetry]);

  return {
    audioBitrateBps,
    lastTelemetry,
  };
}