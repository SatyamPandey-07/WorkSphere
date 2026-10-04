"use client";

import React from "react";
import { useIdleSession } from "@/hooks/useIdleSession";
import { Clock, ShieldAlert, LogOut, CheckCircle2, Loader2 } from "lucide-react";

export interface IdleSessionDialogProps {
  /** Optional custom idle timeout in ms */
  idleTimeoutMs?: number;
  /** Optional custom warning duration in ms */
  warningDurationMs?: number;
  /** Custom redirect URL after expiration */
  redirectUrl?: string;
  /** Disable idle checking if needed */
  enabled?: boolean;
}

/**
 * IdleSessionDialog
 *
 * Renders an accessible warning dialog when the user has been inactive for 30 minutes.
 * Allows the user to seamlessly extend their session with silent token rotation or sign out cleanly.
 */
export function IdleSessionDialog({
  idleTimeoutMs,
  warningDurationMs,
  redirectUrl = "/sign-in",
  enabled = true,
}: IdleSessionDialogProps) {
  const {
    showWarning,
    remainingSeconds,
    extendSession,
    signOut,
    isRefreshing,
  } = useIdleSession({
    idleTimeoutMs,
    warningDurationMs,
    redirectUrl,
    enabled,
  });

  if (!showWarning) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="idle-session-title"
      aria-describedby="idle-session-desc"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="w-full max-w-md bg-zinc-950/95 border border-zinc-800 text-zinc-100 rounded-2xl shadow-2xl p-6 sm:p-7 relative overflow-hidden">
        {/* Top accent bar */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 via-orange-500 to-red-500" />

        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0">
            <ShieldAlert className="w-6 h-6" />
          </div>

          <div className="space-y-1.5 flex-1">
            <h3
              id="idle-session-title"
              className="text-lg font-semibold text-white tracking-tight flex items-center gap-2"
            >
              Session Timeout Warning
            </h3>
            <p id="idle-session-desc" className="text-sm text-zinc-400 leading-relaxed">
              You have been inactive for{" "}
              {idleTimeoutMs
                ? `${Math.max(1, Math.round(idleTimeoutMs / 60000))} minutes`
                : "30 minutes"}
              . For your security, your session will automatically expire soon.
            </p>
          </div>
        </div>

        {/* Countdown timer pill */}
        <div className="my-5 p-3.5 rounded-xl bg-zinc-900/90 border border-zinc-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <Clock className="w-4 h-4 text-amber-400 animate-pulse" />
            <span>Time remaining:</span>
          </div>
          <span className="text-sm font-mono font-bold text-amber-400 bg-amber-500/10 px-2.5 py-0.5 rounded-lg border border-amber-500/20">
            {remainingSeconds}s
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
          <button
            type="button"
            onClick={extendSession}
            disabled={isRefreshing}
            className="w-full sm:flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-medium text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 transition-all disabled:opacity-50"
          >
            {isRefreshing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Extending...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Stay Logged In</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={signOut}
            disabled={isRefreshing}
            className="w-full sm:w-auto py-2.5 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white font-medium text-sm flex items-center justify-center gap-2 transition-all"
          >
            <LogOut className="w-4 h-4 text-zinc-400" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
