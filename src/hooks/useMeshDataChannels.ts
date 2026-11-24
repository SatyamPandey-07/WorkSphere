import { useCallback, useEffect, useRef, useState } from "react";
import {
  useBatteryOptimization,
  type BatteryManagerLike,
} from "@/hooks/useBatteryOptimization";
import {
  AdaptiveAudioBitrateController,
  MAX_AUDIO_BITRATE_BPS,
  type AdaptiveAudioTelemetryEvent,
} from "@/lib/realtime/webrtc/meshConnection";

export interface CursorThrottleOptions {
  /** Minimum delta in pixels to trigger a broadcast (default: 2) */
  minDeltaPx?: number;
  /** Maximum broadcast rate in updates per second (default: 30) */
  maxRateHz?: number;
}

export interface UseMeshDataChannelsOptions {
  peerId: string;
  peerConnection:
    | (Pick<RTCPeerConnection, "getStats" | "getSenders"> & {
        addEventListener?: RTCPeerConnection["addEventListener"];
      })
    | null;
  sampleIntervalMs?: number;
  onTelemetry?: (event: AdaptiveAudioTelemetryEvent) => void;
  getBatteryFn?: () => Promise<BatteryManagerLike>;
  cursorThrottle?: CursorThrottleOptions;
}

export interface CursorAwarenessState {
  lastSentX: number;
  lastSentY: number;
  lastUpdateTime: number;
}

function defaultCursorThrottleOptions(): CursorThrottleOptions {
  return {
    minDeltaPx: 2,
    maxRateHz: 30,
  };
}

/** Classifies peer connection quality based on RTT and packet loss. */
export function classifyPeerQuality(
  rttMs?: number | null,
  packetLossPercent?: number | null,
): "good" | "fair" | "poor" | "unknown" {
  const rttValid = typeof rttMs === "number" && !isNaN(rttMs) && rttMs >= 0;
  const lossValid =
    typeof packetLossPercent === "number" &&
    !isNaN(packetLossPercent) &&
    packetLossPercent >= 0;

  if (!rttValid && !lossValid) {
    return "unknown";
  }

  if (!rttValid || !lossValid) {
    // If one is invalid, use the valid one if it leads to a determinate result
    if (
      !rttValid &&
      lossValid &&
      packetLossPercent !== undefined &&
      packetLossPercent !== null
    ) {
      return packetLossPercent < 1
        ? "good"
        : packetLossPercent > 5
          ? "poor"
          : "fair";
    }
    if (rttValid && !lossValid && rttMs !== undefined && rttMs !== null) {
      return rttMs < 100 ? "good" : rttMs > 250 ? "poor" : "fair";
    }
  }

  const rtt = rttMs as number;
  const loss = packetLossPercent as number;

  // Both valid: Poor takes priority: RTT > 250ms or loss > 5%
  if (rtt > 250 || loss > 5) {
    return "poor";
  }

  // Good: RTT < 100ms and loss < 1%
  if (rtt < 100 && loss < 1) {
    return "good";
  }

  // Fair: 100ms <= RTT <= 250ms or 1% <= loss <= 5%
  if ((100 <= rtt && rtt <= 250) || (1 <= loss && loss <= 5)) {
    return "fair";
  }

  return "fair";
}

export function useMeshDataChannels({
  peerId,
  peerConnection,
  sampleIntervalMs = 1_000,
  onTelemetry,
  getBatteryFn,
  cursorThrottle,
}: UseMeshDataChannelsOptions) {
  const [audioBitrateBps, setAudioBitrateBps] = useState<number>(
    MAX_AUDIO_BITRATE_BPS,
  );
  const [lastTelemetry, setLastTelemetry] =
    useState<AdaptiveAudioTelemetryEvent | null>(null);
  const controllerRef = useRef<AdaptiveAudioBitrateController | null>(null);

  const batteryOptimization = useBatteryOptimization(getBatteryFn);
  const effectiveCursorThrottle =
    cursorThrottle ?? defaultCursorThrottleOptions();
  const minDeltaPx = effectiveCursorThrottle.minDeltaPx ?? 2;
  const maxRateHz = effectiveCursorThrottle.maxRateHz ?? 30;

  const [cursorState, setCursorState] = useState<CursorAwarenessState>({
    lastSentX: 0,
    lastSentY: 0,
    lastUpdateTime: 0,
  });
  const cursorRef = useRef<CursorAwarenessState>({
    lastSentX: 0,
    lastSentY: 0,
    lastUpdateTime: 0,
  });

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
        Date.now(),
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

  const handleCursorUpdate = useCallback(
    (x: number, y: number) => {
      const now = Date.now();
      const timeSinceLastUpdate = now - cursorRef.current.lastUpdateTime;
      const maxRateIntervalMs = 1000 / maxRateHz;

      // Check rate limit
      if (timeSinceLastUpdate < maxRateIntervalMs) {
        return;
      }

      // Check minimum delta
      const dx = Math.abs(x - cursorRef.current.lastSentX);
      const dy = Math.abs(y - cursorRef.current.lastSentY);
      if (dx <= minDeltaPx && dy <= minDeltaPx) {
        return;
      }

      const nextState: CursorAwarenessState = {
        lastSentX: x,
        lastSentY: y,
        lastUpdateTime: now,
      };
      cursorRef.current = nextState;
      setCursorState(nextState);
    },
    [maxRateHz, minDeltaPx],
  );

  return {
    audioBitrateBps,
    lastTelemetry,
    isLowPowerMode: batteryOptimization.isLowPowerMode,
    crdtBatchIntervalMs: batteryOptimization.crdtBatchIntervalMs,
    pauseDecorativeAnimations: batteryOptimization.pauseDecorativeAnimations,
    fftSize: batteryOptimization.fftSize,
    cursorState,
    handleCursorUpdate,
  };
}
