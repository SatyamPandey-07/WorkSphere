"use client";

import { useEffect, useState } from "react";
import { X, Download, Sparkles } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function useSyncWorker() {
  useEffect(() => {
    if (typeof window === "undefined" || !window.Worker) return;

    // Next.js Webpack automatically bundles this worker
    const worker = new Worker(
      new URL("../workers/sync.worker.ts", import.meta.url),
      {
        type: "module",
      },
    );

    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      switch (msg.type) {
        case "SYNC_SUCCESS":
          console.log(
            `[Sync Worker] Successfully synced a favorite. Remaining: ${msg.remainingCount}`,
          );
          break;
        case "CIRCUIT_BREAKER_OPEN":
          console.warn(
            `[Sync Worker] Circuit breaker OPEN. Pausing sync for ${msg.timeoutMs}ms due to repeated errors.`,
          );
          break;
        case "PERMANENT_FAILURE":
          console.error(
            `[Sync Worker] Permanent failure for ${msg.action} on ${msg.venueId} after ${msg.attempts} attempts.`,
          );
          break;
        case "SYNC_ERROR":
          console.error(`[Sync Worker] Sync error: ${msg.error}`);
          break;
      }
    };

    worker.addEventListener("message", handleMessage);

    // Initial wake up to process any pending offline actions
    worker.postMessage({ type: "WAKE_UP" });

    // Wake up worker when connection is restored or manually triggered
    const handleWakeUp = () => worker.postMessage({ type: "WAKE_UP" });
    window.addEventListener("online", handleWakeUp);
    window.addEventListener("trigger-sync", handleWakeUp);

    return () => {
      worker.removeEventListener("message", handleMessage);
      window.removeEventListener("online", handleWakeUp);
      window.removeEventListener("trigger-sync", handleWakeUp);
      worker.terminate();
    };
  }, []);
}

/**
 * Global Sync Manager component to ensure outbox sync worker and listeners
 * remain active across all pages in the application. (Issue #871)
 */
export function SyncManager() {
  useSyncWorker();
  return null;
}

/**
 * Hook to register service worker and manage PWA state
 */
export function useServiceWorker() {
  const [isInstalled, setIsInstalled] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [registration, setRegistration] =
    useState<ServiceWorkerRegistration | null>(null);

  // Initialize the dedicated sync worker
  useSyncWorker();

  useEffect(() => {
    setIsInstalled(window.matchMedia("(display-mode: standalone)").matches);
    setIsOnline(navigator.onLine);

    // Register service worker in production mode only to prevent dev evaluation errors
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          console.log("[PWA] Service worker registered");
          setRegistration(reg);

          // Check for updates on every page load
          reg.update();

          // Handle update found
          reg.onupdatefound = () => {
            const installingWorker = reg.installing;
            if (installingWorker) {
              installingWorker.onstatechange = () => {
                if (installingWorker.state === "installed") {
                  if (navigator.serviceWorker.controller) {
                    // New content is available; please refresh.
                    console.log("[PWA] New content available, please refresh.");
                    // Optional: Show a toast or notification to the user
                  } else {
                    // Content is cached for offline use.
                    console.log("[PWA] Content is cached for offline use.");
                  }
                }
              };
            }
          };
        })
        .catch((err) => {
          console.error("[PWA] Service worker registration failed:", err);
        });

      // Handle controller change (e.g. after skipWaiting)
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });
    } else if (
      "serviceWorker" in navigator &&
      process.env.NODE_ENV === "development"
    ) {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => {
          for (const reg of registrations) {
            reg.unregister().catch(() => {});
          }
        })
        .catch(() => {});
    }

    // Online/offline detection
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return { isInstalled, isOnline, registration };
}

/**
 * Hook for PWA install prompt
 */
export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Detect iOS Safari environment
    const detectIOS = () => {
      const userAgent = window.navigator.userAgent.toLowerCase();
      const isIPad =
        userAgent.includes("ipad") ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const isIPhone =
        userAgent.includes("iphone") || userAgent.includes("ipod");
      const isIOSDevice = isIPad || isIPhone;

      // Safari detection (other iOS browsers have "crios", "fxios" etc.)
      const isSafari =
        userAgent.includes("safari") &&
        !userAgent.includes("crios") &&
        !userAgent.includes("fxios") &&
        !userAgent.includes("opios");

      // Check if already in standalone mode
      const isStandalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as any).standalone;

      return isIOSDevice && isSafari && !isStandalone;
    };

    if (typeof window !== "undefined") {
      const ios = detectIOS();
      setIsIOS(ios);
      if (ios) {
        setCanInstall(true);
      }
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setCanInstall(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
    };
  }, []);

  const install = async () => {
    if (isIOS) {
      return "ios";
    }

    if (!deferredPrompt) return false;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    setDeferredPrompt(null);
    setCanInstall(false);

    return outcome === "accepted";
  };

  return { canInstall, isIOS, install };
}

