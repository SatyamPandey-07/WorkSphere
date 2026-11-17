'use client';

import React, { useState, useEffect, useMemo } from 'react';

export type AgentHeartbeatHealth = 'active' | 'delayed' | 'stale';

export interface HeartbeatThresholds {
    delayedAfterMs: number;
    staleAfterMs: number;
}

export const DEFAULT_HEARTBEAT_THRESHOLDS: HeartbeatThresholds = {
    delayedAfterMs: 15_000, // > 15s => amber
    staleAfterMs: 30_000,   // > 30s => red
};

export interface HeartbeatStatusEvaluation {
    health: AgentHeartbeatHealth;
    label: string;
    elapsedMs: number;
    formattedTimestamp: string;
    isoTimestamp: string;
}

/**
 * Evaluates agent heartbeat connectivity health against 15s / 30s thresholds.
 */
export function evaluateAgentHeartbeat(
    lastHeartbeatAt: Date | string | number | null | undefined,
    nowMs: number = Date.now(),
    thresholds: HeartbeatThresholds = DEFAULT_HEARTBEAT_THRESHOLDS
): HeartbeatStatusEvaluation {
    if (lastHeartbeatAt === null || lastHeartbeatAt === undefined) {
        return {
            health: 'stale',
            label: 'Stale (No heartbeat received)',
            elapsedMs: Number.POSITIVE_INFINITY,
            formattedTimestamp: 'Never received',
            isoTimestamp: 'N/A',
        };
    }

    const parsedDate =
        lastHeartbeatAt instanceof Date
            ? lastHeartbeatAt
            : new Date(lastHeartbeatAt);

    if (Number.isNaN(parsedDate.getTime())) {
        return {
            health: 'stale',
            label: 'Stale (Invalid timestamp)',
            elapsedMs: Number.POSITIVE_INFINITY,
            formattedTimestamp: 'Invalid timestamp',
            isoTimestamp: 'N/A',
        };
    }

    const elapsedMs = Math.max(0, nowMs - parsedDate.getTime());
    const isoTimestamp = parsedDate.toISOString();
    const formattedTimestamp = new Intl.DateTimeFormat('en-GB', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
        hour12: false,
        timeZoneName: 'short',
    }).format(parsedDate);

    if (elapsedMs > thresholds.staleAfterMs) {
        return {
            health: 'stale',
            label: 'Stale',
            elapsedMs,
            formattedTimestamp,
            isoTimestamp,
        };
    }

    if (elapsedMs > thresholds.delayedAfterMs) {
        return {
            health: 'delayed',
            label: 'Delayed',
            elapsedMs,
            formattedTimestamp,
            isoTimestamp,
        };
    }

    return {
        health: 'active',
        label: 'Active',
        elapsedMs,
        formattedTimestamp,
        isoTimestamp,
    };
}

function formatElapsedBadge(elapsedMs: number): string {
    if (!Number.isFinite(elapsedMs)) return 'never';
    const seconds = Math.floor(elapsedMs / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m ago`;
}

export interface AgentHeartbeatIndicatorProps {
    agentName: string;
    lastHeartbeatAt: Date | string | number | null | undefined;
    thresholds?: HeartbeatThresholds;
    tickIntervalMs?: number;
    className?: string;
}

const HEALTH_STYLES: Record<
    AgentHeartbeatHealth,
    {
        coreDot: string;
        pingRing: string;
        badgeText: string;
        animatePing: boolean;
    }
> = {
    active: {
        coreDot: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.75)]',
        pingRing: 'bg-emerald-400',
        badgeText: 'text-emerald-400',
        animatePing: true,
    },
    delayed: {
        coreDot: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.75)]',
        pingRing: 'bg-amber-400',
        badgeText: 'text-amber-400',
        animatePing: true,
    },
    stale: {
        coreDot: 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.75)]',
        pingRing: 'bg-rose-500',
        badgeText: 'text-rose-400',
        animatePing: false,
    },
};

export function AgentHeartbeatIndicator({
    agentName,
    lastHeartbeatAt,
    thresholds = DEFAULT_HEARTBEAT_THRESHOLDS,
    tickIntervalMs = 1000,
    className = '',
}: AgentHeartbeatIndicatorProps) {
    const [nowMs, setNowMs] = useState<number>(() => Date.now());
    const [tooltipVisible, setTooltipVisible] = useState(false);

    // Re-evaluate elapsed heartbeat age every second so transitions (15s -> 30s) happen live
    useEffect(() => {
        const timer = setInterval(() => {
            setNowMs(Date.now());
        }, tickIntervalMs);
        return () => clearInterval(timer);
    }, [tickIntervalMs]);

    const evaluation = useMemo(
        () => evaluateAgentHeartbeat(lastHeartbeatAt, nowMs, thresholds),
        [lastHeartbeatAt, nowMs, thresholds]
    );

    const style = HEALTH_STYLES[evaluation.health];
    const tooltipId = `heartbeat-tooltip-${agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    return (
        <span
            className={`relative inline-flex items-center ${className}`}
            onMouseEnter={() => setTooltipVisible(true)}
            onMouseLeave={() => setTooltipVisible(false)}
            onFocus={() => setTooltipVisible(true)}
            onBlur={() => setTooltipVisible(false)}
        >
            <button
                type="button"
                tabIndex={0}
                aria-describedby={tooltipId}
                aria-label={`${agentName} heartbeat status: ${evaluation.label}. Last packet: ${evaluation.formattedTimestamp}`}
                data-testid={`heartbeat-dot-${evaluation.health}`}
                className="group relative inline-flex h-4 w-4 items-center justify-center rounded-full focus:outline-none focus:ring-2 focus: