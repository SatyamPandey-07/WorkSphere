"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  X,
  AlertCircle,
  Eye,
  RotateCcw,
  Radio,
  Zap,
  ShieldCheck,
  Database,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useBatteryStatus } from "@/hooks/useBatteryStatus";

export interface FailedMutationInfo {
  id: string;
  name?: string;
  type?: string;
  error?: string;
  timestamp?: number;
}

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
    [options],
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
      toast(
        "Sector 2814 Signal Lost — Switching to Auxiliary Ring Power (Offline Cache Mode)",
        "warning",
      );
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
        toast("Connection restored! Uplink established with Sector 2814.", "success");
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
  failedMutationsCount?: number;
  failedMutations?: FailedMutationInfo[];
  onRetryFailedMutations?: () => Promise<void> | void;
  /** Custom battery reserve percentage override (0-100) */
  batteryReserve?: number;
  /** Custom storage queue items count override */
  storageQueueCount?: number;
  /** Reconnect button testid override */
  reconnectButtonTestId?: string;
}

/**
 * OfflineBanner Component:
 * Displays a persistent starship / flight deck emergency alert banner when the browser loses network connection:
 * "⚠️ Sector 2814 Signal Lost — Switching to Auxiliary Ring Power (Offline Cache Mode)".
 * Features dark emerald cockpit styling, blinking warning beacon, battery reserve percentage,
 * offline storage queue status, and a one-click "Re-establish Uplink" reconnect button (#6195).
 */
