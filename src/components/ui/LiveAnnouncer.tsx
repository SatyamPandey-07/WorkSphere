"use client";

import React, { useEffect, useRef, useState } from "react";

export interface LiveAnnouncerProps {
  /** Text to announce. An empty string announces nothing. */
  message: string;
  /**
   * Changes whenever there is something new to announce. Changing the key
   * re-announces `message` even if its text is identical to the last one
   * (e.g. two searches that both return 12 results).
   */
  announceKey?: unknown;
  /**
   * Quiet period before announcing. Rapid successive updates restart the
   * timer, so only the last one is read out.
   */
  delayMs?: number;
  testId?: string;
}

/**
 * Visually hidden `aria-live="polite"` region for screen reader announcements.
 *
 * The region is always mounted (live regions that are inserted together with
 * their text are often not announced). Nothing is announced on the initial
 * render, only on later changes.
 */
export function LiveAnnouncer({
  message,
  announceKey,
  delayMs = 500,
  testId = "live-announcer",
}: LiveAnnouncerProps) {
  const [text, setText] = useState("");
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // Clear first so the same text is treated as a new announcement.
    setText("");
    if (!message) return;

    const timer = setTimeout(() => setText(message), delayMs);
    return () => clearTimeout(timer);
  }, [message, announceKey, delayMs]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      data-testid={testId}
    >
      {text}
    </div>
  );
}

export default LiveAnnouncer;
