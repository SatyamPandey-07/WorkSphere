"use client";

import { Bell, BellOff } from "lucide-react";
import { usePushNotifications } from "@/hooks/usePushNotifications";

export function PushNotificationToggle() {
  const {
    isSupported,
    isSubscribed,
    permission,
    isLoading,
    subscribe,
    unsubscribe,
  } = usePushNotifications();

  if (!isSupported || permission === "denied") return null;

  const handleToggle = async () => {
    if (isSubscribed) {
      await unsubscribe();
    } else {
      await subscribe();
    }
  };

  return (
    <button
      onClick={handleToggle}
      disabled={isLoading}
      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
      title={isSubscribed ? "Disable notifications" : "Enable notifications"}
    >
      {isSubscribed ? (
        <Bell className="w-4 h-4 text-green-500" />
      ) : (
        <BellOff className="w-4 h-4 text-zinc-400" />
      )}
      <span className="text-zinc-700 dark:text-zinc-300">
        {isLoading
          ? "Updating..."
          : isSubscribed
            ? "Notifications on"
            : "Notifications off"}
      </span>
    </button>
  );
}
