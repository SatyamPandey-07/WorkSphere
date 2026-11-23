"use client";

import React from "react";
import {
  ChatInput as BaseChatInput,
  type Venue,
  type ClientVenue,
  type Message,
  VenueChatCard,
  VenueListings,
  MessageList,
} from "./ChatMessages";
import {
  getStoredUnreadCount,
  markRoomAsRead,
  setStoredUnreadCount,
} from "@/lib/chat/unreadTracker";

export interface ChatInputProps {
  input: string;
  isLoading: boolean;
  onInputChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  distanceRadius?: number;
  onDistanceChange?: (radius: number) => void;
  roomId?: string | null;
  userId?: string | null;
  onFocus?: () => void;
}

/**
 * ChatInput
 *
 * Wraps BaseChatInput and provides room unread state clearing whenever
 * the input or container gains focus.
 */
export function ChatInput({
  roomId = "default",
  userId = null,
  onFocus,
  ...props
}: ChatInputProps) {
  const activeRoom = roomId || "default";

  const handleFocus = () => {
    // Automatically clear badge count when user focuses the chat input
    markRoomAsRead(activeRoom, userId);
    onFocus?.();
  };

  return (
    <div onFocus={handleFocus} data-testid="chat-input-wrapper">
      <BaseChatInput {...props} />
    </div>
  );
}

export {
  BaseChatInput,
  type Venue,
  type ClientVenue,
  type Message,
  VenueChatCard,
  VenueListings,
  MessageList,
  getStoredUnreadCount,
  markRoomAsRead,
  setStoredUnreadCount,
};

export default ChatInput;
