"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Smooths a raw 0–1 audio level into a "peak hold + decay" value.
 *
 * - Rises instantly to a new, louder level (fast attack).
 * - Holds briefly at the peak, then decays back down smoothly over
 *   `decayMs` milliseconds when the raw level drops (slow release).
 *
 * This mimics how hardware VU meters behave, so the ring doesn't
 * flicker on every tiny dip in volume.
 */
export function usePeakDecayLevel(rawLevel: number, decayMs = 300): number {
  const [displayLevel, setDisplayLevel] = useState(rawLevel);
  const peakRef = useRef(rawLevel);
  const decayStartRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const clamped = Math.max(0, Math.min(1, rawLevel));

    if (clamped >= peakRef.current) {
      // Louder than before: jump up immediately, restart the decay clock.
      peakRef.current = clamped;
      decayStartRef.current = null;
      setDisplayLevel(clamped);
      return;
    }

    // Quieter than before: begin (or continue) a smooth decay toward it.
    if (decayStartRef.current === null) {
      decayStartRef.current = performance.now();
    }
    const startLevel = peakRef.current;
    const startTime = decayStartRef.current;

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / decayMs);
      const next = startLevel + (clamped - startLevel) * progress;
      setDisplayLevel(next);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        peakRef.current = clamped;
        decayStartRef.current = null;
      }
    };

    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [rawLevel, decayMs]);

  return displayLevel;
}
