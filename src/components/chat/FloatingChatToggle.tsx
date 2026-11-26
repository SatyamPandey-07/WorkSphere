'use client';

import React from 'react';
import { MessageSquare, X } from 'lucide-react';
import { formatUnreadCount } from '@/lib/chat/unreadTracker';
import type { ChatChannelMessage } from '@/hooks/useChatChannel';

export interface FloatingChatToggleProps {
  isOpen: boolean;
  onToggle: () => void;
  unreadCount?: number;
  roomId?: string;
  className?: string;
  ariaLabel?: string;
  messages?: ChatChannelMessage[];
}

export function FloatingChatToggle({
  isOpen,
  onToggle,
  unreadCount = 0,
  roomId: _roomId = 'default',
  className = '',
  ariaLabel,
  messages,
}: FloatingChatToggleProps) {
  const formattedCount = formatUnreadCount(unreadCount);
  const defaultLabel = isOpen
    ? 'Close chat drawer'
    : unreadCount > 0
    ? `Open chat drawer (${formattedCount} unread message${unreadCount === 1 ? '' : 's'})`
    : 'Open chat drawer';

  // System notes or notices within active channel messages
  const systemNotes = messages?.filter((m) => m.isSystem || m.senderName === 'System') ?? [];

  return (
    <div className="relative inline-flex flex-col items-center">
      {/* Inline system notice banner if open and system notice exists */}
      {isOpen && systemNotes.length > 0 && (
        <div
          data-testid="floating-chat-system-notice"
          className="mb-2 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 animate-fade-in"
          role="status"
          aria-live="polite"
        >
          {systemNotes[systemNotes.length - 1].content}
        </div>
      )}

      <button
        type="button"
        data-testid="floating-chat-toggle"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-label={ariaLabel || defaultLabel}
        className={`relative inline-flex items-center justify-center w-14 h-14 rounded-full bg-violet-600 hover:bg-violet-700 text-white shadow-xl transition-all duration-200 transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 ${className}`}
      >
        <div className="relative flex items-center justify-center">
          {isOpen ? (
            <X className="w-6 h-6 transition-transform duration-200 rotate-0" aria-hidden="true" />
          ) : (
            <MessageSquare className="w-6 h-6 transition-transform duration-200" aria-hidden="true" />
          )}
        </div>

        {/* Unread badge: only rendered and visible when collapsed (isOpen === false) and unreadCount > 0 */}
        {!isOpen && unreadCount > 0 && (
          <span
            data-testid="floating-chat-unread-badge"
            className="absolute -top-1 -right-1 flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-bold rounded-full bg-red-600 text-white border-2 border-white dark:border-zinc-950 shadow-md transition-all duration-300 ease-out transform scale-100 opacity-100 animate-pulse pointer-events-none"
            aria-hidden="true"
          >
            {formattedCount}
          </span>
        )}
      </button>
    </div>
  );
}

export default FloatingChatToggle;