interface OfflineSyncFailureMessage {
  type: "OFFLINE_SYNC_FAILED";
  venueId: string;
  action: "ADD" | "REMOVE";
  attempts: number;
}

interface PushNavigateMessage {
  type: "NAVIGATE_PUSH";
  url: string;
}

function isOfflineSyncFailureMessage(
  data: unknown,
): data is OfflineSyncFailureMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "OFFLINE_SYNC_FAILED"
  );
}

function isPushNavigateMessage(data: unknown): data is PushNavigateMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "NAVIGATE_PUSH"
  );
}

/**
 * Listens for the service worker's OFFLINE_SYNC_FAILED message, sent when a
 * queued favorite action has failed to sync MAX_SYNC_RETRIES times and has
 * been removed from the outbox. Surfaces this to the user instead of the
 * action just silently disappearing. (Issue #712)
 */
function useOfflineSyncNotice() {
  const [notice, setNotice] = useState<OfflineSyncFailureMessage | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const handleMessage = (event: MessageEvent) => {
      if (isOfflineSyncFailureMessage(event.data)) {
        setNotice(event.data);
        setTimeout(() => setNotice(null), 4000);
      }
      if (isPushNavigateMessage(event.data)) {
        window.location.href = event.data.url;
      }
      if (
        typeof event.data === "object" &&
        event.data !== null &&
        event.data.type === "RECEIPT_SYNC_READY"
      ) {
        const { bookingId, filename } = event.data;
        // Trigger download from client when receipt background sync completes
        const downloadUrl = `/api/bookings/${bookingId}/download`;
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download =
          filename || `WorkSphere_Receipt_${bookingId.slice(-6)}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    };

    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", handleMessage);
    };
  }, []);

  return { notice, dismiss: () => setNotice(null) };
}

/**
 * Toast shown when a favorite couldn't be synced after repeated retries.
 * Mount once alongside <OfflineIndicator /> / <PWABanner />.
 */
export function OfflineSyncNotice() {
  const { notice, dismiss } = useOfflineSyncNotice();

  if (!notice) return null;

  const verb = notice.action === "ADD" ? "save" : "remove";

  return (
    <div className="fixed bottom-20 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50">
      <div className="bg-red-600 text-white px-4 py-3 rounded-lg shadow-lg flex items-start gap-3">
        <svg
          className="w-5 h-5 flex-shrink-0 mt-0.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
          />
        </svg>
        <div className="flex-1 text-sm">
          <p className="font-medium">Couldn&apos;t sync your changes</p>
          <p className="text-red-100 text-xs mt-0.5">
            We couldn&apos;t {verb} that favorite after {notice.attempts}{" "}
            attempts. Please try again when you&apos;re back online.
          </p>
        </div>
        <button
          onClick={dismiss}
          className="text-red-100 hover:text-white flex-shrink-0"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * Offline indicator component
 */
export function OfflineIndicator() {
  const { isOnline } = useServiceWorker();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-auto z-50">
      <div className="bg-amber-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"
          />
        </svg>
        <span className="text-sm font-medium">You&apos;re offline</span>
      </div>
    </div>
  );
}

/**
 * Install app button component
 */
export function InstallAppButton() {
  const { canInstall, install } = useInstallPrompt();
  const [showIOSOverlay, setShowIOSOverlay] = useState(false);

  if (!canInstall) return null;

  const handleInstallClick = async () => {
    const res = await install();
    if (res === "ios") {
      setShowIOSOverlay(true);
    }
  };

  return (
    <>
      <button
        onClick={handleInstallClick}
        className="flex items-center gap-2 px-4 py-2 bg-[var(--primary-accent)] text-white rounded-lg hover:opacity-90 transition-colors"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
        <span>Install App</span>
      </button>

      {showIOSOverlay && (
        <IOSInstallOverlay onClose={() => setShowIOSOverlay(false)} />
      )}
    </>
  );
}

/**
 * iOS Safari PWA Installation overlay/guidance modal
 */
export function IOSInstallOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[11000] flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 shadow-2xl max-w-sm w-full animate-in slide-in-from-bottom duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-[color-mix(in_srgb,var(--primary-accent),transparent_0.9)] text-[var(--primary-accent)] animate-pulse">
              <Download className="w-5 h-5" />
            </div>
            <h3 className="text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-white">
              Install WorkSphere
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed mb-6 font-medium">
          Add WorkSphere to your home screen for quick, fullscreen app access
          and offline-enabled workspace discovery.
        </p>

        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-700 dark:text-zinc-300">
              1
            </div>
            <div className="flex-1 pt-1">
              <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                Tap the Share button
              </p>
              <p className="text-[10px] text-zinc-505 mt-0.5 flex items-center gap-1.5">
                Look for
                <span className="inline-flex p-1 bg-zinc-100 dark:bg-zinc-800 rounded border border-zinc-200 dark:border-zinc-700">
                  <svg
                    className="w-3.5 h-3.5 text-[var(--primary-accent)]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
                    <polyline points="16 6 12 2 8 6" />
                    <line x1="12" y1="2" x2="12" y2="15" />
                  </svg>
                </span>
                in Safari's navigation bar.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-700 dark:text-zinc-300">
              2
            </div>
            <div className="flex-1 pt-1">
              <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                Select 'Add to Home Screen'
              </p>
              <p className="text-[10px] text-zinc-505 mt-0.5 flex items-center gap-1.5">
                Scroll down and select
                <span className="inline-flex p-1 bg-zinc-100 dark:bg-zinc-800 rounded border border-zinc-200 dark:border-zinc-700">
                  <svg
                    className="w-3.5 h-3.5 text-zinc-600 dark:text-zinc-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="4" />
                    <line x1="12" y1="8" x2="12" y2="16" />
                    <line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                </span>
                from the share menu options.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full mt-6 py-2.5 bg-[var(--primary-accent)] hover:opacity-90 active:scale-[0.98] text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-lg shadow-[color-mix(in_srgb,var(--primary-accent),transparent_0.75)]"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

/**
 * Premium PWA Install Banner Component
 */
export function PWABanner() {
  const { canInstall, install } = useInstallPrompt();
  const { isOnline } = useServiceWorker();
  const [showIOSOverlay, setShowIOSOverlay] = useState(false);
  const [isDismissed, setIsDismissed] = useState(true); // Default to true until checked in client side

  useEffect(() => {
    if (typeof window !== "undefined") {
      const dismissed = localStorage.getItem("pwa-banner-dismissed") === "true";
      setIsDismissed(dismissed);
    }
  }, []);

  if (!canInstall || isDismissed || !isOnline) return null;

  const handleInstallClick = async () => {
    const res = await install();
    if (res === "ios") {
      setShowIOSOverlay(true);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem("pwa-banner-dismissed", "true");
    setIsDismissed(true);
  };

  return (
    <>
      <div className="fixed bottom-20 left-4 right-4 md:bottom-6 md:right-6 md:left-auto md:w-96 z-50 animate-in slide-in-from-bottom duration-300">
        <div className="relative overflow-hidden bg-zinc-900/90 dark:bg-black/90 backdrop-blur-xl border border-white/10 rounded-2xl p-5 shadow-2xl text-white">
          {/* Subtle colored background glow */}
          <div className="absolute -top-10 -right-10 w-24 h-24 bg-[color-mix(in_srgb,var(--primary-accent),transparent_0.9)] rounded-full blur-xl pointer-events-none" />

          <button
            onClick={handleDismiss}
            className="absolute top-3 right-3 p-1 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>

          <div className="flex gap-3">
            <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-[var(--primary-accent)] flex items-center justify-center text-white">
              <Download className="w-4 h-4" />
            </div>
            <div className="flex-1 pr-4">
              <h4 className="text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
                Install WorkSphere
                <Sparkles className="w-3.5 h-3.5 text-[color-mix(in_srgb,var(--primary-accent),white_0.7)] animate-pulse" />
              </h4>
              <p className="text-[10px] text-zinc-400 mt-1 leading-relaxed font-medium">
                Install as a lightweight app for faster load times, seamless
                offline searches, and native feel.
              </p>

              <div className="mt-4 flex gap-2">
                <button
                  onClick={handleInstallClick}
                  className="px-3.5 py-1.5 bg-[var(--primary-accent)] hover:opacity-90 cursor-pointer active:scale-95 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all shadow-md shadow-[color-mix(in_srgb,var(--primary-accent),transparent_0.8)]"
                >
                  Install Now
                </button>
                <button
                  onClick={handleDismiss}
                  className="px-3.5 py-1.5 bg-white/5 hover:bg-white/10 cursor-pointer text-[10px] font-black uppercase tracking-wider rounded-lg border border-white/10 transition-all"
                >
                  Maybe Later
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showIOSOverlay && (
        <IOSInstallOverlay onClose={() => setShowIOSOverlay(false)} />
      )}
    </>
  );
}
