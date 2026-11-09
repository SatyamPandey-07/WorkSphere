"use client";

import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Ambient NetworkInformation interface for navigator.connection
 */
export interface NetworkInformation extends EventTarget {
  type?: "bluetooth" | "cellular" | "ethernet" | "none" | "wifi" | "wimax" | "other" | "unknown" | string;
  effectiveType?: "2g" | "3g" | "4g" | "5g" | "slow-2g" | string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
  onchange?: ((this: NetworkInformation, ev: Event) => any) | null;
}

export interface WebRTCReconnectOptions {
  /**
   * Primary RTCPeerConnection to monitor.
   */
  peerConnection?: RTCPeerConnection | null;

  /**
   * Optional map or dictionary of multiple peer connections (e.g. in mesh topology).
   */
  peerConnections?: Map<string, RTCPeerConnection> | Record<string, RTCPeerConnection> | null;

  /**
   * Callback fired to send signaling payload to remote peer(s) via WebSocket.
   */
  onSignalingSend?: (signal: {
    type: string;
    kind: string;
    peerId?: string;
    sdp?: RTCSessionDescriptionInit;
    iceRestart: boolean;
  }) => void | Promise<void>;

  /**
   * Custom hook/callback when ICE restart is triggered.
   */
  onIceRestart?: (peerId?: string) => void | Promise<void>;

  /**
   * Callback on successful connection recovery.
   */
  onReconnectSuccess?: (peerId?: string) => void;

  /**
   * Callback when max retry attempts (3) are exhausted.
   */
  onReconnectFailed?: (peerId?: string, error?: Error) => void;

  /**
   * Max ICE restart retry attempts. Default: 3.
   */
  maxRetries?: number;

  /**
   * Base delay in milliseconds for exponential backoff. Default: 300ms.
   */
  baseDelayMs?: number;

  /**
   * Exponential backoff factor. Default: 2.
   */
  backoffFactor?: number;
}

export interface WebRTCReconnectState {
  isReconnecting: boolean;
  retryCount: number;
  networkType: string;
  effectiveType: string;
  lastTransitionTime: number | null;
  iceState: RTCIceConnectionState | "unknown";
  triggerIceRestart: (peerId?: string) => Promise<boolean>;
  resetRetryCount: (peerId?: string) => void;
}

export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_BASE_DELAY_MS = 300;
export const DEFAULT_BACKOFF_FACTOR = 2;

/**
 * Calculates exponential backoff delay capped at maximum retry attempts.
 * Attempt 1: baseDelay (e.g. 300ms)
 * Attempt 2: baseDelay * 2 (e.g. 600ms)
 * Attempt 3: baseDelay * 4 (e.g. 1200ms)
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelayMs: number = DEFAULT_BASE_DELAY_MS,
  factor: number = DEFAULT_BACKOFF_FACTOR
): number {
  if (attempt <= 1) return baseDelayMs;
  return baseDelayMs * Math.pow(factor, attempt - 1);
}

/**
 * Executes an ICE restart on an RTCPeerConnection by invoking restartIce()
 * and creating a renegotiation offer with { iceRestart: true }.
 */
export async function performIceRestart(
  pc: RTCPeerConnection,
  peerId?: string,
  onSignalingSend?: WebRTCReconnectOptions["onSignalingSend"]
): Promise<RTCSessionDescriptionInit | null> {
  if (!pc) return null;

  try {
    // 1. Invoke standard restartIce() if supported by the browser implementation
    if (typeof pc.restartIce === "function") {
      pc.restartIce();
    }

    // 2. Create renegotiation offer with explicit iceRestart flag
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);

    // 3. Dispatch renegotiation signaling offer to remote peer
    if (onSignalingSend) {
      await onSignalingSend({
        type: "webrtc-signal",
        kind: "offer",
        peerId,
        sdp: offer,
        iceRestart: true,
      });
    }

    return offer;
  } catch (error) {
    console.error("[useWebRTCReconnect] Failed to perform ICE restart:", error);
    throw error;
  }
}

