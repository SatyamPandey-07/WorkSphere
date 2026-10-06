"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  WifiOff,
  RefreshCw,
  X,
  AlertCircle,
  Eye,
  RotateCcw,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";

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

  const onStatusChangeRef = React.useRef(options?.onStatusChange);
  onStatusChangeRef.current = options?.onStatusChange;

  const updateStatus = useCallback((offline: boolean) => {
    setIsOffline(offline);
    onStatusChangeRef.current?.(offline);
  }, []);

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
  failedMutationsCount?: number;
  failedMutations?: FailedMutationInfo[];
  onRetryFailedMutations?: () => Promise<void> | void;
}

/**
 * OfflineBanner Component:
 * Displays a persistent, non-intrusive top banner when the browser loses network connection
 * or when failed queued mutations require retry.
 */
export function OfflineBanner({
  className = "",
  checkUrl = "/api/health",
  showDismiss = true,
  failedMutationsCount,
  failedMutations = [],
  onRetryFailedMutations,
}: OfflineBannerProps) {
  const { isOffline, isRetrying, retryConnection } = useOfflineStatus({
    checkUrl,
  });
  const { toast } = useToast();
  const [dismissed, setDismissed] = useState(false);
  const [isRetryingMutations, setIsRetryingMutations] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  // Compute total failed count from prop or array
  const effectiveFailedCount =
    failedMutationsCount !== undefined
      ? failedMutationsCount
      : failedMutations.length;

  const hasFailedMutations = effectiveFailedCount > 0;

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
        className={`sticky top-0 z-50 w-full border-b border-amber-500/30 bg-amber-50/95 dark:bg-amber-950/95 text-amber-950 dark:text-amber-100 px-4 py-2.5 shadow-md backdrop-blur-md transition-all duration-300 ${className}`}
      >
        <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs sm:text-sm font-medium">
          {/* Left Section: Status Icon & Description */}
          <div className="flex items-center gap-2.5">
            <span
              data-testid="offline-icon"
              className="flex items-center justify-center p-1.5 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0"
            >
              {isOffline ? (
                <WifiOff className="w-4 h-4" />
              ) : (
                <AlertCircle className="w-4 h-4" />
              )}
            </span>
            <div>
              <span className="font-semibold text-amber-950 dark:text-amber-50">
                {isOffline
                  ? "You are currently offline."
                  : "Sync error detected."}
              </span>{" "}
              {isOffline ? (
                <span className="text-amber-800/90 dark:text-amber-200/90 hidden md:inline">
                  Working with cached WorkSphere data. Features will sync when
                  reconnected.
                </span>
              ) : null}
              {hasFailedMutations && (
                <span
                  data-testid="failed-mutations-count"
                  className="inline-flex items-center ml-2 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-200 dark:bg-amber-900/80 text-amber-900 dark:text-amber-100 border border-amber-300 dark:border-amber-700"
                >
                  {effectiveFailedCount} failed{" "}
                  {effectiveFailedCount === 1 ? "action" : "actions"}
                </span>
              )}
            </div>
          </div>

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
              <button
                onClick={retryConnection}
                disabled={isRetrying}
                data-testid="retry-connection-button"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isRetrying ? "animate-spin" : ""}`}
                />
                {isRetrying ? "Checking..." : "Retry Connection"}
              </button>
            )}

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
