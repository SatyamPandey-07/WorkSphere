"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

export function PWAUpdateListener() {
  const { toast } = useToast();
  const waitingWorkerRef = useRef<ServiceWorker | null>(null);
  const toastShownRef = useRef(false);
  const refreshingRef = useRef(false);
  const [showBanner, setShowBanner] = useState(false);

  const handleRefresh = useCallback(() => {
    if (waitingWorkerRef.current) {
      waitingWorkerRef.current.postMessage({ type: "SKIP_WAITING" });
    }
    if (!refreshingRef.current) {
      refreshingRef.current = true;
      if (typeof window !== "undefined" && window.location) {
        try {
          window.location.reload();
        } catch {
          // Fallback for test environments without full location navigation implementation
        }
      }
    }
  }, []);

  const handleDismiss = useCallback(() => {
    setShowBanner(false);
  }, []);

  const triggerUpdateNotice = useCallback(
    (sw: ServiceWorker | null) => {
      if (sw) {
        waitingWorkerRef.current = sw;
      }
      setShowBanner(true);

      if (!toastShownRef.current) {
        toastShownRef.current = true;
        try {
          toast?.("New version available.", "success", {
            label: "Click here to reload",
            onClick: handleRefresh,
          });
        } catch {
          // Ignore toast errors if ToastProvider is unmounted
        }
      }
    },
    [toast, handleRefresh],
  );

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator))
      return;

    // Reload the page once the new service worker takes control.
    const handleControllerChange = () => {
      if (!refreshingRef.current) {
        refreshingRef.current = true;
        try {
          window.location.reload();
        } catch {
          // Ignore navigation error in tests
        }
      }
    };

    navigator.serviceWorker.addEventListener?.(
      "controllerchange",
      handleControllerChange,
    );

    // Listen for custom event dispatched when a new SW finishes installing
    const handleCustomEvent = (e: Event) => {
      const customEvent = e as CustomEvent<ServiceWorker>;
      triggerUpdateNotice(customEvent.detail || null);
    };

    window.addEventListener("pwa-update-available", handleCustomEvent);

    // Direct registration check: detect service worker waiting state
    if (typeof navigator.serviceWorker.getRegistration === "function") {
      navigator.serviceWorker
        .getRegistration()
        .then((reg) => {
          if (!reg) return;

          if (reg.waiting) {
            triggerUpdateNotice(reg.waiting);
          }

          reg.addEventListener?.("updatefound", () => {
            const installing = reg.installing;
            if (!installing) return;

            installing.addEventListener?.("statechange", () => {
              if (
                installing.state === "installed" &&
                navigator.serviceWorker.controller
              ) {
                triggerUpdateNotice(installing);
              }
            });
          });
        })
        .catch(() => {
          // Ignore registration lookup errors
        });
    }

    if (typeof navigator.serviceWorker.ready?.then === "function") {
      navigator.serviceWorker.ready
        .then((reg) => {
          if (reg?.waiting) {
            triggerUpdateNotice(reg.waiting);
          }
        })
        .catch(() => {
          // Ignore ready lookup errors
        });
    }

    return () => {
      navigator.serviceWorker.removeEventListener?.(
        "controllerchange",
        handleControllerChange,
      );
      window.removeEventListener("pwa-update-available", handleCustomEvent);
    };
  }, [triggerUpdateNotice]);

  if (!showBanner) {
    return null;
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-[9999] flex items-center gap-4 rounded-xl border border-zinc-200 bg-white/95 p-4 shadow-xl backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/95 animate-in slide-in-from-bottom-5 duration-300"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
          <RefreshCw className="h-5 w-5" />
        </div>
        <div className="flex flex-col">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Update available
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            A new version of WorkSphere is ready.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleRefresh}
          className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:bg-blue-500 dark:hover:bg-blue-400"
        >
          Refresh Now
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          aria-label="Dismiss update notification"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
