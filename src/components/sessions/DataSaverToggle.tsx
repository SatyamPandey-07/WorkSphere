"use client";

import { useEffect, useState } from "react";
import { Gauge, Sparkles } from "lucide-react";
import {
  getDataSaverState,
  setDataSaverState,
  getEstimatedSavedMB,
  DEFAULT_BASE_SESSION_SAVINGS_MB,
} from "@/lib/dataSaver";

export interface DataSaverToggleProps {
  /** Controlled enabled state */
  enabled?: boolean;
  /** Callback fired when toggle changes */
  onChange?: (enabled: boolean) => void;
  /** Override for estimated MB saved */
  estimatedSavedMB?: number;
  /** Optional container CSS class */
  className?: string;
}

export function DataSaverToggle({
  enabled: controlledEnabled,
  onChange,
  estimatedSavedMB: customSavedMB,
  className = "",
}: DataSaverToggleProps) {
  const [internalEnabled, setInternalEnabled] = useState<boolean>(() =>
    getDataSaverState(),
  );
  const [sessionSavingsMB, setSessionSavingsMB] = useState<number>(() =>
    getEstimatedSavedMB(),
  );

  const isControlled = typeof controlledEnabled === "boolean";
  const isEnabled = isControlled ? controlledEnabled : internalEnabled;

  useEffect(() => {
    // If controlled, persist to localStorage when controlledEnabled changes
    if (isControlled && controlledEnabled !== undefined) {
      setDataSaverState(controlledEnabled);
    }
  }, [isControlled, controlledEnabled]);

  useEffect(() => {
    // Update savings counter from storage or custom prop
    if (typeof customSavedMB === "number") {
      setSessionSavingsMB(customSavedMB);
    } else {
      setSessionSavingsMB(getEstimatedSavedMB());
    }
  }, [customSavedMB, isEnabled]);

  const handleToggle = () => {
    const nextState = !isEnabled;
    if (!isControlled) {
      setInternalEnabled(nextState);
    }
    setDataSaverState(nextState);
    onChange?.(nextState);
  };

  const displaySavings =
    typeof customSavedMB === "number"
      ? customSavedMB.toFixed(1)
      : (sessionSavingsMB || DEFAULT_BASE_SESSION_SAVINGS_MB).toFixed(1);

  return (
    <div
      className={`flex flex-col sm:flex-row items-start sm:items-center gap-2.5 ${className}`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={isEnabled}
        aria-label="Data Saver Mode"
        onClick={handleToggle}
        className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${
          isEnabled
            ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/20"
            : "border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10"
        }`}
      >
        <Gauge className="h-4 w-4" />
        <span>Data Saver Mode</span>
        <span className="text-xs text-zinc-400">
          {isEnabled ? "On" : "Off"}
        </span>
      </button>

      {isEnabled && (
        <span
          data-testid="data-saver-savings-chip"
          className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-950/40 px-3 py-1 text-xs font-medium text-cyan-300 backdrop-blur-xs shadow-xs animate-in fade-in duration-200"
        >
          <Sparkles className="h-3 w-3 text-cyan-400" />
          <span>Estimated ~{displaySavings} MB saved this session</span>
        </span>
      )}
    </div>
  );
}

export default DataSaverToggle;
