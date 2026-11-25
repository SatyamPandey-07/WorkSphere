"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  getLastReadTimestamp,
  getStoredUnreadCount,
  markRoomAsRead,
  setStoredUnreadCount,
  UNREAD_MESSAGES_CHANGED_EVENT,
} from "@/lib/chat/unreadTracker";

export interface ChatChannelMessage {
  id?: string;
  senderId?: string;
  senderName?: string;
  content?: string;
  timestamp: number;
  roomId?: string;
  isSystem?: boolean;
  [key: string]: unknown;
}

export interface UseChatChannelOptions {
  roomId?: string;
  currentUserId?: string | null;
  currentUserName?: string | null;
  initialIsOpen?: boolean;
  initialMessages?: ChatChannelMessage[];
  onBroadcastMessage?: (message: ChatChannelMessage) => void;
}

/**
 * Derives the localStorage key for persisting channel message history.
 */
export function getChatHistoryStorageKey(
  roomId: string = "default",
  userId?: string | null,
): string {
  const cleanRoom = roomId || "default";
  const userPrefix = userId ? `u:${userId}:` : "";
  return `ws-chat-history:${userPrefix}room:${cleanRoom}`;
}

/**
 * Retrieves persisted channel message history from localStorage.
 */
export function getStoredChatHistory(
  roomId: string = "default",
  userId?: string | null,
): ChatChannelMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(getChatHistoryStorageKey(roomId, userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Stores channel message history to localStorage.
 */
export function setStoredChatHistory(
  messages: ChatChannelMessage[],
  roomId: string = "default",
  userId?: string | null,
): void {
  if (typeof window === "undefined") return;
  try {
    // Only persist non-system messages
    const toStore = messages.filter((m) => !m.isSystem);
    localStorage.setItem(
      getChatHistoryStorageKey(roomId, userId),
      JSON.stringify(toStore),
    );
  } catch {
    // Ignore quota issues
  }
}

/**
 * Removes channel message history from localStorage.
 */
export function clearStoredChatHistory(
  roomId: string = "default",
  userId?: string | null,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(getChatHistoryStorageKey(roomId, userId));
  } catch {
    // Graceful fallback
  }
}

export function useChatChannel(options: UseChatChannelOptions = {}) {
  const {
    roomId = "default",
    currentUserId = null,
    currentUserName = null,
    initialIsOpen = false,
    initialMessages = [],
    onBroadcastMessage,
  } = options;

  const [isOpen, setIsOpen] = useState(initialIsOpen);
  const [lastReadTimestamp, setLastReadTimestamp] = useState<number>(() =>
    getLastReadTimestamp(roomId, currentUserId),
  );
  const [unreadCount, setUnreadCount] = useState<number>(() => {
    if (initialIsOpen) return 0;
    return getStoredUnreadCount(roomId, currentUserId);
  });
  const processedMessageIdsRef = useRef<Set<string>>(new Set());

  // Messages state initialized from localStorage or initialMessages
  const [messages, setMessages] = useState<ChatChannelMessage[]>(() => {
    const stored = getStoredChatHistory(roomId, currentUserId);
    if (stored.length > 0) {
      return stored;
    }
    return initialMessages;
  });

  // Keep lastReadTimestamp synced and clear unread when drawer is opened
  useEffect(() => {
    if (isOpen) {
      const now = Date.now();
      setLastReadTimestamp(now);
      setUnreadCount(0);
      markRoomAsRead(roomId, currentUserId, now);
    }
  }, [isOpen, roomId, currentUserId]);

  // Listen to cross-component unread changes
  useEffect(() => {
    const handleUnreadChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ roomId: string; count: number }>;
      if (
        customEvent.detail &&
        (!customEvent.detail.roomId || customEvent.detail.roomId === roomId)
      ) {
        if (!isOpen) {
          setUnreadCount(customEvent.detail.count);
        }
      }
    };

    window.addEventListener(UNREAD_MESSAGES_CHANGED_EVENT, handleUnreadChange);
    return () => {
      window.removeEventListener(
        UNREAD_MESSAGES_CHANGED_EVENT,
        handleUnreadChange,
      );
    };
  }, [roomId, isOpen]);

  const openChat = useCallback(() => {
    setIsOpen(true);
    const now = Date.now();
    setLastReadTimestamp(now);
    setUnreadCount(0);
    markRoomAsRead(roomId, currentUserId, now);
  }, [roomId, currentUserId]);

  const closeChat = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggleChat = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      if (next) {
        const now = Date.now();
        setLastReadTimestamp(now);
        setUnreadCount(0);
        markRoomAsRead(roomId, currentUserId, now);
      }
      return next;
    });
  }, [roomId, currentUserId]);

  const clearUnread = useCallback(() => {
    const now = Date.now();
    setLastReadTimestamp(now);
    setUnreadCount(0);
    markRoomAsRead(roomId, currentUserId, now);
  }, [roomId, currentUserId]);

  /**
   * Resets the current channel's message history from React state and localStorage,
   * resets the unread count to 0, and injects an inline system note: "Chat history cleared locally."
   */
  const clearChatHistory = useCallback(() => {
    // 1. Remove persisted history from localStorage for current channel
    clearStoredChatHistory(roomId, currentUserId);

    // 2. Reset unread count to 0 and mark room as read
    const now = Date.now();
    setLastReadTimestamp(now);
    setUnreadCount(0);
    markRoomAsRead(roomId, currentUserId, now);

    // 3. Clear processed message ID deduplication set to prevent stale message tracking (#10122)
    processedMessageIdsRef.current.clear();

    // 4. Set messages in state to only contain the inline system notice
    const systemNotice: ChatChannelMessage = {
      id: `sys-clear-${now}-${Math.random().toString(36).substring(2, 9)}`,
      senderName: "System",
      content: "Chat history cleared locally.",
      timestamp: now,
      roomId,
      isSystem: true,
    };

    setMessages([systemNotice]);
  }, [roomId, currentUserId]);

  /**
   * Submits a message to the channel.
   * If the input is `/clear` (case-insensitive, whitespace trimmed),
   * it intercepts the command, resets local history/unread count,
   * adds an inline system note, and does NOT broadcast to peers.
   *
   * Otherwise, it creates a normal chat message, persists it,
   * updates state, and invokes onBroadcastMessage.
   *
   * Returns true if intercepted as a slash command, false if normal message.
   */
  const sendMessage = useCallback(
    (rawContent: string, senderOverride?: { id?: string; name?: string }) => {
      if (!rawContent) return false;
      const trimmed = rawContent.trim();

      // Intercept /clear command
      if (trimmed.toLowerCase() === "/clear") {
        clearChatHistory();
        return true;
      }

      // Normal message submission
      const now = Date.now();
      const sId = senderOverride?.id ?? currentUserId ?? "user-local";
      const sName = senderOverride?.name ?? currentUserName ?? "You";

      const newMessage: ChatChannelMessage = {
        id: `msg-${now}-${Math.random().toString(36).substring(2, 9)}`,
        senderId: sId,
        senderName: sName,
        content: rawContent,
        timestamp: now,
        roomId,
      };

      setMessages((prev) => {
        // Exclude system notices when appending normal messages if we want clean history, or keep them
        const next = [...prev, newMessage];
        setStoredChatHistory(next, roomId, currentUserId);
        return next;
      });

      // Update last read timestamp for user's own sent message
      setLastReadTimestamp(now);

      // Broadcast to room peers if callback provided
      onBroadcastMessage?.(newMessage);

      return false;
    },
    [
      clearChatHistory,
      currentUserId,
      currentUserName,
      roomId,
      onBroadcastMessage,
    ],
  );

  const onIncomingMessage = useCallback(
    (message: ChatChannelMessage) => {
      // Deduplicate by message ID if present
      if (message.id) {
        if (processedMessageIdsRef.current.has(message.id)) {
          return;
        }
        processedMessageIdsRef.current.add(message.id);
      }

      // Add incoming message to state and persistence
      setMessages((prev) => {
        const next = [...prev, message];
        setStoredChatHistory(next, roomId, currentUserId);
        return next;
      });

      // If sent by current user, don't increment unread count
      if (
        (currentUserId && message.senderId === currentUserId) ||
        (currentUserName && message.senderName === currentUserName)
      ) {
        setLastReadTimestamp((prev) => Math.max(prev, message.timestamp));
        return;
      }

      // If drawer is open, message is immediately marked as read
      if (isOpen) {
        setLastReadTimestamp((prev) => {
          const newReadTime = Math.max(prev, message.timestamp);
          markRoomAsRead(roomId, currentUserId, newReadTime);
          return newReadTime;
        });
        return;
      }

      // Increment unread counter if message timestamp > lastReadTimestamp and drawer is closed
      setLastReadTimestamp((prevLastRead) => {
        if (message.timestamp > prevLastRead) {
          setUnreadCount((prevCount) => {
            const next = prevCount + 1;
            setStoredUnreadCount(next, roomId, currentUserId);
            return next;
          });
        }
        return prevLastRead;
      });
    },
    [isOpen, currentUserId, currentUserName, roomId],
  );

  return {
    isOpen,
    setIsOpen,
    openChat,
    closeChat,
    toggleChat,
    unreadCount,
    setUnreadCount,
    lastReadTimestamp,
    setLastReadTimestamp,
    onIncomingMessage,
    clearUnread,
    messages,
    setMessages,
    clearChatHistory,
    sendMessage,
  };
}

export default useChatChannel;
