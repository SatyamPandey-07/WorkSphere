"use client";

import React, { useState } from "react";
import { Clock, Zap, PlusCircle, XCircle, AlertTriangle, Radio } from "lucide-react";
import { useDeskReservationCountdown } from "@/hooks/useDeskReservationCountdown";

export interface DeskReservationCountdownTimerProps {
  venueId: string;
  deskId: string;
  deskName?: string;
  initialExpiresAt?: number;
  totalDurationSeconds?: number;
  onExpire?: (deskId: string) => void;
  onRelease?: () => void;
  onExtended?: (newExpiresAt: number) => void;
  className?: string;
}

export function DeskReservationCountdownTimer({
  venueId,
  deskId,
  deskName,
  initialExpiresAt,
  totalDurationSeconds = 300,
  onExpire,
  onRelease,
  onExtended,
  className = "",
}: DeskReservationCountdownTimerProps) {
  const [extending, setExtending] = useState(false);
  const [releasing, setReleasing] = useState(false);

  const {
    remainingSeconds,
    formattedTime,
    progressPercentage,
    isExpiringSoon,
    isExpired,
    isActive,
    isLiveSyncActive,
    extendCountdown,
    releaseCountdown,
  } = useDeskReservationCountdown({
    venueId,
    deskId,
    initialExpiresAt,
    totalDurationSeconds,
    onExpire,
    onExtended,
  });

  const handleExtend = async () => {
    setExtending(true);
    try {
      await extendCountdown(120); // +2 minutes
    } finally {
      setExtending(false);
    }
  };

  const handleRelease = async () => {
    setReleasing(true);
    try {
      const ok = await releaseCountdown();
      if (ok) {
        onRelease?.();
      }
    } finally {
      setReleasing(false);
    }
  };

  if (!isActive && !isExpired) {
    return null;
  }

  if (isExpired) {
    return (
      <div
        data-testid="desk-countdown-timer"
        role="alert"
        className={`rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-200 ${className}`}
      >
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 font-medium">
            <XCircle className="h-4 w-4 text-rose-400" />
            <span>
              Desk reservation hold for <strong>{deskName || deskId}</strong> has expired.
            </span>
          </span>
          <span className="rounded-md border border-rose-500/40 bg-rose-500/20 px-2 py-0.5 font-mono text-[10px] text-rose-300">
            EXPIRED
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="desk-countdown-timer"
      role="timer"
      aria-live="polite"
      aria-atomic="true"
      aria-label={`Desk reservation countdown timer: ${formattedTime} remaining`}
      className={`rounded-2xl border transition-all ${
        isExpiringSoon
          ? "border-amber-500/50 bg-amber-500/15 shadow-[0_0_15px_rgba(245,158,11,0.2)]"
          : "border-amber-500/30 bg-amber-500/10"
      } p-3.5 text-xs text-amber-200 ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Left: Indicator & Desk Label */}
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                isExpiringSoon ? "bg-amber-300" : "bg-emerald-400"
              }`}
            />
            <span
              className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                isExpiringSoon ? "bg-amber-400" : "bg-emerald-500"
              }`}
            />
          </span>

          <span className="font-medium text-amber-100">
            Desk{" "}
            <strong className="text-white">
              {deskName || deskId}
            </strong>{" "}
            locked for checkout
          </span>

          {isLiveSyncActive && (
            <span
              data-testid="desk-countdown-keyspace-badge"
              title="Live Redis Keyspace Expiration Sync Active"
              className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold text-emerald-300 tracking-wider uppercase"
            >
              <Radio className="h-2.5 w-2.5 animate-pulse text-emerald-400" />
              Keyspace Sync
            </span>
          )}
        </div>

        {/* Right: Countdown Display & Action Controls */}
        <div className="flex items-center gap-3">
          <div
            data-testid="desk-countdown-display"
            className="flex items-center gap-1.5 font-mono text-sm font-bold text-amber-300"
          >
            {isExpiringSoon ? (
              <AlertTriangle className="h-4 w-4 animate-bounce text-amber-400" />
            ) : (
              <Clock className="h-3.5 w-3.5 text-amber-400" />
            )}
            <span>{formattedTime}</span>
            <span className="text-[10px] font-normal text-amber-400/80">
              ({remainingSeconds}s)
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-testid="desk-countdown-extend"
              onClick={handleExtend}
              disabled={extending}
              title="Extend desk hold by 2 minutes"
              className="flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/20 px-2.5 py-1 text-[11px] font-semibold text-amber-100 hover:bg-amber-500/30 active:scale-95 transition-all disabled:opacity-50"
            >
              <PlusCircle className="h-3 w-3" />
              {extending ? "Extending..." : "+2m"}
            </button>

            <button
              type="button"
              data-testid="desk-countdown-release"
              onClick={handleRelease}
              disabled={releasing}
              title="Release desk hold lock"
              className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-medium text-zinc-300 hover:bg-white/10 active:scale-95 transition-all disabled:opacity-50"
            >
              <XCircle className="h-3 w-3" />
              Release
            </button>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-black/40">
        <div
          data-testid="desk-countdown-progress"
          className={`h-full transition-all duration-1000 ease-linear rounded-full ${
            isExpiringSoon
              ? "bg-gradient-to-r from-amber-500 to-rose-500 animate-pulse"
              : "bg-gradient-to-r from-emerald-500 to-amber-500"
          }`}
          style={{ width: `${progressPercentage}%` }}
        />
      </div>
    </div>
  );
}
