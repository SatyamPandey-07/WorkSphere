"use client";

import React, { useState, useEffect, useCallback } from "react";
import { WifiOff, RefreshCw, X, CheckCircle2, AlertCircle } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

export interface UseOfflineStatusOptions {
  checkUrl?: string;
  onStatusChange?: (isOffline: boolean) => void;
}

/**
 * Custom hook to manage browser online/offline status and manual connection retries.
 */
export function useOfflineStatus(options?: UseOfflineStatusOptions) {
  const [isOffline, setIsOffline] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [lastCheckTime, setLastCheckTime] = useState<number | null>(null);
  const { toast } = useToast();

  const updateStatus = useCallback(
    (offline: boolean) => {
      setIsOffline(offline);
      options?.onStatusChange?.(offline);
    },
    [options]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Set initial status after mount
    setIsOffline(!navigator.onLine);

    const handleOnline = () => {
      updateStatus(false);
      toast("Back online! Reconnected to WorkSphere services.", "success");
    };

    const handleOffline = () => {
      updateStatus(true);
      toast("You are offline. Working in offline cached mode.", "warning");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [updateStatus, toast]);

  const retryConnection = useCallback(async (): Promise<boolean> => {
    setIsRetrying(true);
    setLastCheckTime(Date.now());

    try {
      // First check browser navigator status
      if (!navigator.onLine) {
        setIsRetrying(false);
        toast("Still offline. Please check your network hardware.", "error");
        return false;
      }

      // Verify connection with health check ping
      const checkUrl = options?.checkUrl || "/api/health";
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(checkUrl, {
        method: "HEAD",
        cache: "no-store",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.ok || res.status === 404 || res.status === 405) {
        updateStatus(false);
        toast("Connection restored! All services synced.", "success");
        return true;
      } else {
        updateStatus(true);
        toast("Server ping failed. Network connection unstable.", "warning");
        return false;
      }
    } catch {
      // Failed ping or timeout
      if (navigator.onLine) {
        // Fallback: navigator says online even if ping failed
        updateStatus(false);
        toast("Reconnected to network.", "success");
        return true;
      } else {
        updateStatus(true);
        toast("Unable to reach server. Still offline.", "error");
        return false;
      }
    } finally {
      setIsRetrying(false);
    }
  }, [options?.checkUrl, updateStatus, toast]);

  return {
    isOffline,
    isRetrying,
    lastCheckTime,
    retryConnection,
  };
}

export interface OfflineBannerProps {
  className?: string;
  checkUrl?: string;
  showDismiss?: boolean;
}

/**
 * OfflineBanner Component:
 * Displays a persistent, non-intrusive top banner when the browser loses network connection.
 * Includes status indicator icons, offline notice text, and a manual "Retry Connection" sync button.
 */
export function OfflineBanner({
  className = "",
  checkUrl = "/api/health",
  showDismiss = true,
}: OfflineBannerProps) {
  const { isOffline, isRetrying, retryConnection } = useOfflineStatus({ checkUrl });
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissed state when offline status triggers
  useEffect(() => {
    if (isOffline) {
      setDismissed(false);
    }
  }, [isOffline]);

  if (!isOffline || dismissed) {
    return null;
  }

  return (
    <aside
      role="alert"
      aria-live="polite"
      data-testid="offline-banner"
      className={`sticky top-0 z-50 w-full border-b border-amber-500/30 bg-amber-50/95 dark:bg-amber-950/95 text-amber-950 dark:text-amber-100 px-4 py-2.5 shadow-md backdrop-blur-md transition-all duration-300 ${className}`}
    >
      <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs sm:text-sm font-medium">
        {/* Left Section: Status Icon & Description */}
        <div className="flex items-center gap-2.5">
          <span
            data-testid="offline-icon"
            className="flex items-center justify-center p-1.5 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0"
          >
            <WifiOff className="w-4 h-4" />
          </span>
          <div>
            <span className="font-semibold text-amber-950 dark:text-amber-50">
              You are currently offline.
            </span>{" "}
            <span className="text-amber-800/90 dark:text-amber-200/90 hidden md:inline">
              Working with cached WorkSphere data. Features will sync when reconnected.
            </span>
          </div>
        </div>

        {/* Right Section: Action Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={retryConnection}
            disabled={isRetrying}
            data-testid="retry-connection-button"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? "animate-spin" : ""}`} />
            {isRetrying ? "Checking..." : "Retry Connection"}
          </button>

          {showDismiss && (
            <button
              onClick={() => setDismissed(true)}
              data-testid="dismiss-offline-banner"
              aria-label="Dismiss offline banner"
              className="p-1 rounded-md text-amber-800 dark:text-amber-300 hover:bg-amber-200/50 dark:hover:bg-amber-900/50 transition"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

export default OfflineBanner;
