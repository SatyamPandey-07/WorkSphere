"use client";

import { Gauge } from "lucide-react";

type DataSaverToggleProps = {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
};

export function DataSaverToggle({ enabled, onChange }: DataSaverToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="Data Saver Mode"
      onClick={() => onChange(!enabled)}
      className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
        enabled
          ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/20"
          : "border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10"
      }`}
    >
      <Gauge className="h-4 w-4" />
      <span>Data Saver Mode</span>
      <span className="text-xs text-zinc-400">{enabled ? "On" : "Off"}</span>
    </button>
  );
}
