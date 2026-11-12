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
  };
}

export default useTelemetryWebSocket;