/**
 * Custom hook monitoring navigator.connection and peer connection ICE connection states.
 * Automatically initiates seamless ICE restart with exponential backoff capped at 3 retries
 * when switching networks (e.g. cellular 5G to venue WiFi) or when ICE state enters disconnected/failed.
 */
export function useWebRTCReconnect({
  peerConnection,
  peerConnections,
  onSignalingSend,
  onIceRestart,
  onReconnectSuccess,
  onReconnectFailed,
  maxRetries = DEFAULT_MAX_RETRIES,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  backoffFactor = DEFAULT_BACKOFF_FACTOR,
}: WebRTCReconnectOptions = {}): WebRTCReconnectState {
  const [isReconnecting, setIsReconnecting] = useState<boolean>(false);
  const [retryCount, setRetryCount] = useState<number>(0);
  const [networkType, setNetworkType] = useState<string>("unknown");
  const [effectiveType, setEffectiveType] = useState<string>("unknown");
  const [lastTransitionTime, setLastTransitionTime] = useState<number | null>(null);
  const [iceState, setIceState] = useState<RTCIceConnectionState | "unknown">("unknown");

  const retryCountRef = useRef<number>(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isNetworkTransitionPendingRef = useRef<boolean>(false);
  const isReconnectingRef = useRef<boolean>(false);

  // Keep references to latest callbacks
  const onSignalingSendRef = useRef(onSignalingSend);
  const onIceRestartRef = useRef(onIceRestart);
  const onReconnectSuccessRef = useRef(onReconnectSuccess);
  const onReconnectFailedRef = useRef(onReconnectFailed);

  useEffect(() => {
    onSignalingSendRef.current = onSignalingSend;
    onIceRestartRef.current = onIceRestart;
    onReconnectSuccessRef.current = onReconnectSuccess;
    onReconnectFailedRef.current = onReconnectFailed;
  });

  const resetRetryCount = useCallback((_peerId?: string) => {
    retryCountRef.current = 0;
    setRetryCount(0);
    isReconnectingRef.current = false;
    setIsReconnecting(false);
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  // Trigger ICE restart with backoff
  const triggerIceRestart = useCallback(
    async (targetPeerId?: string): Promise<boolean> => {
      if (retryCountRef.current >= maxRetries) {
        console.warn(
          `[useWebRTCReconnect] Max ICE restart retries (${maxRetries}) exceeded.`
        );
        isReconnectingRef.current = false;
        setIsReconnecting(false);
        const err = new Error(`Max ICE restart retries (${maxRetries}) exceeded`);
        onReconnectFailedRef.current?.(targetPeerId, err);
        return false;
      }

      const nextAttempt = retryCountRef.current + 1;
      retryCountRef.current = nextAttempt;
      setRetryCount(nextAttempt);
      isReconnectingRef.current = true;
      setIsReconnecting(true);

      const delay = calculateBackoffDelay(nextAttempt, baseDelayMs, backoffFactor);

      return new Promise<boolean>((resolve) => {
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
        }

        retryTimeoutRef.current = setTimeout(async () => {
          try {
            // Find target peer connections
            const pcsToRestart: Array<{ id?: string; pc: RTCPeerConnection }> = [];

            if (peerConnection) {
              pcsToRestart.push({ id: targetPeerId, pc: peerConnection });
            }

            if (peerConnections) {
              if (peerConnections instanceof Map) {
                if (targetPeerId && peerConnections.has(targetPeerId)) {
                  pcsToRestart.push({
                    id: targetPeerId,
                    pc: peerConnections.get(targetPeerId)!,
                  });
                } else {
                  peerConnections.forEach((pc, id) => {
                    pcsToRestart.push({ id, pc });
                  });
                }
              } else if (typeof peerConnections === "object") {
                if (targetPeerId && peerConnections[targetPeerId]) {
                  pcsToRestart.push({
                    id: targetPeerId,
                    pc: peerConnections[targetPeerId],
                  });
                } else {
                  Object.entries(peerConnections).forEach(([id, pc]) => {
                    if (pc) pcsToRestart.push({ id, pc });
                  });
                }
              }
            }

            // Execute ICE restart for each connection
            for (const { id, pc } of pcsToRestart) {
              await performIceRestart(pc, id, onSignalingSendRef.current);
              onIceRestartRef.current?.(id);
            }

            resolve(true);
          } catch (error) {
            console.error(
              `[useWebRTCReconnect] ICE restart attempt ${nextAttempt} failed:`,
              error
            );
            if (nextAttempt >= maxRetries) {
              isReconnectingRef.current = false;
              setIsReconnecting(false);
              onReconnectFailedRef.current?.(targetPeerId, error as Error);
            }
            resolve(false);
          }
        }, delay);
      });
    },
    [
      peerConnection,
      peerConnections,
      maxRetries,
      baseDelayMs,
      backoffFactor,
    ]
  );

  // Monitor navigator.connection changes (Cellular <-> WiFi transitions)
  useEffect(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return;

    const nav = navigator as any;
    const connection: NetworkInformation | undefined =
      nav.connection || nav.mozConnection || nav.webkitConnection;

    const handleNetworkChange = () => {
      const currentType = connection?.type || "unknown";
      const currentEffectiveType = connection?.effectiveType || "unknown";

      setNetworkType(currentType);
      setEffectiveType(currentEffectiveType);
      const now = Date.now();
      setLastTransitionTime(now);
      isNetworkTransitionPendingRef.current = true;

      // If connection is in disconnected or failed state during IP change, trigger ICE restart immediately
      if (
        iceState === "disconnected" ||
        iceState === "failed" ||
        peerConnection?.iceConnectionState === "disconnected" ||
        peerConnection?.iceConnectionState === "failed"
      ) {
        triggerIceRestart();
      }
    };

    if (connection) {
      setNetworkType(connection.type || "unknown");
      setEffectiveType(connection.effectiveType || "unknown");
      connection.addEventListener?.("change", handleNetworkChange);
    }

    const handleOnline = () => {
      setLastTransitionTime(Date.now());
      isNetworkTransitionPendingRef.current = true;
      triggerIceRestart();
    };

    window.addEventListener("online", handleOnline);

    return () => {
      if (connection) {
        connection.removeEventListener?.("change", handleNetworkChange);
      }
      window.removeEventListener("online", handleOnline);
    };
  }, [iceState, peerConnection, triggerIceRestart]);

  // Monitor RTCPeerConnection ICE state changes
  useEffect(() => {
    const pcs: RTCPeerConnection[] = [];

    if (peerConnection) {
      pcs.push(peerConnection);
    }

    if (peerConnections) {
      if (peerConnections instanceof Map) {
        peerConnections.forEach((pc) => {
          if (pc) pcs.push(pc);
        });
      } else if (typeof peerConnections === "object") {
        Object.values(peerConnections).forEach((pc) => {
          if (pc) pcs.push(pc);
        });
      }
    }

    if (pcs.length === 0) return;

    const cleanups: Array<() => void> = [];

    pcs.forEach((pc) => {
      const handleIceStateChange = () => {
        const state = pc.iceConnectionState;
        setIceState(state);

        if (state === "connected" || state === "completed") {
          // Successfully restored or established connection
          if (isReconnectingRef.current || retryCountRef.current > 0) {
            resetRetryCount();
            onReconnectSuccessRef.current?.();
          }
        } else if (state === "disconnected" || state === "failed") {
          // Trigger ICE restart upon disconnected or failed state
          triggerIceRestart();
        }
      };

      pc.addEventListener("iceconnectionstatechange", handleIceStateChange);
      // Initialize current state
      setIceState(pc.iceConnectionState);

      cleanups.push(() => {
        pc.removeEventListener("iceconnectionstatechange", handleIceStateChange);
      });
    });

    return () => {
      cleanups.forEach((cleanup) => cleanup());
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, [peerConnection, peerConnections, resetRetryCount, triggerIceRestart]);

  return {
    isReconnecting,
    retryCount,
    networkType,
    effectiveType,
    lastTransitionTime,
    iceState,
    triggerIceRestart,
    resetRetryCount,
  };
}

export default useWebRTCReconnect;
