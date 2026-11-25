"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession, useClerk } from "@clerk/nextjs";
import { IDLE_TIMEOUT_MS, WARNING_DURATION_MS } from "@/lib/auth/sessionConfig";

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
const ACTIVITY_THROTTLE_MS = 2000;
const SESSION_TOUCH_THROTTLE_MS = 60 * 1000;

/**
 * Hook to manage idle session expiration with a warning dialog
 * using Clerk-native session lifecycle management.
 */
export function useIdleSession(
  options: UseIdleSessionOptions = {},
): UseIdleSessionReturn {
  const {
    idleTimeoutMs = IDLE_TIMEOUT_MS,
    warningDurationMs = WARNING_DURATION_MS,
    redirectUrl = "/sign-in",
    enabled = true,
    onWarning,
    onExpired,
  } = options;

  const router = useRouter();
  const { isLoaded, isSignedIn, session } = useSession();
  const { signOut: clerkSignOut } = useClerk();

  const isSessionActive = Boolean(enabled && isLoaded && isSignedIn && session);

  const [showWarning, setShowWarning] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(
    Math.ceil(warningDurationMs / 1000),
  );
  const [isRefreshing, setIsRefreshing] = useState(false);

  const lastActiveRef = useRef<number>(Date.now());
  const lastTouchRef = useRef<number>(Date.now());
  const warningStartRef = useRef<number | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);

  // Sign out via Clerk and redirect
  const signOut = useCallback(async () => {
    setShowWarning(false);
    warningStartRef.current = null;
    onExpired?.();

    try {
      channelRef.current?.postMessage({ type: "LOGOUT" });
    } catch {
      // Ignore broadcast errors
    }

    try {
      localStorage.removeItem(STORAGE_LAST_ACTIVE_KEY);
    } catch {
      // Ignore storage errors
    }

    try {
      if (typeof clerkSignOut === "function") {
        await clerkSignOut({ redirectUrl });
      } else {
        router.push(redirectUrl);
        router.refresh();
      }
    } catch {
      router.push(redirectUrl);
    }
  }, [clerkSignOut, onExpired, redirectUrl, router]);

  // Extend session: touch Clerk session and reset timers
  const extendSession = useCallback(async () => {
    if (!session) return;
    setIsRefreshing(true);
    try {
      if (typeof session.touch === "function") {
        await session.touch();
      } else if (typeof session.getToken === "function") {
        await session.getToken({ skipCache: true });
      }
      const now = Date.now();
      lastActiveRef.current = now;
      lastTouchRef.current = now;
      warningStartRef.current = null;
      setShowWarning(false);
      setRemainingSeconds(Math.ceil(warningDurationMs / 1000));

      try {
        localStorage.setItem(STORAGE_LAST_ACTIVE_KEY, String(now));
        channelRef.current?.postMessage({
          type: "ACTIVITY_RESET",
          timestamp: now,
        });
      } catch {
        // Ignore storage errors
      }
    } catch (err) {
      console.error("[useIdleSession] Failed to extend session:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, [session, warningDurationMs]);

  // Record user activity with throttling
  const recordActivity = useCallback(() => {
    if (!isSessionActive || warningStartRef.current !== null) return;

    const now = Date.now();
    // Throttle local timestamp writes
    if (now - lastActiveRef.current > ACTIVITY_THROTTLE_MS) {
      lastActiveRef.current = now;
      try {
        localStorage.setItem(STORAGE_LAST_ACTIVE_KEY, String(now));
        channelRef.current?.postMessage({
          type: "ACTIVITY_RESET",
          timestamp: now,
        });
      } catch {
        // Ignore
      }
    }

    // Throttle Clerk session.touch() calls to avoid excessive network requests
    if (
      session &&
      typeof session.touch === "function" &&
      now - lastTouchRef.current > SESSION_TOUCH_THROTTLE_MS
    ) {
      lastTouchRef.current = now;
      session.touch().catch(() => {
        // Ignore non-fatal touch errors
      });
    }
  }, [isSessionActive, session]);

  // Multi-tab sync via BroadcastChannel and localStorage
  useEffect(() => {
    if (typeof window === "undefined" || !isSessionActive) return;

    const handleSync = (timestamp: number) => {
      lastActiveRef.current = timestamp;
      if (warningStartRef.current !== null) {
        warningStartRef.current = null;
        setShowWarning(false);
        setRemainingSeconds(Math.ceil(warningDurationMs / 1000));
      }
    };

    try {
      if ("BroadcastChannel" in window) {
        const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        channelRef.current = channel;

        channel.onmessage = (event) => {
          if (
            event.data?.type === "ACTIVITY_RESET" &&
            typeof event.data.timestamp === "number"
          ) {
            handleSync(event.data.timestamp);
          } else if (event.data?.type === "LOGOUT") {
            setShowWarning(false);
            warningStartRef.current = null;
            onExpired?.();
            if (typeof clerkSignOut === "function") {
              clerkSignOut({ redirectUrl }).catch(() => {});
            } else {
              router.push(redirectUrl);
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
          setShowWarning(false);
          warningStartRef.current = null;
          onExpired?.();
          if (typeof clerkSignOut === "function") {
            clerkSignOut({ redirectUrl }).catch(() => {});
          } else {
            router.push(redirectUrl);
          }
        }
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, [
    clerkSignOut,
    isSessionActive,
    onExpired,
    redirectUrl,
    router,
    warningDurationMs,
  ]);

  // Listen to user interaction events
  useEffect(() => {
    if (!isSessionActive || typeof window === "undefined") return;

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
  }, [isSessionActive, recordActivity]);

  // Main ticker interval for idle countdown
  useEffect(() => {
    if (!isSessionActive || typeof window === "undefined") {
      setShowWarning(false);
      warningStartRef.current = null;
      return;
    }

    const intervalId = setInterval(() => {
      const now = Date.now();
      const idleTime = now - lastActiveRef.current;

      if (warningStartRef.current === null) {
        if (idleTime >= idleTimeoutMs) {
          warningStartRef.current = now;
          setShowWarning(true);
          setRemainingSeconds(Math.ceil(warningDurationMs / 1000));
          onWarning?.();
        }
      } else {
        const elapsedSinceWarning = now - warningStartRef.current;
        const remaining = Math.max(
          0,
          Math.ceil((warningDurationMs - elapsedSinceWarning) / 1000),
        );
        setRemainingSeconds(remaining);

        if (elapsedSinceWarning >= warningDurationMs) {
          clearInterval(intervalId);
          signOut();
        }
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, [idleTimeoutMs, isSessionActive, onWarning, signOut, warningDurationMs]);

  return {
    showWarning,
    remainingSeconds,
    extendSession,
    signOut,
    isRefreshing,
  };
}
