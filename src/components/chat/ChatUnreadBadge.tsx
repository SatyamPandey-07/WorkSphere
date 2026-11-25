"use client";

import React, { useEffect, useState } from "react";
import {
  formatUnreadCount,
  getStoredUnreadCount,
  UNREAD_MESSAGES_CHANGED_EVENT,
  type UnreadBadgeDetail,
} from "@/lib/chat/unreadTracker";

export interface ChatUnreadBadgeProps {
  roomId?: string | null;
  count?: number;
  className?: string;
  size?: "sm" | "md";
}

/**
 * ChatUnreadBadge
 *
 * Renders an accessible numerical badge (1-99+) over the collaborative room chat
 * floating action button or navigation icon.
 *
 * When count is 0 or less, nothing is rendered.
 */
export function ChatUnreadBadge({
  roomId = "default",
  count: propCount,
  className = "",
  size = "sm",
}: ChatUnreadBadgeProps) {
  const activeRoom = roomId || "default";
  const [internalCount, setInternalCount] = useState<number>(() =>
    propCount !== undefined ? propCount : getStoredUnreadCount(activeRoom),
  );

  useEffect(() => {
    if (propCount !== undefined) {
      setInternalCount(propCount);
      return;
    }

    setInternalCount(getStoredUnreadCount(activeRoom));

    const handleUnreadChange = (event: Event) => {
      const customEvent = event as CustomEvent<UnreadBadgeDetail>;
      if (
        customEvent.detail &&
        (!customEvent.detail.roomId || customEvent.detail.roomId === activeRoom)
      ) {
        setInternalCount(customEvent.detail.count);
      }
    };

    window.addEventListener(UNREAD_MESSAGES_CHANGED_EVENT, handleUnreadChange);
    return () => {
      window.removeEventListener(UNREAD_MESSAGES_CHANGED_EVENT, handleUnreadChange);
    };
  }, [activeRoom, propCount]);

  const count = propCount !== undefined ? propCount : internalCount;

  if (count <= 0) {
    return null;
  }

  const displayCount = formatUnreadCount(count);
  const sizeClasses =
    size === "md"
      ? "min-w-[20px] h-5 px-1.5 text-[11px]"
      : "min-w-[18px] h-[18px] px-1 text-[9px]";

  return (
    <span
      data-testid="chat-unread-badge"
      className={`pointer-events-none font-black rounded-full bg-red-600 text-white border-2 border-white dark:border-zinc-950 flex items-center justify-center shadow-md animate-pulse ${sizeClasses} ${className}`}
      aria-hidden="true"
    >
      {displayCount}
    </span>
  );
}

export default ChatUnreadBadge;
