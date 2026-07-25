import React from "react";
import { Label } from "@/components/ui/label";

interface UserPreferenceToggleProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export function UserPreferenceToggle({
  enabled,
  onToggle,
}: UserPreferenceToggleProps) {
  return (
    <div className="flex items-center justify-between space-x-4 p-4 rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="space-y-1">
        <Label className="text-base font-semibold leading-none flex items-center gap-2">
          Personalized AI Recommendations
        </Label>
        <p className="text-sm text-muted-foreground">
          Re-rank search results based on your check-in history, saved venues,
          and ratings.
        </p>
      </div>
      <label className="relative inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
      </label>
    </div>
  );
}
