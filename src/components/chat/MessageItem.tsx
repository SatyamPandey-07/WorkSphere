'use client';

import React from 'react';
import { parseSanitizedChatSegments } from '@/lib/chat/sanitize';

export interface MessageItemProps {
  id?: string;
  senderName: string;
  content: string;
  timestamp?: string;
  trustedImageHosts?: string[];
  className?: string;
}

export const MessageItem: React.FC<MessageItemProps> = ({
  id,
  senderName,
  content,
  timestamp,
  trustedImageHosts,
  className = '',
}) => {
  const segments = parseSanitizedChatSegments(content, trustedImageHosts);

  return (
    <article
      id={id}
      data-testid="chat-message-item"
      className={`rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 ${className}`.trim()}
    >
      <div className="mb-1 flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="font-semibold text-slate-700 dark:text-slate-200">
          {senderName}
        </span>
        {timestamp && <span>{timestamp}</span>}
      </div>

      <div data-testid="chat-message-body" className="break-words leading-relaxed">
        {segments.map((seg, idx) => {
          if (seg.type === 'image') {
            return (
              <img
                key={idx}
                src={seg.src}
                alt={seg.alt}
                referrerPolicy="no-referrer"
                loading="lazy"
                data-testid="chat-trusted-image"
                className="my-1.5 max-h-60 rounded-lg border border-slate-200 object-cover dark:border-slate-700"
              />
            );
          }

          if (seg.type === 'link') {
            return (
              <a
                key={idx}
                href={seg.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                data-testid="chat-sanitized-link"
                className="font-medium text-indigo-600 underline hover:text-indigo-700 dark:text-indigo-400"
              >
                {seg.label}
              </a>
            );
          }

          return <React.Fragment key={idx}>{seg.value}</React.Fragment>;
        })}
      </div>
    </article>
  );
};

export default MessageItem;
