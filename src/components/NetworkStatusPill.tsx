"use client";

import React, { useState, useEffect, useRef } from "react";
import { WifiOff, Check } from "lucide-react";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { useToast } from "@/components/ui/Toast";

export interface NetworkStatusPillProps {
  className?: string;
  onlineFlashDurationMs?: number;
  showLive?: boolean;
  pendingCount?: number;
}

export function NetworkStatusPill({
  className = "",
  onlineFlashDurationMs = 2500,
  showLive = true,
  pendingCount: propPendingCount,
}: NetworkStatusPillProps) {
  const { isOffline, pendingCount: hookPendingCount } = useOfflineSync();
  const { toast } = useToast();
  const effectivePendingCount = propPendingCount ?? hookPendingCount ?? 0;

  const [showOnlineFlash, setShowOnlineFlash] = useState(false);
  const wasOfflineRef = useRef<boolean | null>(null);

  // Hook into lifecycle listeners for online / offline events and show non-intrusive toasts
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOnline = () => {
      toast("Back online. Live data restored.", "success");
    };

    const handleOffline = () => {
      toast("You are offline. Running in local mode.", "warning");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [toast]);

  // Track state transitions for the brief "Back online" flash badge
  useEffect(() => {
    if (wasOfflineRef.current === null) {
      wasOfflineRef.current = isOffline;
      return;
    }

    if (isOffline) {
      wasOfflineRef.current = true;
      setShowOnlineFlash(false);
    } else if (wasOfflineRef.current) {
      wasOfflineRef.current = false;
      setShowOnlineFlash(true);
      const timer = setTimeout(() => {
        setShowOnlineFlash(false);
      }, onlineFlashDurationMs);
      return () => clearTimeout(timer);
    }
  }, [isOffline, onlineFlashDurationMs]);

  // 1. Offline Mode: Amber dot with "Offline · Local Mode" and count of pending mutations
  if (isOffline) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800 shadow-sm animate-in fade-in duration-300 ${className}`}
      >
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
        </span>
        <WifiOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
        <span className="truncate max-w-[160px] sm:max-w-none">
          Offline · Local Mode{effectivePendingCount > 0 ? ` (${effectivePendingCount})` : ""}
        </span>
      </div>
    );
  }

  // 2. Transitional flash: "Back online"
  if (showOnlineFlash) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800 shadow-sm animate-in fade-in duration-300 transition-opacity ${className}`}
      >
        <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <span>Back online</span>
      </div>
    );
  }

  // 3. Online Mode: If showLive is false, render nothing
  if (!showLive) {
    return null;
  }

  // 4. Online Mode: Green indicator dot with "Live"
  return (
    <div
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800 shadow-sm animate-in fade-in duration-300 ${className}`}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
      </span>
      <span>Live</span>
    </div>
  );
}
