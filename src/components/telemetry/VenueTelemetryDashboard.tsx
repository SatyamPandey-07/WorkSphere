"use client";

import React, { useState } from "react";
import { Activity, Bell, BellOff, Volume2, Wifi } from "lucide-react";
import { NoiseMonitor } from "@/components/noise/NoiseMonitor";
import { WifiWidget } from "@/components/telemetry/WifiWidget";

export interface VenueTelemetryDashboardProps {
  venueId?: string;
  venueName?: string;
  rawSpeedMbps?: number;
  pingMs?: number;
  jitterMs?: number;
  thresholdDb?: number;
  initialAlertsEnabled?: boolean;
  onAlertTriggered?: (avgDb: number) => void;
  onAlertsEnabledChange?: (enabled: boolean) => void;
  className?: string;
}

export function VenueTelemetryDashboard({
  venueId,
  venueName = "Workspace Venue",
  rawSpeedMbps = 85,
  pingMs = 15,
  jitterMs = 2,
  thresholdDb = 75,
  initialAlertsEnabled = true,
  onAlertTriggered,
  onAlertsEnabledChange,
  className = "",
}: VenueTelemetryDashboardProps) {
  const [noiseAlertsEnabled, setNoiseAlertsEnabled] = useState(initialAlertsEnabled);

  const handleToggleNoiseAlerts = () => {
    const next = !noiseAlertsEnabled;
    setNoiseAlertsEnabled(next);
    onAlertsEnabledChange?.(next);
  };

  return (
    <div
      data-testid="venue-telemetry-dashboard"
      className={`bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 shadow-sm space-y-6 ${className}`}
    >
      {/* Dashboard Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <span>Venue Telemetry Dashboard</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </span>
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Real-time acoustics, network telemetry, and ambient noise alerts for {venueName}
            </p>
          </div>
        </div>

        {/* Global Noise Alerts Quick Toggle */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleNoiseAlerts}
            data-testid="telemetry-noise-alert-toggle"
            role="switch"
            aria-checked={noiseAlertsEnabled}
            aria-label={noiseAlertsEnabled ? "Disable ambient noise level alerts" : "Enable ambient noise level alerts"}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all border ${
              noiseAlertsEnabled
                ? "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/80 hover:bg-amber-100 dark:hover:bg-amber-900/60"
                : "bg-zinc-100 dark:bg-zinc-850 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-750 hover:bg-zinc-200 dark:hover:bg-zinc-800"
            }`}
          >
            {noiseAlertsEnabled ? (
              <>
                <Bell className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span>Noise Alerts Active</span>
              </>
            ) : (
              <>
                <BellOff className="w-4 h-4 text-zinc-400" />
                <span>Noise Alerts Muted</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Telemetry Widgets Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <WifiWidget
          rawSpeedMbps={rawSpeedMbps}
          pingMs={pingMs}
          jitterMs={jitterMs}
          venueName={venueName}
        />

        <NoiseMonitor
          thresholdDb={thresholdDb}
          alertsEnabled={noiseAlertsEnabled}
          onAlertsEnabledChange={setNoiseAlertsEnabled}
          onAlertTriggered={onAlertTriggered}
        />
      </div>
    </div>
  );
}
