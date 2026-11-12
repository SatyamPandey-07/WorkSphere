"use client";

import React from "react";
import { Check } from "lucide-react";

export interface PresetFolderColor {
  name: string;
  hex: string;
}

export const PRESET_FOLDER_COLORS: PresetFolderColor[] = [
  { name: "Blue", hex: "#3b82f6" },
  { name: "Indigo", hex: "#6366f1" },
  { name: "Purple", hex: "#8b5cf6" },
  { name: "Pink", hex: "#ec4899" },
  { name: "Emerald", hex: "#10b981" },
  { name: "Amber", hex: "#f59e0b" },
  { name: "Rose", hex: "#f43f5e" },
  { name: "Cyan", hex: "#06b6d4" },
];

/**
 * Calculates accessible text contrast color (#000000 or #ffffff) based on ITU-R BT.709 perceived luminance.
 * Supports 3-digit shorthand (#fff), 6-digit hex (#ffffff), and safely handles invalid/nullish inputs.
 */
export function getContrastTextColor(hexColor?: string | null): string {
  if (!hexColor || typeof hexColor !== "string") {
    return "#ffffff";
  }

  let hex = hexColor.trim().replace(/^#/, "");

  // Expand 3-digit shorthand to 6 digits (#abc -> #aabbcc)
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }

  if (hex.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(hex)) {
    return "#ffffff";
  }

  const r = parseInt(hex.substring(0, 2), 16) || 0;
  const g = parseInt(hex.substring(2, 4), 16) || 0;
  const b = parseInt(hex.substring(4, 6), 16) || 0;

  // Perceived luminance formula (ITU-R BT.709)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.65 ? "#000000" : "#ffffff";
}

export interface FolderColorPickerProps {
  selectedColor?: string | null;
  onChange: (color: string) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
  testId?: string;
  id?: string;
}

export function FolderColorPicker({
  selectedColor,
  onChange,
  label = "Workspace Tag Color",
  disabled = false,
  className = "",
  testId = "folder-color-picker",
  id = "folder-custom-color",
}: FolderColorPickerProps) {
  const normalizedColor =
    typeof selectedColor === "string" && selectedColor.trim()
      ? selectedColor.trim()
      : "#3b82f6";

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    onChange(e.target.value);
  };

  const handlePresetClick = (hex: string) => {
    if (disabled) return;
    onChange(hex);
  };

  return (
    <div
      data-testid={testId}
      className={`space-y-2 ${className}`.trim()}
      role="group"
      aria-label={label}
    >
      <label
        htmlFor={id}
        data-testid={`${testId}-label`}
        className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider"
      >
        {label}
      </label>
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Preset color options"
      >
        {PRESET_FOLDER_COLORS.map((preset) => {
          const isSelected =
            normalizedColor.toLowerCase() === preset.hex.toLowerCase();
          const checkmarkColor = getContrastTextColor(preset.hex);
          const slug = preset.name.toLowerCase();

          return (
            <button
              key={preset.hex}
              type="button"
              disabled={disabled}
              onClick={() => handlePresetClick(preset.hex)}
              title={preset.name}
              aria-label={`${preset.name} color swatch${isSelected ? " (selected)" : ""}`}
              aria-pressed={isSelected}
              data-testid={`${testId}-swatch-${slug}`}
              className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none ${
                isSelected
                  ? "scale-110 ring-2 ring-offset-2 ring-zinc-900 dark:ring-white shadow-sm"
                  : "hover:scale-110 hover:opacity-90"
              }`}
              style={{ backgroundColor: preset.hex }}
            >
              {isSelected && (
                <Check
                  data-testid={`${testId}-checkmark`}
                  className="w-4 h-4 drop-shadow-sm transition-all duration-200 animate-in zoom-in-50"
                  style={{ color: checkmarkColor }}
                  strokeWidth={2.75}
                />
              )}
            </button>
          );
        })}

        {/* Custom hex color input */}
        <div className="relative flex items-center gap-1.5 ml-1">
          <input
            id={id}
            type="color"
            value={
              /^#[0-9a-fA-F]{6}$/.test(normalizedColor)
                ? normalizedColor
                : "#3b82f6"
            }
            disabled={disabled}
            onChange={handleCustomChange}
            data-testid={`${testId}-custom-input`}
            className="w-7 h-7 rounded-full border-0 cursor-pointer p-0 bg-transparent disabled:opacity-40 disabled:cursor-not-allowed"
            title="Custom Hex Color"
            aria-label="Custom hex color picker"
          />
          <span
            data-testid={`${testId}-hex-value`}
            className="text-xs font-mono text-zinc-500 dark:text-zinc-400 uppercase select-all"
          >
            {normalizedColor}
          </span>
        </div>
      </div>
    </div>
  );
}

export default FolderColorPicker;
