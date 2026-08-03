"use client";

import { Check } from "lucide-react";

export const PRESET_FOLDER_COLORS = [
  { name: "Blue", hex: "#3b82f6" },
  { name: "Indigo", hex: "#6366f1" },
  { name: "Purple", hex: "#8b5cf6" },
  { name: "Pink", hex: "#ec4899" },
  { name: "Emerald", hex: "#10b981" },
  { name: "Amber", hex: "#f59e0b" },
  { name: "Rose", hex: "#f43f5e" },
  { name: "Cyan", hex: "#06b6d4" },
];

interface FolderColorPickerProps {
  selectedColor: string;
  onChange: (color: string) => void;
  label?: string;
}

export function FolderColorPicker({
  selectedColor,
  onChange,
  label = "Workspace Tag Color",
}: FolderColorPickerProps) {
  const normalizedColor = selectedColor || "#3b82f6";

  return (
    <div className="space-y-2">
      <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {PRESET_FOLDER_COLORS.map((preset) => {
          const isSelected =
            normalizedColor.toLowerCase() === preset.hex.toLowerCase();
          return (
            <button
              key={preset.hex}
              type="button"
              onClick={() => onChange(preset.hex)}
              title={preset.name}
              className={`w-7 h-7 rounded-full flex items-center justify-center transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${
                isSelected
                  ? "scale-110 ring-2 ring-offset-2 ring-zinc-900 dark:ring-white"
                  : ""
              }`}
              style={{ backgroundColor: preset.hex }}
            >
              {isSelected && (
                <Check className="w-4 h-4 text-white drop-shadow-sm" />
              )}
            </button>
          );
        })}

        {/* Custom hex color input */}
        <div className="relative flex items-center gap-1.5 ml-1">
          <input
            type="color"
            value={normalizedColor}
            onChange={(e) => onChange(e.target.value)}
            className="w-7 h-7 rounded-full border-0 cursor-pointer p-0 bg-transparent"
            title="Custom Hex Color"
          />
          <span className="text-xs font-mono text-zinc-500 dark:text-zinc-400 uppercase">
            {normalizedColor}
          </span>
        </div>
      </div>
    </div>
  );
}
