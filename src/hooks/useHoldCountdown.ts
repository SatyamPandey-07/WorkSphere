'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export type HoldTimerUrgency = 'normal' | 'warning' | 'critical' | 'expired';

export interface UseHoldCountdownOptions {
    /** Absolute server expiration timestamp (ISO string, Date, or epoch ms) */
    expiresAt: string | Date | number | null | undefined;
    /** Total hold duration in milliseconds for ring progress calculation (default: 15 minutes) */
    totalDurationMs?: number;
    /** UI refresh interval in milliseconds while tab is visible (default: 250ms for crisp second boundaries) */
    tickIntervalMs?: number;
    /** Callback invoked once when remaining time reaches 0 */
    onExpire?: () => void;
}

export interface HoldCountdownState {
    remainingMs: number;
    remainingSeconds: number;
    formattedTime: string;
    progressFraction: number;
    urgency: HoldTimerUrgency;
    isExpired: boolean;
    syncNow: () => void;
}

const DEFAULT_HOLD_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Parses an ISO-8601 string, Date instance, or epoch millisecond timestamp into epoch ms.
 */
export function parseExpirationTimestampMs(
    expiresAt: string | Date | number | null | undefined
): number | null {
    if (expiresAt === null || expiresAt === undefined) {
        return null;
    }

    if (typeof expiresAt === 'number') {
        return Number.isFinite(expiresAt) ? expiresAt : null;
    }

    const parsed = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Computes exact remaining time from wall-clock `Date.now()` against `targetMs`.
 */
export function computeRemainingFromWallClock(
    targetMs: number | null,
    nowMs: number = Date.now(),
    totalDurationMs: number = DEFAULT_HOLD_DURATION_MS
): Omit<HoldCountdownState, 'syncNow'> {
    if (targetMs === null) {
        return {
            remainingMs: 0,
            remainingSeconds: 0,
            formattedTime: '00:00',
            progressFraction: 0,
            urgency: 'expired',
            isExpired: true,
        };
    }

    const remainingMs = Math.max(0, targetMs - nowMs);
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    const isExpired = remainingMs <= 0;

    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    const safeTotal = totalDurationMs > 0 ? totalDurationMs : DEFAULT_HOLD_DURATION_MS;
    const progressFraction = Math.min(1, Math.max(0, remainingMs / safeTotal));

    let urgency: HoldTimerUrgency = 'normal';
    if (isExpired) {
        urgency = 'expired';
    } else if (remainingSeconds <= 120) {
        // <= 2 minutes remaining
        urgency = 'critical';
    } else if (remainingSeconds <= 300) {
        // <= 5 minutes remaining
        urgency = 'warning';
    }

    return {
        remainingMs,
        remainingSeconds,
        formattedTime,
        progressFraction,
        urgency,
        isExpired,
    };
}

/**
 * Wall-clock anchored countdown hook immune to browser background tab timer throttling.
 * Recomputes `expiresAt - Date.now()` on every tick and immediately resynchronizes
 * when `document.visibilitychange` transitions back to `'visible'` or on `window.focus`.
 */
export function useHoldCountdown({
    expiresAt,
    totalDurationMs = DEFAULT_HOLD_DURATION_MS,
    tickIntervalMs = 250,
    onExpire,
}: UseHoldCountdownOptions): HoldCountdownState {
    const targetMs = parseExpirationTimestampMs(expiresAt);

    const [nowMs, setNowMs] = useState<number>(() => Date.now());
    const onExpireRef = useRef(onExpire);
    onExpireRef.current = onExpire;

    const hasFiredExpireForTargetRef = useRef<number | null>(null);

    const syncNow = useCallback(() => {
        setNowMs(Date.now());
    }, []);

    // Reset expiration callback guard whenever `targetMs` changes (e.g. hold renewed)
    useEffect(() => {
        hasFiredExpireForTargetRef.current = null;
        syncNow();
    }, [targetMs, syncNow]);

    // Wall-clock interval + visibilitychange / focus immediate resynchronization
    useEffect(() => {
        if (targetMs === null) {
            return;
        }

        const handleVisibilityOrFocus = () => {
            if (typeof document === 'undefined' || document.visibilityState === 'visible') {
                syncNow();
            }
        };

        const intervalId = setInterval(() => {
            syncNow();
        }, tickIntervalMs);

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', handleVisibilityOrFocus);
        }
        if (typeof window !== 'undefined') {
            window.addEventListener('focus', handleVisibilityOrFocus);
        }

        return () => {
            clearInterval(intervalId);
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
            }
            if (typeof window !== 'undefined') {
                window.removeEventListener('focus', handleVisibilityOrFocus);
            }
        };
    }, [targetMs, tickIntervalMs, syncNow]);

    const snapshot = computeRemainingFromWallClock(targetMs, nowMs, totalDurationMs);

    // Fire onExpire exactly once per `targetMs` when wall-clock time reaches expiration
    useEffect(() => {
        if (
            targetMs !== null &&
            snapshot.isExpired &&
            hasFiredExpireForTargetRef.current !== targetMs
        ) {
            hasFiredExpireForTargetRef.current = targetMs;
            onExpireRef.current?.();
        }
    }, [targetMs, snapshot.isExpired]);

    return {
        ...snapshot,
        syncNow,
    };
}