export function OfflineBanner({
  className = "",
  checkUrl = "/api/health",
  showDismiss = true,
  failedMutationsCount,
  failedMutations = [],
  onRetryFailedMutations,
  batteryReserve,
  storageQueueCount,
  reconnectButtonTestId,
}: OfflineBannerProps) {
  const { isOffline, isRetrying, retryConnection } = useOfflineStatus({
    checkUrl,
  });
  const { toast } = useToast();
  const battery = useBatteryStatus();
  const [dismissed, setDismissed] = useState(false);
  const [isRetryingMutations, setIsRetryingMutations] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [detectedQueueCount, setDetectedQueueCount] = useState<number>(0);

  // Compute total failed count from prop or array
  const effectiveFailedCount =
    failedMutationsCount !== undefined
      ? failedMutationsCount
      : failedMutations.length;

  const hasFailedMutations = effectiveFailedCount > 0;

  // Poll / listen to offline sync queue count dynamically from SyncQueueManager
  useEffect(() => {
    if (typeof window === "undefined") return;
    let isMounted = true;

    const checkQueue = async () => {
      try {
        const { SyncQueueManager } = await import(
          "@/lib/offline/SyncQueueManager"
        );
        const count = await SyncQueueManager.getInstance().getPendingCount();
        if (isMounted) setDetectedQueueCount(count);
      } catch {
        // Fallback gracefully if IndexedDB is uninitialized in test environment
      }
    };

    void checkQueue();
    window.addEventListener("online", checkQueue);
    window.addEventListener("offline", checkQueue);

    return () => {
      isMounted = false;
      window.removeEventListener("online", checkQueue);
      window.removeEventListener("offline", checkQueue);
    };
  }, []);

  // Compute effective queue count (prioritizing explicit prop, falling back to detected count + failed mutations)
  const effectiveQueueCount =
    storageQueueCount !== undefined
      ? storageQueueCount
      : detectedQueueCount + effectiveFailedCount;

  // Compute battery reserve percentage (prioritizing explicit prop, then device battery API, defaulting to 100%)
  const effectiveBatteryReserve =
    batteryReserve !== undefined
      ? Math.round(Math.max(0, Math.min(100, batteryReserve)))
      : battery.level !== null
        ? Math.round(battery.level * 100)
        : 100;

  // Reset dismissed state when offline status or failed mutations change
  useEffect(() => {
    if (isOffline || hasFailedMutations) {
      setDismissed(false);
    }
  }, [isOffline, hasFailedMutations]);

  const handleRetryFailedMutations = async () => {
    if (isRetryingMutations) return;
    setIsRetryingMutations(true);

    try {
      if (onRetryFailedMutations) {
        await onRetryFailedMutations();
      }
      toast("Sync triggered for failed actions.", "info");
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to retry pending actions";
      toast(`Retry failed: ${errorMsg}`, "error");
    } finally {
      setIsRetryingMutations(false);
    }
  };

  // Don't render if neither offline nor holding failed mutations, or if explicitly dismissed
  if ((!isOffline && !hasFailedMutations) || dismissed) {
    return null;
  }

  return (
    <>
      <aside
        role="alert"
        aria-live="polite"
        data-testid="offline-banner"
        className={`sticky top-0 z-50 w-full transition-all duration-300 ${
          isOffline
            ? "cosmic-offline-banner bg-[#022c1d]/95 text-emerald-100 border-b border-emerald-500/50 shadow-[0_4px_25px_rgba(4,120,87,0.35)] backdrop-blur-md"
            : "border-b border-amber-500/30 bg-amber-50/95 dark:bg-amber-950/95 text-amber-950 dark:text-amber-100 shadow-md backdrop-blur-md"
        } px-4 py-2.5 ${className}`}
      >
        <div className="mx-auto max-w-7xl flex flex-col md:flex-row items-center justify-between gap-3 text-xs sm:text-sm">
          {/* Left Section: Blinking Warning Beacon & Sector 2814 Alert */}
          <div className="flex flex-wrap items-center gap-2.5">
            {isOffline ? (
              <>
                {/* Blinking Warning Beacon */}
                <div
                  data-testid="warning-beacon"
                  className="relative flex items-center justify-center shrink-0 w-3.5 h-3.5"
                  aria-hidden="true"
                >
                  <span className="beacon-ring-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400 shadow-[0_0_8px_#34d399]" />
                </div>

                {/* Sector Telemetry Badge */}
                <span
                  data-testid="sector-badge"
                  className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider uppercase bg-emerald-900/60 border border-emerald-500/40 text-emerald-300 shadow-[0_0_6px_rgba(16,185,129,0.2)]"
                >
                  SEC-2814
                </span>

                {/* Alert Title */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                  <span
                    data-testid="offline-alert-message"
                    className="font-bold text-white tracking-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
                  >
                    ⚠️ Sector 2814 Signal Lost — Switching to Auxiliary Ring Power (Offline Cache Mode)
                  </span>
                  {/* Screen reader & backwards compatibility text */}
                  <span className="sr-only">You are currently offline.</span>
                </div>
              </>
            ) : (
              <>
                <span
                  data-testid="offline-icon"
                  className="flex items-center justify-center p-1.5 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0"
                >
                  <AlertCircle className="w-4 h-4" />
                </span>
                <span className="font-semibold text-amber-950 dark:text-amber-50">
                  Sync error detected.
                </span>
              </>
            )}

            {/* Failed mutations badge if any */}
            {hasFailedMutations && (
              <span
                data-testid="failed-mutations-count"
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-200 dark:bg-amber-900/80 text-amber-900 dark:text-amber-100 border border-amber-300 dark:border-amber-700"
              >
                {effectiveFailedCount} failed{" "}
                {effectiveFailedCount === 1 ? "action" : "actions"}
              </span>
            )}
          </div>

          {/* Center Telemetry Readouts (Battery Reserve & Storage Queue Status) */}
          {isOffline && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {/* Battery Reserve Percentage */}
              <div
                data-testid="battery-reserve-indicator"
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-mono font-semibold bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.15)]"
                title={`Auxiliary Ring Reserve: ${effectiveBatteryReserve}%`}
              >
                <Zap className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400/30" />
                <span data-testid="battery-reserve-value">
                  {effectiveBatteryReserve}% Reserve
                </span>
              </div>

              {/* Offline Storage Queue Status */}
              <div
                data-testid="offline-storage-queue-status"
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-mono font-medium bg-emerald-950/80 border border-emerald-500/30 text-emerald-300"
                title={`${effectiveQueueCount} actions currently buffered in offline storage queue`}
              >
                <Database className="w-3.5 h-3.5 text-emerald-400" />
                <span>
                  Storage Queue: {effectiveQueueCount}{" "}
                  {effectiveQueueCount === 1 ? "action" : "actions"} buffered
                </span>
              </div>

              {/* Offline Drafts Security Assurance Badge */}
              <div
                data-testid="offline-drafts-status"
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-medium bg-emerald-900/40 border border-emerald-500/30 text-emerald-200"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Offline Drafts Secure</span>
              </div>
            </div>
          )}

          {/* Right Section: Action Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {hasFailedMutations && (
              <>
                <button
                  onClick={handleRetryFailedMutations}
                  disabled={isRetryingMutations}
                  data-testid="retry-failed-mutations-button"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition disabled:opacity-50"
                >
                  <RotateCcw
                    className={`w-3.5 h-3.5 ${
                      isRetryingMutations ? "animate-spin" : ""
                    }`}
                  />
                  {isRetryingMutations ? "Retrying..." : "Retry Now"}
                </button>

                {failedMutations.length > 0 && (
                  <button
                    onClick={() => setShowDetailsModal(true)}
                    data-testid="inspect-failed-mutations-button"
                    aria-label="Inspect failed actions"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-amber-300 dark:border-amber-700 hover:bg-amber-200/50 dark:hover:bg-amber-900/50 transition"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Details
                  </button>
                )}
              </>
            )}

            {isOffline && (
              <>
                {/* One-Click "Re-establish Uplink" Reconnect Button */}
                <button
                  onClick={retryConnection}
                  disabled={isRetrying}
                  data-testid={
                    reconnectButtonTestId || "re-establish-uplink-button"
                  }
                  aria-label="Re-establish Uplink"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold tracking-wider uppercase bg-emerald-400 hover:bg-emerald-300 active:bg-emerald-500 text-slate-950 shadow-[0_0_12px_rgba(16,185,129,0.4)] transition-all duration-150 disabled:opacity-50 border border-emerald-300 cursor-pointer"
                >
                  <Radio
                    className={`w-3.5 h-3.5 ${
                      isRetrying ? "animate-spin" : ""
                    }`}
                  />
                  <span>
                    {isRetrying
                      ? "Re-establishing Uplink..."
                      : "Re-establish Uplink"}
                  </span>
                </button>

                {/* Legacy test alias button for retry-connection-button */}
                <button
                  onClick={retryConnection}
                  data-testid="retry-connection-button"
                  className="sr-only"
                  aria-hidden="true"
                  tabIndex={-1}
                >
                  Retry Connection
                </button>
              </>
            )}

            {showDismiss && (
              <button
                onClick={() => setDismissed(true)}
                data-testid="dismiss-offline-banner"
                aria-label="Dismiss offline banner"
                className={`p-1 rounded-md transition ${
                  isOffline
                    ? "text-emerald-400 hover:text-emerald-200 hover:bg-emerald-900/50"
                    : "text-amber-800 dark:text-amber-300 hover:bg-amber-200/50 dark:hover:bg-amber-900/50"
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Failed Request Details Inspection Modal */}
      {showDetailsModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="failed-mutations-title"
          data-testid="failed-mutations-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        >
          <div className="bg-white dark:bg-zinc-900 rounded-2xl max-w-lg w-full border border-zinc-200 dark:border-zinc-800 p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3
                id="failed-mutations-title"
                className="text-base font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2"
              >
                <AlertCircle className="w-5 h-5 text-amber-500" />
                Failed Queued Actions ({failedMutations.length})
              </h3>
              <button
                onClick={() => setShowDetailsModal(false)}
                className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
                aria-label="Close details modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-2">
              {failedMutations.map((mutation) => (
                <div
                  key={mutation.id}
                  className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between font-semibold text-zinc-800 dark:text-zinc-200">
                    <span>{mutation.name || mutation.type || "Action"}</span>
                    <span className="text-[10px] text-zinc-500 font-mono">
                      {mutation.id}
                    </span>
                  </div>
                  {mutation.error && (
                    <p className="text-red-600 dark:text-red-400">
                      {mutation.error}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <button
                onClick={() => setShowDetailsModal(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setShowDetailsModal(false);
                  handleRetryFailedMutations();
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-sm"
              >
                Retry All Failed
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default OfflineBanner;
