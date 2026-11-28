"use client";

import { useEffect, useState, useCallback, useRef } from "react";

export const UNREAD_MESSAGES_CHANGED_EVENT = "worksphere:unread-messages-changed";

export interface UnreadBadgeDetail {
  roomId: string;
  count: number;
}

export interface StoredMessageRecord {
  id: string;
  senderId?: string;
  senderName?: string;
  timestamp: number;
  roomId?: string;
}

/**
 * Format count for unread badge UI:
 * - 0: ""
 * - 1..99: "1".."99"
 * - >99: "99+"
 */
export function formatUnreadCount(count: number): string {
  if (count <= 0) return "";
  if (count > 99) return "99+";
  return String(count);
}

/**
 * Generates localStorage key scoped by room and optional user.
 */
export function getUnreadStorageKey(roomId: string = "default", userId?: string | null): string {
  const cleanRoom = roomId || "default";
  const userPrefix = userId ? `u:${userId}:` : "";
  return `ws-unread:${userPrefix}room:${cleanRoom}`;
}

export function getLastReadTimestampKey(roomId: string = "default", userId?: string | null): string {
  const cleanRoom = roomId || "default";
  const userPrefix = userId ? `u:${userId}:` : "";
  return `ws-last-read:${userPrefix}room:${cleanRoom}`;
}

/**
 * Reads last read timestamp from localStorage.
 */
export function getLastReadTimestamp(roomId: string = "default", userId?: string | null): number {
  if (typeof window === "undefined") return 0;
  try {
    const val = localStorage.getItem(getLastReadTimestampKey(roomId, userId));
    return val ? parseInt(val, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

/**
 * Stores last read timestamp to localStorage and resets unread message count.
 */
export function markRoomAsRead(roomId: string = "default", userId?: string | null, timestamp?: number): void {
  if (typeof window === "undefined") return;
  const readTime = timestamp ?? Date.now();
  try {
    localStorage.setItem(getLastReadTimestampKey(roomId, userId), String(readTime));
    localStorage.setItem(getUnreadStorageKey(roomId, userId), "0");
  } catch {
    // Graceful fallback for quota or private mode
  }

  // Dispatch custom event to notify all components in this window
  window.dispatchEvent(
    new CustomEvent(UNREAD_MESSAGES_CHANGED_EVENT, {
      detail: { roomId: roomId || "default", count: 0 },
    }),
  );
}

/**
 * Get current unread count from localStorage.
 */
export function getStoredUnreadCount(roomId: string = "default", userId?: string | null): number {
  if (typeof window === "undefined") return 0;
  try {
    const val = localStorage.getItem(getUnreadStorageKey(roomId, userId));
    return val ? parseInt(val, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

/**
 * Updates stored unread count in localStorage and dispatches window event.
 */
export function setStoredUnreadCount(count: number, roomId: string = "default", userId?: string | null): void {
  if (typeof window === "undefined") return;
  const safeCount = Math.max(0, count);
  try {
    localStorage.setItem(getUnreadStorageKey(roomId, userId), String(safeCount));
  } catch {
    // Ignore quota issues
  }
  window.dispatchEvent(
    new CustomEvent(UNREAD_MESSAGES_CHANGED_EVENT, {
      detail: { roomId: roomId || "default", count: safeCount },
    }),
  );
}

export interface UseUnreadMessageTrackingOptions {
  roomId?: string | null;
  currentUserId?: string | null;
  currentUserName?: string | null;
  isChatOpen?: boolean;
}

/**
 * Hook to track unread messages for a room.
 */
export function useUnreadMessageTracking({
  roomId = "default",
  currentUserId = null,
  currentUserName = null,
  isChatOpen = false,
}: UseUnreadMessageTrackingOptions = {}) {
  const activeRoom = roomId || "default";
  const [unreadCount, setUnreadCount] = useState<number>(() =>
    getStoredUnreadCount(activeRoom, currentUserId),
  );

  // Set of message IDs seen to deduplicate incoming messages
  const seenMessageIdsRef = useRef<Set<string>>(new Set());

  // Sync state whenever roomId or currentUserId changes
  useEffect(() => {
    seenMessageIdsRef.current.clear();
    const count = getStoredUnreadCount(activeRoom, currentUserId);
    setUnreadCount(count);
  }, [activeRoom, currentUserId]);

  // When chat opens / focuses, reset unread count immediately
  useEffect(() => {
    if (isChatOpen) {
      markRoomAsRead(activeRoom, currentUserId);
      setUnreadCount(0);
    }
  }, [isChatOpen, activeRoom, currentUserId]);

  // Listen to custom event and storage events (cross-tab sync)
  useEffect(() => {
    const handleUnreadChange = (event: Event) => {
      const customEvent = event as CustomEvent<UnreadBadgeDetail>;
      if (customEvent.detail && (!customEvent.detail.roomId || customEvent.detail.roomId === activeRoom)) {
        setUnreadCount(customEvent.detail.count);
      }
    };

    const handleStorage = (event: StorageEvent) => {
      const expectedKey = getUnreadStorageKey(activeRoom, currentUserId);
      if (event.key === expectedKey) {
        const newCount = event.newValue ? parseInt(event.newValue, 10) || 0 : 0;
        setUnreadCount(newCount);
      }
    };

    window.addEventListener(UNREAD_MESSAGES_CHANGED_EVENT, handleUnreadChange);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(UNREAD_MESSAGES_CHANGED_EVENT, handleUnreadChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, [activeRoom, currentUserId]);

  /**
   * Process a newly arrived incoming message:
   * - Deduplicates by ID
   * - Excludes current user's messages
   * - Excludes historical messages older than last read timestamp
   * - If chat is open, doesn't increment unread count
   */
  const processIncomingMessage = useCallback(
    (msg: StoredMessageRecord, isHistorical: boolean = false) => {
      if (!msg || !msg.id) return;

      // 1. Deduplicate by message ID
      if (seenMessageIdsRef.current.has(msg.id)) {
        return;
      }
      seenMessageIdsRef.current.add(msg.id);

      // 2. Ignore messages sent by current user
      const isSelf =
        (currentUserId && msg.senderId && currentUserId === msg.senderId) ||
        (currentUserName && msg.senderName && currentUserName.toLowerCase() === msg.senderName.toLowerCase());

      if (isSelf) {
        return;
      }

      // 3. Ignore if chat is currently open and visible
      if (isChatOpen) {
        markRoomAsRead(activeRoom, currentUserId, msg.timestamp || Date.now());
        return;
      }

      // 4. Do not count historical messages loaded on mount
      if (isHistorical) {
        return;
      }

      // 5. Compare against last read timestamp
      const lastRead = getLastReadTimestamp(activeRoom, currentUserId);
      if (msg.timestamp && msg.timestamp <= lastRead) {
        return;
      }

      // 6. Increment unread count
      setUnreadCount((prev) => {
        const next = prev + 1;
        setStoredUnreadCount(next, activeRoom, currentUserId);
        return next;
      });
    },
    [activeRoom, currentUserId, currentUserName, isChatOpen],
  );

  const clearUnread = useCallback(() => {
    markRoomAsRead(activeRoom, currentUserId);
    setUnreadCount(0);
  }, [activeRoom, currentUserId]);

  return {
    unreadCount,
    unreadDisplay: formatUnreadCount(unreadCount),
    processIncomingMessage,
    clearUnread,
  };
}
