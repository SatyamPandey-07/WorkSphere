'use client';

import React, { useEffect, useState } from 'react';

export interface ReservationTimerBadgeProps {
  expiresAt: number;
  onExpire?: () => void;
  label?: string;
  className?: string;
}

export function getRemainingMs(expiresAt: number, now = Date.now()): number {
  if (!Number.isFinite(expiresAt)) return 0;
  return Math.max(0, expiresAt - now);
}

export function formatCountdownMmSs(remainingMs: number): string {
  const clamped = Math.max(0, remainingMs);
  const totalSeconds = Math.ceil(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export const ReservationTimerBadge: React.FC<ReservationTimerBadgeProps> = ({
  expiresAt,
  onExpire,
  label = 'Hold expires in',
  className = '',
}) => {
  const [remainingMs, setRemainingMs] = useState<number>(() =>
    getRemainingMs(expiresAt)
  );

  useEffect(() => {
    let expiredFired = false;

    const syncNow = () => {
      const nextRemaining = getRemainingMs(expiresAt, Date.now());
      setRemainingMs(nextRemaining);

      if (nextRemaining <= 0 && !expiredFired) {
        expiredFired = true;
        onExpire?.();
      }
      return nextRemaining;
    };

    const initial = syncNow();
    if (initial <= 0) {
      return;
    }

    const intervalId = window.setInterval(() => {
      const current = syncNow();
      if (current <= 0) {
        window.clearInterval(intervalId);
      }
    }, 250);

    const handleVisibilityOrFocus = () => {
      syncNow();
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, [expiresAt, onExpire]);

  const isExpired = remainingMs <= 0;
  const isUrgent = !isExpired && remainingMs <= 60_000;

  return (
    <span
      role="timer"
      aria-live="polite"
      data-testid="reservation-timer-badge"
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tabular-nums ${
        isExpired
          ? 'border-rose-200 bg-rose-50 text-rose-700'
          : isUrgent
            ? 'border-amber-200 bg-amber-50 text-amber-800'
            : 'border-indigo-200 bg-indigo-50 text-indigo-800'
      } ${className}`.trim()}
    >
      <span>{isExpired ? 'Hold expired' : `${label}:`}</span>
      <span data-testid="reservation-timer-value">
        {formatCountdownMmSs(remainingMs)}
      </span>
    </span>
  );
};