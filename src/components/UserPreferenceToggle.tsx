import React, { useId } from "react";
import { Label } from "@/components/ui/label";

export interface UserPreferenceToggleProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  disabled?: boolean;
  id?: string;
  title?: string;
  description?: string;
  badge?: React.ReactNode;
  className?: string;
}

export function UserPreferenceToggle({
  enabled,
  onToggle,
  disabled = false,
  id: customId,
  title = "Personalized AI Recommendations",
  description = "Re-rank search results based on your check-in history, saved venues, and ratings.",
  badge,
  className = "",
}: UserPreferenceToggleProps) {
  const generatedId = useId();
  const inputId = customId || `user-pref-toggle-${generatedId}`;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    onToggle(e.target.checked);
  };

  return (
    <div
      data-testid="user-preference-toggle"
      className={`flex items-center justify-between space-x-4 p-4 rounded-xl border bg-card text-card-foreground shadow-sm transition-opacity ${
        disabled ? "opacity-60 cursor-not-allowed" : ""
      } ${className}`.trim()}
    >
      <div className="space-y-1">
        <Label
          htmlFor={inputId}
          data-testid="user-preference-toggle-title"
          className={`text-base font-semibold leading-none flex items-center gap-2 ${
            disabled ? "cursor-not-allowed" : "cursor-pointer"
          }`}
        >
          <span>{title}</span>
          {badge}
        </Label>
        {description && (
          <p
            data-testid="user-preference-toggle-desc"
            className="text-sm text-muted-foreground"
          >
            {description}
          </p>
        )}
      </div>
      <label
        htmlFor={inputId}
        data-testid="user-preference-toggle-switch"
        className={`relative inline-flex items-center ${
          disabled ? "cursor-not-allowed" : "cursor-pointer"
        }`}
      >
        <input
          id={inputId}
          type="checkbox"
          role="switch"
          aria-checked={enabled}
          aria-label={title}
          disabled={disabled}
          data-testid="user-preference-toggle-input"
          className="sr-only peer"
          checked={enabled}
          onChange={handleChange}
        />
        <div
          className={`w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600 ${
            disabled ? "opacity-50" : ""
          }`}
        ></div>
      </label>
    </div>
  );
}

export default UserPreferenceToggle;
