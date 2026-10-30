import React from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export interface QuietHoursBadgeProps {
  hours?: number[];
  className?: string;
}

export function QuietHoursBadge({ hours, className }: QuietHoursBadgeProps) {
  if (!Array.isArray(hours) || hours.length === 0) {
    return null;
  }

  // Filter valid hour integers between 0 and 24, deduplicate, and sort immutably
  const validHours = Array.from(
    new Set(
      hours
        .filter(
          (h) =>
            typeof h === "number" &&
            Number.isFinite(h) &&
            h >= 0 &&
            h <= 24,
        )
        .map(Math.floor),
    ),
  ).sort((a, b) => a - b);

  if (validHours.length === 0) {
    return null;
  }

  // Format hours, e.g., 9 -> "09:00"
  const formattedHours = validHours.map(
    (h) => `${h.toString().padStart(2, "0")}:00`,
  );

  return (
    <div
      role="region"
      aria-label="Recommended quiet hours"
      data-testid="quiet-hours-badge"
      className={cn(
        "flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-xl bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 text-sm text-green-800 dark:text-green-300",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 font-bold shrink-0">
        <Star className="w-4 h-4 fill-current" aria-hidden="true" />
        <Star className="w-4 h-4 fill-current" aria-hidden="true" />
        <span>Recommended Quiet Hours:</span>
      </div>
      <div
        className="flex flex-wrap gap-1.5"
        role="list"
        aria-label="Quiet hour time slots"
      >
        {formattedHours.map((h, idx) => (
          <span
            key={h}
            role="listitem"
            data-testid={`quiet-hours-pill-${validHours[idx]}`}
            className="px-2 py-0.5 rounded bg-green-100 dark:bg-green-500/20 font-medium font-mono text-xs"
          >
            {h}
          </span>
        ))}
      </div>
    </div>
  );
}

export default QuietHoursBadge;
