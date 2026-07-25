import { Star } from "lucide-react";

interface QuietHoursBadgeProps {
  hours: number[];
}

export function QuietHoursBadge({ hours }: QuietHoursBadgeProps) {
  if (hours.length === 0) return null;

  // Format hours, e.g., 9 -> "09:00"
  const formattedHours = hours
    .sort((a, b) => a - b)
    .map((h) => `${h.toString().padStart(2, "0")}:00`);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-xl bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 text-sm text-green-800 dark:text-green-300">
      <div className="flex items-center gap-1.5 font-bold shrink-0">
        <Star className="w-4 h-4 fill-current" />
        <Star className="w-4 h-4 fill-current" />
        <span>Recommended Quiet Hours:</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {formattedHours.map((h) => (
          <span
            key={h}
            className="px-2 py-0.5 rounded bg-green-100 dark:bg-green-500/20 font-medium"
          >
            {h}
          </span>
        ))}
      </div>
    </div>
  );
}
