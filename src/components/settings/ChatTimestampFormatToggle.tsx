"use client";

import React, { useEffect, useState } from "react";
import {
  CHAT_TIMESTAMP_FORMAT_CHANGE_EVENT,
  getChatTimestampFormat,
  setChatTimestampFormat,
  type ChatTimestampFormat,
} from "@/lib/chatTimestamps";

const FORMATS: Array<{ value: ChatTimestampFormat; label: string }> = [
  { value: "relative", label: "Relative" },
  { value: "exact", label: "Exact time" },
];

export function ChatTimestampFormatToggle() {
  const [format, setFormat] = useState<ChatTimestampFormat>(
    () => getChatTimestampFormat(),
  );

  useEffect(() => {
    setFormat(getChatTimestampFormat());
    const handleFormatChange = (event: Event) => {
      const changedFormat = (event as CustomEvent<ChatTimestampFormat>).detail;
      if (changedFormat === "relative" || changedFormat === "exact") {
        setFormat(changedFormat);
      }
    };

    window.addEventListener(CHAT_TIMESTAMP_FORMAT_CHANGE_EVENT, handleFormatChange);
    return () =>
      window.removeEventListener(CHAT_TIMESTAMP_FORMAT_CHANGE_EVENT, handleFormatChange);
  }, []);

  const selectFormat = (selectedFormat: ChatTimestampFormat) => {
    setFormat(selectedFormat);
    setChatTimestampFormat(selectedFormat);
  };

  return (
    <div className="flex items-center justify-between gap-4 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
      <div className="space-y-1">
        <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Chat timestamps
        </p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Choose how message times are displayed.
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
            aria-pressed={format === option.value}
            onClick={() => selectFormat(option.value)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${
              format === option.value
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default ChatTimestampFormatToggle;