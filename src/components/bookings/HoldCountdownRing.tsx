'use client';

import React from 'react';
import { Clock, AlertCircle } from 'lucide-react';
import {
    useHoldCountdown,
    HoldTimerUrgency,
} from '@/hooks/useHoldCountdown';

export interface HoldCountdownRingProps {
    expiresAt: string | Date | number;
    totalDurationMs?: number;
    onExpire?: () => void;
    label?: string;
}

const URGENCY_THEME: Record<
    HoldTimerUrgency,
    {
        stroke: string;
        text: string;
        badgeBg: string;
        badgeBorder: string;
        statusText: string;
    }
> = {
    normal: {
        stroke: 'stroke-sky-400',
        text: 'text-sky-300',
        badgeBg: 'bg-sky-950/50',
        badgeBorder: 'border-sky-500/30',
        statusText: 'Seat Hold Active',
    },
    warning: {
        stroke: 'stroke-amber-400',
        text: 'text-amber-300',
        badgeBg: 'bg-amber-950/50',
        badgeBorder: 'border-amber-500/30',
        statusText: 'Expiring Soon',
    },
    critical: {
        stroke: 'stroke-rose-500',
        text: 'text-rose-300',
        badgeBg: 'bg-rose-950/50',
        badgeBorder: 'border-rose-500/40',
        statusText: 'Final Warning',
    },
    expired: {
        stroke: 'stroke-zinc-600',
        text: 'text-zinc-400',
        badgeBg: 'bg-zinc-900',
        badgeBorder: 'border-zinc-700',
        statusText: 'Hold Expired',
    },
};

export function HoldCountdownRing({
    expiresAt,
    totalDurationMs = 15 * 60 * 1000,
    onExpire,
    label,
}: HoldCountdownRingProps) {
    const { formattedTime, progressFraction, urgency, isExpired } = useHoldCountdown({
        expiresAt,
        totalDurationMs,
        onExpire,
    });

    const theme = URGENCY_THEME[urgency];
    const radius = 18;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference * (1 - progressFraction);

    return (
        <div
            role="timer"
            aria-live="off"
            aria-label={`${label ?? theme.statusText}: ${formattedTime} remaining`}
            data-testid="hold-countdown-timer"
            data-urgency={urgency}
            className={`inline-flex items-center gap-3 rounded-xl border px-3.5 py-2 transition-colors duration-300 ${theme.badgeBg} ${theme.badgeBorder}`}
        >
            <div className="relative flex h-11 w-11 items-center justify-center">
                <svg className="h-11 w-11 -rotate-90 transform" viewBox="0 0 44 44">
                    <circle
                        cx="22"
                        cy="22"
                        r={radius}
                        fill="transparent"
                        strokeWidth="3.5"
                        className="stroke-zinc-800"
                    />
                    <circle
                        cx="22"
                        cy="22"
                        r={radius}
                        fill="transparent"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        strokeDasharray={circumference}
                        strokeDashoffset={strokeDashoffset}
                        className={`transition-all duration-200 ${theme.stroke}`}
                    />
                </svg>
                <span className="absolute flex items-center justify-center">
                    {isExpired ? (
                        <AlertCircle className="h-4 w-4 text-rose-400" />
                    ) : (
                        <Clock className={`h-4 w-4 ${theme.text}`} />
                    )}
                </span>
            </div>

            <div className="flex flex-col">
                <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                    {label ?? theme.statusText}
                </span>
                <span
                    data-testid="hold-countdown-display"
                    className={`font-mono text-base font-semibold tabular-nums ${theme.text}`}
                >
                    {formattedTime}
                </span>
            </div>
        </div>
    );
}