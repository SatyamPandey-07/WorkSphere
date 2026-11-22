'use client';

import { useEffect, useMemo, useRef } from 'react';
import {
  getPowerOptimizationProfile,
  useBatteryOptimization,
  type BatteryState,
  type PowerOptimizationProfile,
} from '@/hooks/useBatteryOptimization';

export interface MeshDataChannelLike {
  readyState?: RTCDataChannelState | string;
  send(data: string | ArrayBuffer | ArrayBufferView): void;
}

export interface UseMeshDataChannelsOptions {
  channels?: Record<string, MeshDataChannelLike | null | undefined>;
  onFlushBatch?: (
    messages: unknown[],
    profile: PowerOptimizationProfile
  ) => void;
  batteryOverride?: BatteryState;
}

export interface UseMeshDataChannelsResult {
  batteryState: BatteryState;
  powerProfile: PowerOptimizationProfile;
  crdtBatchIntervalMs: number;
  fftSize: number;
  pauseDecorativeAnimations: boolean;
  queueCrdtUpdate: (update: unknown) => void;
  flushNow: () => void;
}

export function useMeshDataChannels(
  options: UseMeshDataChannelsOptions = {}
): UseMeshDataChannelsResult {
  const detectedBattery = useBatteryOptimization();
  const batteryState = options.batteryOverride ?? detectedBattery;
  const powerProfile = useMemo(
    () => getPowerOptimizationProfile(batteryState.isLowPower),
    [batteryState.isLowPower]
  );

  const pendingRef = useRef<unknown[]>([]);
  const onFlushRef = useRef(options.onFlushBatch);
  const channelsRef = useRef(options.channels);
  const profileRef = useRef(powerProfile);

  onFlushRef.current = options.onFlushBatch;
  channelsRef.current = options.channels;
  profileRef.current = powerProfile;

  const flushNow = () => {
    if (pendingRef.current.length === 0) return;
    const batch = pendingRef.current.splice(0, pendingRef.current.length);
    const activeProfile = profileRef.current;

    if (onFlushRef.current) {
      onFlushRef.current(batch, activeProfile);
      return;
    }

    const activeChannels = channelsRef.current ?? {};
    for (const ch of Object.values(activeChannels)) {
      if (!ch) continue;
      if (!ch.readyState || ch.readyState === 'open') {
        ch.send(
          JSON.stringify({
            type: 'crdt_batch',
            batchIntervalMs: activeProfile.crdtBatchIntervalMs,
            items: batch,
          })
        );
      }
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      flushNow();
    }, powerProfile.crdtBatchIntervalMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [powerProfile.crdtBatchIntervalMs]);

  const queueCrdtUpdate = (update: unknown) => {
    pendingRef.current.push(update);
  };

  return {
    batteryState,
    powerProfile,
    crdtBatchIntervalMs: powerProfile.crdtBatchIntervalMs,
    fftSize: powerProfile.fftSize,
    pauseDecorativeAnimations: powerProfile.pauseDecorativeAnimations,
    queueCrdtUpdate,
    flushNow,
  };
}