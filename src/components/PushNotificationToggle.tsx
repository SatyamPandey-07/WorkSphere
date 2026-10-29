"use client";

import React, { useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { usePushNotifications } from "@/hooks/usePushNotifications";

export interface PushNotificationToggleProps {
  className?: string;
  showLabel?: boolean;
  onSuccess?: (isSubscribed: boolean) => void;
  onError?: (error: Error) => void;
}

export function PushNotificationToggle({
  className = "",
  showLabel = true,
  onSuccess,
  onError,
}: PushNotificationToggleProps = {}) {
  const {
    isSupported,
    isSubscribed,
    permission,
    isLoading,
    subscribe,
    unsubscribe,
  } = usePushNotifications();

  const [isToggling, setIsToggling] = useState(false);

  if (!isSupported || permission === "denied") return null;

  const busy = isLoading || isToggling;

  const handleToggle = async () => {
    if (busy) return;
    setIsToggling(true);
    try {
      if (isSubscribed) {
        await unsubscribe();
        onSuccess?.(false);
      } else {
        await subscribe();
        onSuccess?.(true);
      }
    } catch (err: any) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      console.error("Push notification toggle failed", errorObj);
      onError?.(errorObj);
    } finally {
      setIsToggling(false);
    }
  };

  const title = busy
    ? "Updating notifications..."
    : isSubscribed
      ? "Disable notifications"
      : "Enable notifications";

  const labelText = busy
    ? "Updating..."
    : isSubscribed
      ? "Notifications on"
      : "Notifications off";

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={busy}
      aria-pressed={isSubscribed}
      aria-label={title}
      title={title}
      data-testid="push-notification-toggle"
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 ${className}`.trim()}
    >
      {busy ? (
        <Loader2
          data-testid="push-notification-loading-icon"
          className="w-4 h-4 animate-spin text-zinc-400"
        />
      ) : isSubscribed ? (
        <Bell
          data-testid="push-notification-bell-icon"
          className="w-4 h-4 text-green-500"
        />
      ) : (
        <BellOff
          data-testid="push-notification-bell-off-icon"
          className="w-4 h-4 text-zinc-400"
        />
      )}
      {showLabel && (
        <span
          data-testid="push-notification-label"
          className="text-zinc-700 dark:text-zinc-300"
        >
          {labelText}
        </span>
      )}
    </button>
  );
}

export default PushNotificationToggle;
