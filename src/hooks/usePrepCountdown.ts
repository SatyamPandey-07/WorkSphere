"use client";

import { useEffect, useState } from "react";
import { minutesRemaining } from "@/lib/cafe/prepTime";

const TICK_MS = 60_000;

/**
 * Minutes left until an order is ready, updated once a minute.
 *
 * The value is recomputed from the clock on every tick instead of counting
 * down, so a throttled or sleeping tab catches up to the correct value as soon
 * as it wakes. Returns null when disabled or when there is no ready time.
 */
export function usePrepCountdown(
  readyAtMs: number | null | undefined,
  enabled = true,
): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled || readyAtMs == null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [readyAtMs, enabled]);

  if (!enabled || readyAtMs == null) return null;
  return minutesRemaining(readyAtMs, now);
}
