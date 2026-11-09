"use client";

import React, { useEffect, useState } from "react";
import {
  CHAT_TIMESTAMP_FORMAT_CHANGE_EVENT,
  getChatTimestampFormat,
  setChatTimestampFormat,
  type ChatTimestampFormat,
} from "@/lib/chatTimestamps";
import { cn } from "@/lib/utils";

const FORMATS: Array<{ value: ChatTimestampFormat; label: string }> = [
  { value: "relative", label: "Relative" },
  { value: "exact", label: "Exact time" },
];

export interface ChatTimestampFormatToggleProps {
  className?: string;
  onFormatChange?: (format: ChatTimestampFormat) => void;
}

export function ChatTimestampFormatToggle({
  className,
  onFormatChange,
}: ChatTimestampFormatToggleProps = {}) {
  const [format, setFormat] = useState<ChatTimestampFormat>("relative");
  const [currentTime, setCurrentTime] = useState<Date>(() => new Date());

  useEffect(() => {
    const initialFormat = getChatTimestampFormat() || "relative";
    setFormat(initialFormat);

    const handleFormatChange = (event: Event) => {
      const changedFormat = (event as CustomEvent<ChatTimestampFormat>).detail;
      if (changedFormat === "relative" || changedFormat === "exact") {
        setFormat(changedFormat);
        onFormatChange?.(changedFormat);
      }
    };

    window.addEventListener(CHAT_TIMESTAMP_FORMAT_CHANGE_EVENT, handleFormatChange);
    return () =>
      window.removeEventListener(CHAT_TIMESTAMP_FORMAT_CHANGE_EVENT, handleFormatChange);
  }, [onFormatChange]);

  const selectFormat = (selectedFormat: ChatTimestampFormat) => {
    setFormat(selectedFormat);
    setChatTimestampFormat(selectedFormat);
    onFormatChange?.(selectedFormat);
  };

  useEffect(() => {
    setCurrentTime(new Date());
  }, [format]);

  // Format 12-hour (e.g. "2:30 PM") vs 24-hour (e.g. "14:30")
  const previewTimeStr =
    format === "relative"
      ? currentTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })
      : currentTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <div
      data-testid="chat-timestamp-format-toggle"
      className={cn(
        "flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm",
        className,
      )}
    >
      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Chat timestamps
          </p>
          <span
            data-testid="timestamp-preview-chip"
            aria-label={`Preview timestamp format: ${previewTimeStr}`}
            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
          >
            <span className="opacity-75">Preview:</span>
            <span className="font-semibold font-mono">{previewTimeStr}</span>
          </span>
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Choose how message times are displayed (12-hour vs 24-hour exact time).
        </p>
      </div>
      <div
        role="group"
        aria-label="Chat timestamp format"
        className="inline-flex shrink-0 rounded-lg border border-zinc-200 dark:border-zinc-700 p-1"
      >
        {FORMATS.map((option) => (
          <button
            key={option.value}
            type="button"
            data-testid={`timestamp-format-${option.value}`}
            aria-pressed={format === option.value}
            onClick={() => selectFormat(option.value)}
            className={cn(
              "px-3 py-1.5 text-sm rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500",
              format === option.value
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-medium"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default ChatTimestampFormatToggle;
