/**
 * Real-time Updates using Server-Sent Events (SSE) and PartySocket Protobuf Messaging
 * Provides live updates for venue ratings and availability
 */

"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import usePartySocket from "@/hooks/usePartySocket";
import YProvider from "y-partykit/provider";
import * as Y from "yjs";
import { useHydrationComplete } from "@/hooks/useHydrationComplete";

import { encodeBinaryMessage, decodeIncomingMessage, RawEnvelope } from "@/party/binaryMessageBroker";

export {
  ConnectionStatus,
  type ConnectionStatusProps,
} from "@/components/realtime/ConnectionStatus";

interface VenueUpdate {
  type: "rating" | "availability" | "new_review";
  venueId: string;
  data: Record<string, unknown>;
  timestamp: number;
}

interface UseRealTimeUpdatesOptions {
  venueIds?: string[];
  enabled?: boolean;
}

/**
 * Hook for subscribing to real-time venue updates
 */
export function useRealTimeUpdates(options: UseRealTimeUpdatesOptions = {}) {
  const { venueIds = [], enabled = true } = options;
  const [updates, setUpdates] = useState<VenueUpdate[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearUpdates = useCallback(() => {
    setUpdates([]);
  }, [setUpdates]);

  const venueIdsKey = venueIds.slice().sort().join(",");

  useEffect(() => {
    const ids = venueIdsKey ? venueIdsKey.split(",") : [];
    if (!enabled || ids.length === 0) return;

    let eventSource: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout>;
    let currentBackoff = 1000;

    const connect = () => {
      clearTimeout(reconnectTimeout);

      if (typeof window !== "undefined" && !window.navigator.onLine) {
        setIsConnected(false);
        setError("Browser is offline");
        return;
      }

      const params = new URLSearchParams();
      ids.forEach((id) => params.append("venueId", id));

      eventSource = new EventSource(`/api/venues/updates?${params.toString()}`);

      eventSource.onopen = () => {
        setIsConnected(true);
        setError(null);
        currentBackoff = 1000;
        console.log("[RealTime] Connected to updates stream");
      };

      eventSource.onmessage = (event) => {
        try {
          const update = JSON.parse(event.data) as VenueUpdate;
          if (
            update.type === "rating" ||
            update.type === "availability" ||
            update.type === "new_review"
          ) {
            setUpdates((prev) => [...prev.slice(-49), update]);
          }
        } catch (e) {
          console.error("[RealTime] Failed to parse update:", e);
        }
      };

      eventSource.onerror = () => {
        setIsConnected(false);
        const isOffline =
          typeof window !== "undefined" && !window.navigator.onLine;

        setError(
          isOffline ? "Browser is offline" : "Connection failed. Retrying...",
        );
        eventSource?.close();

        console.warn(
          `[RealTime] Connection failed. Retrying in ${currentBackoff / 1000}s...`,
        );
        clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(connect, currentBackoff);
        currentBackoff = Math.min(30000, currentBackoff * 2);
      };
    };

    const handleOnline = () => {
      console.log("[RealTime] Browser online, reconnecting...");
      currentBackoff = 1000;
      connect();
    };

    const handleOffline = () => {
      console.log("[RealTime] Browser offline, pausing stream");
      setIsConnected(false);
      setError("Browser is offline");
      eventSource?.close();
      clearTimeout(reconnectTimeout);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        console.log("[RealTime] Tab focused, checking stream health...");
        if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
          currentBackoff = 1000;
          connect();
        }
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    connect();

    return () => {
      eventSource?.close();
      clearTimeout(reconnectTimeout);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [venueIdsKey, enabled]);

  return { updates, isConnected, error, clearUpdates };
}

/**
 * Hook for optimistic updates with rollback
 */
export function useOptimisticUpdate<T>(
  initialValue: T,
  updateFn: (value: T) => Promise<T>,
) {
  const [value, setValue] = useState(initialValue);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const update = useCallback(
    async (newValue: T) => {
      const previousValue = valueRef.current;
      setValue(newValue);
      setIsPending(true);
      setError(null);

      try {
        const confirmedValue = await updateFn(newValue);
        setValue(confirmedValue);
      } catch (e) {
        setValue(previousValue);
        setError(e instanceof Error ? e.message : "Update failed");
      } finally {
        setIsPending(false);
      }
    },
    [updateFn],
  );

  return { value, update, isPending, error };
}

/**
 * Polling-based updates for simpler real-time needs
 */
export function usePollingUpdates<T>(
  fetchFn: () => Promise<T>,
  interval: number = 30000,
  enabled: boolean = true,
) {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await fetchFn();
      setData(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setIsLoading(false);
    }
  }, [fetchFn]);

  useEffect(() => {
    if (!enabled) return;

    refresh();
    const intervalId = setInterval(refresh, interval);

    return () => clearInterval(intervalId);
  }, [enabled, interval, refresh]);

  return { data, isLoading, error, refresh };
}

/**
 * Multiplayer session hook supporting Protobuf binary messaging
 */
export function useMultiplayerSession(roomId: string | null) {
  const [provider, setProvider] = useState<YProvider | null>(null);
  const [yDoc, setYDoc] = useState<Y.Doc | null>(null);
  const { getToken } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const isHydrated = useHydrationComplete();

  useEffect(() => {
    getToken().then(setToken).catch(console.error);
  }, [getToken]);

  useEffect(() => {
    if (!isHydrated || !roomId || token === null) {
      setProvider(null);
      setYDoc(null);
      return;
    }

    const doc = new Y.Doc();
    const newProvider = new YProvider("127.0.0.1:1999", roomId, doc, {
      params: token ? { token } : {},
    });

    setYDoc(doc);
    setProvider(newProvider);

    return () => {
      newProvider.disconnect();
      doc.destroy();
    };
  }, [roomId, token, isHydrated]);

  const socket = usePartySocket({
    host: "127.0.0.1:1999",
    room: isHydrated && roomId ? roomId : "placeholder",
    startClosed: !isHydrated,
    query: token ? { token } : undefined,
    onMessage(event) {
      try {
        if (event.data) {
          decodeIncomingMessage(event.data);
        }
      } catch (err) {
        console.error("[RealTime] Failed to decode protobuf socket message:", err);
      }
    },
  });

  const sendBinaryMessage = useCallback(
    (envelope: RawEnvelope) => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        try {
          const binaryBuffer = encodeBinaryMessage(envelope);
          const arrayBuffer = binaryBuffer.buffer.slice(
            binaryBuffer.byteOffset,
            binaryBuffer.byteOffset + binaryBuffer.byteLength
          );
          socket.send(arrayBuffer);
        } catch (err) {
          socket.send(JSON.stringify(envelope));
        }
      }
    },
    [socket]
  );

  return { provider, yDoc, socket, sendBinaryMessage, isHydrated };
}