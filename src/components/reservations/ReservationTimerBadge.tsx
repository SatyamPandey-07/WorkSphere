'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface ReservationTimerBadgeProps {
  expiresAt: number | string | Date;
  onExpire?: () => void;
  urgentThresholdMs?: number;
  className?: string;
}

export const DEFAULT_SEAT_HOLD_DURATION_MS = 5 * 60 * 1000;
export const DEFAULT_URGENT_THRESHOLD_MS = 60 * 1000;

export function parseExpiresAtMs(expiresAt: number | string | Date): number {
  if (typeof expiresAt === 'number') {
    return Number.isFinite(expiresAt) ? expiresAt : 0;
  }
  if (expiresAt instanceof Date) {
    const ms = expiresAt.getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }
  const parsed = Date.parse(expiresAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function computeRemainingMs(
  expiresAt: number | string | Date,
  nowMs: number = Date.now()
): number {
  const targetMs = parseExpiresAtMs(expiresAt);
  return Math.max(0, targetMs - nowMs);
}

export function formatCountdownMmSs(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export const ReservationTimerBadge: React.FC<ReservationTimerBadgeProps> = ({
  expiresAt,
  onExpire,
  urgentThresholdMs = DEFAULT_URGENT_THRESHOLD_MS,
  className = '',
}) => {
  const [remainingMs, setRemainingMs] = useState<number>(() =>
    computeRemainingMs(expiresAt, Date.now())
  );
  const expiredNotifiedRef = useRef(false);

  const syncRemaining = useCallback(() => {
    const nextRemaining = computeRemainingMs(expiresAt, Date.now());
    setRemainingMs(nextRemaining);

    if (nextRemaining <= 0 && !expiredNotifiedRef.current) {
      expiredNotifiedRef.current = true;
      onExpire?.();
    }
    return nextRemaining;
  }, [expiresAt, onExpire]);

  useEffect(() => {
    expiredNotifiedRef.current = false;
    const initial = syncRemaining();
    if (initial <= 0) return;

    const intervalId = window.setInterval(() => {
      const next = syncRemaining();
      if (next <= 0) {
        window.clearInterval(intervalId);
      }
    }, 500);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncRemaining();
      }
    };

    const handleWindowFocus = () => {
      syncRemaining();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [expiresAt, syncRemaining]);

  const isExpired = remainingMs <= 0;
  const isUrgent = !isExpired && remainingMs <= urgentThresholdMs;
  const formatted = formatCountdownMmSs(remainingMs);

  return (
    <span
      role="timer"
      aria-live="off"
      data-testid="reservation-timer-badge"
      data-expired={isExpired ? 'true' : 'false'}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold tabular-nums ${
        isExpired
          ? 'border-rose-500/40 bg-rose-950/60 text-rose-300'
          : isUrgent
            ? 'border-amber-500/40 bg-amber-950/60 text-amber-300'
            : 'border-emerald-500/30 bg-emerald-950/50 text-emerald-300'
      } ${className}`.trim()}
    >
      <span aria-hidden="true">{isExpired ? '⏱️' : '⏳'}</span>
      <span data-testid="reservation-timer-value">
        {isExpired ? '00:00 · Expired' : `${formatted} hold`}
      </span>
    </span>
  );
};