"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { IDLE_TIMEOUT_MS, WARNING_DURATION_MS } from "@/lib/auth/sessionTokens";

export interface UseIdleSessionOptions {
  /** Inactivity duration before warning dialog appears (default: 30 minutes) */
  idleTimeoutMs?: number;
  /** Countdown duration on warning dialog before auto-logout (default: 60 seconds) */
  warningDurationMs?: number;
  /** Custom redirect path on session expiration (default: "/sign-in") */
  redirectUrl?: string;
  /** Enable or disable idle checking (e.g. disable on public landing or sign-in pages) */
  enabled?: boolean;
  /** Callback fired when warning dialog opens */
  onWarning?: () => void;
  /** Callback fired when session is terminated */
  onExpired?: () => void;
}

export interface UseIdleSessionReturn {
  /** True when user is in the warning state */
  showWarning: boolean;
  /** Seconds remaining in the warning dialog before automatic sign-out */
  remainingSeconds: number;
  /** Manually extend / refresh the session */
  extendSession: () => Promise<void>;
  /** Manually sign out and redirect to sign-in */
  signOut: () => Promise<void>;
  /** Whether the session is currently refreshing */
  isRefreshing: boolean;
}

const STORAGE_LAST_ACTIVE_KEY = "worksphere_last_active_timestamp";
const BROADCAST_CHANNEL_NAME = "worksphere_session_channel";

/**
 * Hook to manage 30-minute idle session expiration with a warning dialog
 * and silent refresh token rotation.
 */
