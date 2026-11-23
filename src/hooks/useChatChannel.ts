'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  getLastReadTimestamp,
  getStoredUnreadCount,
  markRoomAsRead,
  setStoredUnreadCount,
  UNREAD_MESSAGES_CHANGED_EVENT,
} from '@/lib/chat/unreadTracker';

export interface ChatChannelMessage {
  id?: string;
  senderId?: string;
  senderName?: string;
  content?: string;
  timestamp: number;
  roomId?: string;
  [key: string]: unknown;
}

export interface UseChatChannelOptions {
  roomId?: string;
  currentUserId?: string | null;
  currentUserName?: string | null;
  initialIsOpen?: boolean;
}

export function useChatChannel(options: UseChatChannelOptions = {}) {
  const {
    roomId = 'default',
    currentUserId = null,
    currentUserName = null,
    initialIsOpen = false,
  } = options;

  const [isOpen, setIsOpen] = useState(initialIsOpen);
  const [lastReadTimestamp, setLastReadTimestamp] = useState<number>(() =>
    getLastReadTimestamp(roomId, currentUserId)
  );
  const [unreadCount, setUnreadCount] = useState<number>(() => {
    if (initialIsOpen) return 0;
    return getStoredUnreadCount(roomId, currentUserId);
  });
  const processedMessageIdsRef = useRef<Set<string>>(new Set());

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
      window.removeEventListener(UNREAD_MESSAGES_CHANGED_EVENT, handleUnreadChange);
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

  const onIncomingMessage = useCallback(
    (message: ChatChannelMessage) => {
      // Deduplicate by message ID if present
      if (message.id) {
        if (processedMessageIdsRef.current.has(message.id)) {
          return;
        }
        processedMessageIdsRef.current.add(message.id);
      }

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
    [isOpen, currentUserId, currentUserName, roomId]
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
  };
}

export default useChatChannel;
