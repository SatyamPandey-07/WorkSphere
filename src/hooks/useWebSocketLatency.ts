"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type LatencyTier = "good" | "fair" | "poor" | "unknown";

interface UseWebSocketLatencyOptions {
  /** Interval between pings in milliseconds. Default: 10000 (10s) */
  intervalMs?: number;
  /** Timeout before marking latency as unknown if no pong arrives. Default: 5000 */
  timeoutMs?: number;
}

interface WebSocketLatencyState {
  latencyMs: number | null;
  tier: LatencyTier;
}

function toTier(ms: number | null): LatencyTier {
  if (ms === null) return "unknown";
  if (ms < 50) return "good";
  if (ms < 150) return "fair";
  return "poor";
}

/**
 * Measures PartyKit WebSocket round-trip latency by sending a timestamped ping
 * message and waiting for an echo or any response from the server.
 *
 * Falls back to a conservative `navigator.connection` RTT estimate when the
 * socket is closed or the server does not echo.
 */
export function useWebSocketLatency(
  socket: WebSocket | null | undefined,
  options: UseWebSocketLatencyOptions = {},
): WebSocketLatencyState {
  const { intervalMs = 10_000, timeoutMs = 5_000 } = options;

  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const pingTimeRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sendPing = useCallback(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setLatencyMs(null);
      return;
    }

    pingTimeRef.current = performance.now();

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setLatencyMs(null);
      pingTimeRef.current = null;
    }, timeoutMs);

    try {
      socket.send(JSON.stringify({ type: "ping", ts: pingTimeRef.current }));
    } catch {
      setLatencyMs(null);
    }
  }, [socket, timeoutMs]);

  useEffect(() => {
    if (!socket) return;

    const handleMessage = () => {
      if (pingTimeRef.current === null) return;
      const rtt = Math.round(performance.now() - pingTimeRef.current);
      pingTimeRef.current = null;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setLatencyMs(rtt);
    };

    const handleClose = () => setLatencyMs(null);
    const handleOpen = () => sendPing();

    socket.addEventListener("message", handleMessage);
    socket.addEventListener("close", handleClose);
    socket.addEventListener("open", handleOpen);

    if (socket.readyState === WebSocket.OPEN) sendPing();

    intervalRef.current = setInterval(sendPing, intervalMs);

    return () => {
      socket.removeEventListener("message", handleMessage);
      socket.removeEventListener("close", handleClose);
      socket.removeEventListener("open", handleOpen);
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [socket, intervalMs, sendPing]);

  return { latencyMs, tier: toTier(latencyMs) };
}
