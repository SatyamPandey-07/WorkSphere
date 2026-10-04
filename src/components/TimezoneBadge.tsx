"use client";

import { useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { CopyToClipboardButton } from "@/components/ui/CopyToClipboardButton";

/**
 * Returns the browser's IANA timezone (e.g. "Asia/Kolkata"),
 * falling back to "UTC" if the Intl API is unavailable or returns nothing.
 */
export function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function TimezoneBadge() {
  // Detect on the client only, to avoid server/client hydration mismatches.
  const [timezone, setTimezone] = useState<string | null>(null);

  useEffect(() => {
    setTimezone(getUserTimezone());
  }, []);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-blue-500/10 p-2 text-blue-600 dark:text-blue-400">
          <Globe className="h-4 w-4" aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Your timezone
          </p>
          <p className="text-sm font-medium" data-testid="timezone-value">
            {timezone ?? "Detecting…"}
          </p>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Detected from your browser. Useful for knowing when reminders and
            quiet hours trigger.
          </p>
        </div>
      </div>
      {timezone && (
        <CopyToClipboardButton
          textToCopy={timezone}
          label="Copy"
          toastMessage="Timezone copied!"
        />
      )}
    </div>
  );
}