export function useIdleSession(options: UseIdleSessionOptions = {}): UseIdleSessionReturn {
  const {
    idleTimeoutMs = IDLE_TIMEOUT_MS,
    warningDurationMs = WARNING_DURATION_MS,
    redirectUrl = "/sign-in",
    enabled = true,
    onWarning,
    onExpired,
  } = options;

  const router = useRouter();
  const [showWarning, setShowWarning] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(
    Math.ceil(warningDurationMs / 1000),
  );
  const [isRefreshing, setIsRefreshing] = useState(false);

  const lastActiveRef = useRef<number>(Date.now());
  const warningStartRef = useRef<number | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Silently refresh token on server
  const silentTokenRefresh = useCallback(async (): Promise<boolean> => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/auth/session/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      setIsRefreshing(false);
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }, []);

  // Graceful sign out and redirection to sign-in without unhandled errors
  const signOut = useCallback(async () => {
    abortControllerRef.current?.abort();
    setShowWarning(false);
    onExpired?.();

    try {
      channelRef.current?.postMessage({ type: "LOGOUT" });
    } catch {
      // Ignore channel errors
    }

    try {
      await fetch("/api/auth/session/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Ignore network failures during logout
    }

    // Clean up local storage timestamps
    try {
      localStorage.removeItem(STORAGE_LAST_ACTIVE_KEY);
    } catch {
      // Ignore local storage errors
    }

    try {
      router.push(redirectUrl);
      router.refresh();
    } catch {
      if (typeof window !== "undefined") {
        window.location.href = redirectUrl;
      }
    }
  }, [onExpired, redirectUrl, router]);

  // Extend session: perform silent token rotation and reset activity timer
  const extendSession = useCallback(async () => {
    const success = await silentTokenRefresh();
    if (success) {
      const now = Date.now();
      lastActiveRef.current = now;
      warningStartRef.current = null;
      setShowWarning(false);
      setRemainingSeconds(Math.ceil(warningDurationMs / 1000));

      try {
        localStorage.setItem(STORAGE_LAST_ACTIVE_KEY, String(now));
        channelRef.current?.postMessage({ type: "ACTIVITY_RESET", timestamp: now });
      } catch {
        // Ignore storage errors
      }
    }
  }, [silentTokenRefresh, warningDurationMs]);

  // Reset idle timer upon user interaction
  const recordActivity = useCallback(() => {
    // If warning dialog is already showing, user must explicitly click "Stay Logged In"
    if (warningStartRef.current !== null) return;

    const now = Date.now();
    // Throttle timestamp writes (at most once every 2 seconds)
    if (now - lastActiveRef.current > 2000) {
      lastActiveRef.current = now;
      try {
        localStorage.setItem(STORAGE_LAST_ACTIVE_KEY, String(now));
        channelRef.current?.postMessage({ type: "ACTIVITY_RESET", timestamp: now });
      } catch {
        // Ignore
      }
    }
  }, []);

  // Setup broadcast channel for multi-tab activity sync
  useEffect(() => {
    if (typeof window === "undefined" || !enabled) return;

    const handleSync = async (timestamp: number) => {
      lastActiveRef.current = timestamp;
      if (warningStartRef.current !== null) {
        const refreshed = await silentTokenRefresh();
        if (refreshed) {
          warningStartRef.current = null;
          setShowWarning(false);
          setRemainingSeconds(Math.ceil(warningDurationMs / 1000));
        }
      }
    };

    try {
      if ("BroadcastChannel" in window) {
        const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        channelRef.current = channel;

        channel.onmessage = (event) => {
          if (event.data?.type === "ACTIVITY_RESET" && typeof event.data.timestamp === "number") {
            handleSync(event.data.timestamp);
          } else if (event.data?.type === "LOGOUT") {
            abortControllerRef.current?.abort();
            setShowWarning(false);
            onExpired?.();
            try {
              router.push(redirectUrl);
              router.refresh();
            } catch {
              if (typeof window !== "undefined") {
                window.location.href = redirectUrl;
              }
            }
          }
        };
      }
    } catch {
      // Fallback: window storage event
    }

    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_LAST_ACTIVE_KEY) {
        if (e.newValue) {
          const ts = parseInt(e.newValue, 10);
          if (!isNaN(ts)) {
            handleSync(ts);
          }
        } else {
          // Key removed = logged out in another tab
          abortControllerRef.current?.abort();
          setShowWarning(false);
          onExpired?.();
          try {
            router.push(redirectUrl);
            router.refresh();
          } catch {
            if (typeof window !== "undefined") {
              window.location.href = redirectUrl;
            }
          }
        }
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
      abortControllerRef.current?.abort();
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, [enabled, onExpired, redirectUrl, router, silentTokenRefresh, warningDurationMs]);

  // Listen to user interaction events
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const events: Array<keyof WindowEventMap> = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
      "wheel",
    ];

    const throttledHandler = () => recordActivity();

    events.forEach((eventName) => {
      window.addEventListener(eventName, throttledHandler, { passive: true });
    });

    return () => {
      events.forEach((eventName) => {
        window.removeEventListener(eventName, throttledHandler);
      });
    };
  }, [enabled, recordActivity]);

  // Main ticker interval: checks inactivity duration and warning countdown
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const intervalId = setInterval(() => {
      const now = Date.now();
      const idleTime = now - lastActiveRef.current;

      if (warningStartRef.current === null) {
        // Check if 30 minutes of idle time elapsed
        if (idleTime >= idleTimeoutMs) {
          warningStartRef.current = now;
          setShowWarning(true);
          setRemainingSeconds(Math.ceil(warningDurationMs / 1000));
          onWarning?.();
        }
      } else {
        // In warning countdown state
        const elapsedSinceWarning = now - warningStartRef.current;
        const remaining = Math.max(
          0,
          Math.ceil((warningDurationMs - elapsedSinceWarning) / 1000),
        );
        setRemainingSeconds(remaining);

        if (elapsedSinceWarning >= warningDurationMs) {
          // Warning expired: Clean auto sign-out
          clearInterval(intervalId);
          signOut();
        }
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, [enabled, idleTimeoutMs, warningDurationMs, onWarning, signOut]);

  return {
    showWarning,
    remainingSeconds,
    extendSession,
    signOut,
    isRefreshing,
  };
}
