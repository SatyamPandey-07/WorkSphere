 fix/telemetry-ws-backoff-jitter
﻿"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type TelemetrySocketStatus =
  "connecting" | "open" | "reconnecting" | "closed" | "error";

export interface UseTelemetryWebSocketOptions {
  /** Base reconnect delay in ms (default: 500ms). */
  baseDelayMs?: number;
  /** Maximum reconnect delay ceiling in ms (default: 30000ms). */
  maxDelayMs?: number;
  /** Optional message handler invoked only while hook is mounted. */
  onMessage?: (event: MessageEvent) => void;
  /** Optional open callback invoked after reconnectAttempts resets to 0. */
  onOpen?: (event: Event) => void;
  /** Optional close callback. */
  onClose?: (event: CloseEvent) => void;
  /** Optional error callback. */
  onError?: (event: Event) => void;
}

export interface UseTelemetryWebSocketResult {
  status: TelemetrySocketStatus;
  reconnectAttempts: number;
  lastMessage: unknown;
  sendJson: (payload: unknown) => boolean;
  disconnect: (code?: number, reason?: string) => void;
  reconnect: () => void;
}

const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 30_000;

/**
 * Computes capped exponential backoff with +/-25% randomized jitter:
 * delay = Math.min(30000, 500 * 2 ** attempt) * (0.75 + Math.random() * 0.5)
 */
export function computeBackoffWithJitter(
  attempt: number,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
): number {
  const capped = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  const jitterFactor = 0.75 + Math.random() * 0.5;
  return Math.round(capped * jitterFactor);
}

function detachSocketHandlers(ws: WebSocket | null): void {
  if (!ws) return;
  ws.onopen = null;
  ws.onmessage = null;
  ws.onerror = null;
  ws.onclose = null;
}

export function useTelemetryWebSocket(
  url: string | null,
  options: UseTelemetryWebSocketOptions = {},
): UseTelemetryWebSocketResult {
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  const [status, setStatus] = useState<TelemetrySocketStatus>(
    url ? "connecting" : "closed",
  );
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [lastMessage, setLastMessage] = useState<unknown>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectRef = useRef<(() => void) | null>(null);
  const attemptsRef = useRef(0);
  const manualDisconnectRef = useRef(false);
  const mountedRef = useRef(true);

  const callbacksRef = useRef(options);
  useEffect(() => {
    callbacksRef.current = options;
  });

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const teardownSocket = useCallback(
    (code = 1000, reason = "Client disconnect") => {
      clearReconnectTimer();
      const ws = wsRef.current;
      wsRef.current = null;
      if (!ws) return;

      detachSocketHandlers(ws);
      if (
        ws.readyState === WebSocket.CONNECTING ||
        ws.readyState === WebSocket.OPEN
      ) {
        try {
          ws.close(code, reason);
        } catch {
          // Ignore close errors if socket already transitioned
        }
      }
    },
    [clearReconnectTimer],
  );

  const connect = useCallback(() => {
    if (!url || !mountedRef.current || manualDisconnectRef.current) return;

    teardownSocket();
    if (mountedRef.current) {
      setStatus(attemptsRef.current > 0 ? "reconnecting" : "connecting");
    }

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = (event: Event) => {
      if (!mountedRef.current || wsRef.current !== ws) {
        detachSocketHandlers(ws);
        return;
      }
      attemptsRef.current = 0;
      setReconnectAttempts(0);
      setStatus("open");
      callbacksRef.current.onOpen?.(event);
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!mountedRef.current || wsRef.current !== ws) return;
      let parsed: unknown = event.data;
      if (typeof event.data === "string") {
        try {
          parsed = JSON.parse(event.data);
        } catch {
          parsed = event.data;
        }
      }
      setLastMessage(parsed);
      callbacksRef.current.onMessage?.(event);
    };

    ws.onerror = (event: Event) => {
      if (!mountedRef.current || wsRef.current !== ws) return;
      setStatus("error");
      callbacksRef.current.onError?.(event);
    };

    ws.onclose = (event: CloseEvent) => {
      detachSocketHandlers(ws);
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      if (!mountedRef.current) return;

      callbacksRef.current.onClose?.(event);

      if (event.code === 1000 || manualDisconnectRef.current) {
        setStatus("closed");
        return;
      }

      const attempt = attemptsRef.current;
      attemptsRef.current = attempt + 1;
      setReconnectAttempts(attemptsRef.current);
      setStatus("reconnecting");

      const delay = computeBackoffWithJitter(attempt, baseDelayMs, maxDelayMs);
      clearReconnectTimer();
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (mountedRef.current && !manualDisconnectRef.current) {
          connectRef.current?.();
        }
      }, delay);
    };
  }, [url, baseDelayMs, maxDelayMs, teardownSocket, clearReconnectTimer]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const disconnect = useCallback(
    (code = 1000, reason = "Intentional disconnect") => {
      manualDisconnectRef.current = true;
      teardownSocket(code, reason);
      if (mountedRef.current) {
        setStatus("closed");
      }
    },
    [teardownSocket],
  );

  const reconnect = useCallback(() => {
    manualDisconnectRef.current = false;
    attemptsRef.current = 0;
    setReconnectAttempts(0);
    connect();
  }, [connect]);

  const sendJson = useCallback((payload: unknown): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    manualDisconnectRef.current = false;
    attemptsRef.current = 0;
    setReconnectAttempts(0);

    if (url) {
      connect();
    } else {
      setStatus("closed");
    }

    return () => {
      mountedRef.current = false;
      manualDisconnectRef.current = true;
      teardownSocket(1000, "Component unmount");
    };
  }, [url, connect, teardownSocket]);

  return {
    status,
    reconnectAttempts,
    lastMessage,
    sendJson,
    disconnect,
    reconnect,

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  TelemetryConnectionStatus,
  TelemetryWebSocketClient,
} from "@/lib/telemetry/wsClient";

