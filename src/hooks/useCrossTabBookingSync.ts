"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export const BOOKING_SYNC_CHANNEL_NAME = "worksphere:booking-sync";

export type BookingSyncActionType = "CHECK_IN" | "EXTEND" | "CANCEL";

export type BookingStatus = "idle" | "active" | "checked_in" | "cancelled" | "expired";

export interface BookingSyncMessage {
  type: BookingSyncActionType;
  bookingId: string;
  timestamp: number;
  newExpiresAt?: number;
  extendedMinutes?: number;
  tabId?: string;
}

export interface UseCrossTabBookingSyncOptions {
  bookingId?: string;
  initialExpiresAt?: number;
  initialStatus?: BookingStatus;
  channelName?: string;
  onSyncMessage?: (message: BookingSyncMessage) => void;
  onCheckIn?: (bookingId: string, timestamp: number) => void;
  onExtend?: (
    bookingId: string,
    newExpiresAt: number | undefined,
    timestamp: number,
  ) => void;
  onCancel?: (bookingId: string, timestamp: number) => void;
}

export interface UseCrossTabBookingSyncReturn {
  status: BookingStatus;
  expiresAt: number | undefined;
  timeRemainingSeconds: number;
  lastMessage: BookingSyncMessage | null;
  checkIn: (targetBookingId?: string) => void;
  extendBooking: (additionalMinutes?: number, targetBookingId?: string) => void;
  cancelBooking: (targetBookingId?: string) => void;
  broadcast: (message: Omit<BookingSyncMessage, "timestamp" | "tabId">) => void;
}

/**
 * Cross-tab booking state synchronization hook using the BroadcastChannel API (#6493).
 * Synchronizes active reservation countdown clocks, check-in confirmations, and cancellations
 * instantly across all open browser tabs without hitting the server.
 */
export function useCrossTabBookingSync(
  options: UseCrossTabBookingSyncOptions = {},
): UseCrossTabBookingSyncReturn {
  const {
    bookingId,
    initialExpiresAt,
    initialStatus = "active",
    channelName = BOOKING_SYNC_CHANNEL_NAME,
    onSyncMessage,
    onCheckIn,
    onExtend,
    onCancel,
  } = options;

  const [status, setStatus] = useState<BookingStatus>(initialStatus);
  const [expiresAt, setExpiresAt] = useState<number | undefined>(initialExpiresAt);
  const [timeRemainingSeconds, setTimeRemainingSeconds] = useState<number>(() => {
    if (!initialExpiresAt) return 0;
    return Math.max(0, Math.floor((initialExpiresAt - Date.now()) / 1000));
  });
  const [lastMessage, setLastMessage] = useState<BookingSyncMessage | null>(null);

  const channelRef = useRef<BroadcastChannel | null>(null);
  const tabIdRef = useRef<string>(
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `tab-${Math.random().toString(36).slice(2, 9)}`,
  );

  // Keep callback refs fresh
  const onSyncMessageRef = useRef(onSyncMessage);
  const onCheckInRef = useRef(onCheckIn);
  const onExtendRef = useRef(onExtend);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onSyncMessageRef.current = onSyncMessage;
    onCheckInRef.current = onCheckIn;
    onExtendRef.current = onExtend;
    onCancelRef.current = onCancel;
  });

  // Calculate and tick countdown timer every second
  useEffect(() => {
    if (!expiresAt || status === "cancelled" || status === "expired") {
      return;
    }

    const calculateRemaining = () => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setTimeRemainingSeconds(remaining);
      if (remaining === 0 && status !== "expired") {
        setStatus("expired");
      }
    };

    calculateRemaining();
    const interval = setInterval(calculateRemaining, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, status]);

  // Set up BroadcastChannel listener
  useEffect(() => {
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
      return;
    }

    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel(channelName);
      channelRef.current = channel;
    } catch {
      return;
    }

    const handleMessage = (event: MessageEvent<BookingSyncMessage>) => {
      const data = event.data;
      if (!data || !data.type || !data.bookingId) return;

      // Ignore messages broadcast by this same tab
      if (data.tabId === tabIdRef.current) return;

      // If hook is scoped to a specific bookingId, only process matching messages
      if (bookingId && data.bookingId !== bookingId) return;

      setLastMessage(data);
      onSyncMessageRef.current?.(data);

      switch (data.type) {
        case "CHECK_IN": {
          setStatus("checked_in");
          onCheckInRef.current?.(data.bookingId, data.timestamp);
          break;
        }
        case "EXTEND": {
          if (data.newExpiresAt) {
            setExpiresAt(data.newExpiresAt);
          } else if (data.extendedMinutes) {
            setExpiresAt((prev) => {
              const base = prev && prev > Date.now() ? prev : Date.now();
              return base + data.extendedMinutes! * 60 * 1000;
            });
          }
          setStatus("active");
          onExtendRef.current?.(
            data.bookingId,
            data.newExpiresAt,
            data.timestamp,
          );
          break;
        }
        case "CANCEL": {
          setStatus("cancelled");
          setTimeRemainingSeconds(0);
          onCancelRef.current?.(data.bookingId, data.timestamp);
          break;
        }
      }
    };

    channel.addEventListener("message", handleMessage);

    return () => {
      channel.removeEventListener("message", handleMessage);
      channel.close();
      channelRef.current = null;
    };
  }, [channelName, bookingId]);

  // Emitter function
  const broadcast = useCallback(
    (message: Omit<BookingSyncMessage, "timestamp" | "tabId">) => {
      const fullMessage: BookingSyncMessage = {
        ...message,
        timestamp: Date.now(),
        tabId: tabIdRef.current,
      };

      setLastMessage(fullMessage);

      if (channelRef.current) {
        try {
          channelRef.current.postMessage(fullMessage);
        } catch (err) {
          console.warn("[useCrossTabBookingSync] Broadcast failed:", err);
        }
      }
    },
    [],
  );

  const checkIn = useCallback(
    (targetBookingId?: string) => {
      const id = targetBookingId || bookingId;
      if (!id) return;
      setStatus("checked_in");
      broadcast({ type: "CHECK_IN", bookingId: id });
    },
    [bookingId, broadcast],
  );

  const extendBooking = useCallback(
    (additionalMinutes: number = 30, targetBookingId?: string) => {
      const id = targetBookingId || bookingId;
      if (!id) return;

      const base = expiresAt && expiresAt > Date.now() ? expiresAt : Date.now();
      const newExpires = base + additionalMinutes * 60 * 1000;

      setExpiresAt(newExpires);
      setStatus("active");

      broadcast({
        type: "EXTEND",
        bookingId: id,
        newExpiresAt: newExpires,
        extendedMinutes: additionalMinutes,
      });
    },
    [bookingId, expiresAt, broadcast],
  );

  const cancelBooking = useCallback(
    (targetBookingId?: string) => {
      const id = targetBookingId || bookingId;
      if (!id) return;

      setStatus("cancelled");
      setTimeRemainingSeconds(0);

      broadcast({ type: "CANCEL", bookingId: id });
    },
    [bookingId, broadcast],
  );

  return {
    status,
    expiresAt,
    timeRemainingSeconds,
    lastMessage,
    checkIn,
    extendBooking,
    cancelBooking,
    broadcast,
  };
}

export default useCrossTabBookingSync;