interface UseTelemetryWebSocketOptions {
  url?: string;
  enabled?: boolean;
  onMessage?: (data: unknown) => void;
}

export interface UseTelemetryWebSocketResult {
  status: TelemetryConnectionStatus;
  sessionWarning: string | null;
  reconnectManually: () => void;
  dismissWarning: () => void;
}

export function useTelemetryWebSocket({
  url = process.env.NEXT_PUBLIC_TELEMETRY_WS_URL ??
    "ws://localhost:3001/telemetry",
  enabled = true,
  onMessage,
}: UseTelemetryWebSocketOptions = {}): UseTelemetryWebSocketResult {
  const { getToken, isSignedIn } = useAuth();
  const [status, setStatus] = useState<TelemetryConnectionStatus>("idle");
  const [sessionWarning, setSessionWarning] = useState<string | null>(null);

  const clientRef = useRef<TelemetryWebSocketClient | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!enabled) {
      clientRef.current?.disconnect();
      clientRef.current = null;
      setStatus("disconnected");
      return;
    }

    if (isSignedIn === false) {
      clientRef.current?.disconnect();
      clientRef.current = null;
      setStatus("session_expired");
      setSessionWarning(
        "You are signed out. Sign in to reconnect live telemetry.",
      );
      return;
    }

    if (isSignedIn === undefined) {
      return;
    }

    const client = new TelemetryWebSocketClient({
      url,
      getToken: (opts) => getToken(opts),
      onMessage: (data) => onMessageRef.current?.(data),
      onStatusChange: (nextStatus, warning) => {
        setStatus(nextStatus);
        if (nextStatus === "connected") {
          setSessionWarning(null);
        } else if (nextStatus === "session_expired" && warning) {
          setSessionWarning(warning);
        }
      },
    });

    clientRef.current = client;
    void client.connect(false);

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [url, enabled, isSignedIn, getToken]);

  const reconnectManually = useCallback(() => {
    setSessionWarning(null);
    if (clientRef.current) {
      void clientRef.current.connect(true);
    }
  }, []);

  const dismissWarning = useCallback(() => {
    setSessionWarning(null);
  }, []);

  return {
    status,
    sessionWarning,
    reconnectManually,
    dismissWarning,
 main
  };
}

export default useTelemetryWebSocket;
