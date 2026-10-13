"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  X,
  Radio,
  Activity,
  Signal,
  MapPin,
  RefreshCw,
  Search,
  Sliders,
  ShieldCheck,
  Zap,
  Info,
  ChevronRight,
  Compass,
} from "lucide-react";
import { BeaconSignalBars } from "./BeaconSignalBars";
import {
  rssiToSignalBars,
  getSignalTier,
  getSignalQualityLabel,
  getSignalBarColors,
  calculateRssiDistance,
} from "@/lib/spatial/signalStrength";
import type { BeaconReading } from "@/lib/spatial/indoorPdrEngine";

export interface VenueBeaconDiagnosticDrawerProps {
  /**
   * Controls drawer open/closed state.
   */
  isOpen: boolean;

  /**
   * Callback fired when drawer requests closing.
   */
  onClose: () => void;

  /**
   * Display name of the venue.
   */
  venueName?: string;

  /**
   * Venue identifier for topology queries.
   */
  venueId?: string;

  /**
   * Discovered BLE beacons and their latest telemetry.
   */
  beacons?: BeaconReading[];

  /**
   * Callback to simulate or trigger fresh beacon RSSI packet pings.
   */
  onPingBeacons?: () => void;

  /**
   * Optional extra container CSS classes.
   */
  className?: string;
}

export function VenueBeaconDiagnosticDrawer({
  isOpen,
  onClose,
  venueName = "Current Venue",
  venueId,
  beacons = [],
  onPingBeacons,
  className = "",
}: VenueBeaconDiagnosticDrawerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isSimulatingPing, setIsSimulatingPing] = useState(false);
  const [localBeacons, setLocalBeacons] = useState<BeaconReading[]>(beacons);

  // Sync external beacons into local state
  useEffect(() => {
    setLocalBeacons(beacons);
  }, [beacons]);

  // Handle ESC key press to close drawer
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Simulated beacon packet ping with realistic multi-path fluctuation
  const handlePing = useCallback(() => {
    setIsSimulatingPing(true);

    if (onPingBeacons) {
      onPingBeacons();
    } else {
      // Local jitter simulation if external handler not provided
      setLocalBeacons((prev) =>
        prev.map((b) => {
          const jitter = (Math.random() - 0.5) * 8.0;
          const nextRssi = Math.round(
            Math.max(-98, Math.min(-50, (b.rssi ?? -70) + jitter))
          );
          return { ...b, rssi: nextRssi };
        })
      );
    }

    setTimeout(() => {
      setIsSimulatingPing(false);
    }, 400);
  }, [onPingBeacons]);

  // Filtered beacon list
  const filteredBeacons = useMemo(() => {
    if (!searchQuery.trim()) return localBeacons;
    const query = searchQuery.toLowerCase();
    return localBeacons.filter((b) => b.id.toLowerCase().includes(query));
  }, [localBeacons, searchQuery]);

  // Telemetry summaries
  const telemetry = useMemo(() => {
    if (localBeacons.length === 0) {
      return {
        count: 0,
        strongest: null,
        averageRssi: null,
        averageBars: 0,
      };
    }

    let maxRssi = -Infinity;
    let strongestBeacon: BeaconReading | null = null;
    let sumRssi = 0;

    for (const b of localBeacons) {
      const val = b.rssi ?? -100;
      sumRssi += val;
      if (val > maxRssi) {
        maxRssi = val;
        strongestBeacon = b;
      }
    }

    const avg = Math.round(sumRssi / localBeacons.length);
    return {
      count: localBeacons.length,
      strongest: strongestBeacon,
      averageRssi: avg,
      averageBars: rssiToSignalBars(avg),
    };
  }, [localBeacons]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="beacon-diagnostic-title"
      className="fixed inset-0 z-50 overflow-hidden select-none"
      data-testid="venue-beacon-diagnostic-drawer"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-300"
        onClick={onClose}
        data-testid="beacon-drawer-backdrop"
      />

      {/* Drawer Panel */}
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div
          className={`w-screen max-w-md bg-zinc-950 border-l border-zinc-800 text-zinc-100 shadow-2xl flex flex-col h-full transform transition-all duration-300 ease-in-out ${className}`}
        >
          {/* Header */}
          <div className="p-5 border-b border-zinc-800 flex items-start justify-between gap-4 bg-zinc-900/60 backdrop-blur-md">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <Radio className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2
                    id="beacon-diagnostic-title"
                    className="text-base font-bold text-white tracking-tight"
                  >
                    BLE Proximity Diagnostics
                  </h2>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                    Live
                  </span>
                </div>
                <p className="text-xs text-zinc-400 line-clamp-1">
                  {venueName} • 5-Bar Signal Visualizer
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close diagnostic drawer"
              data-testid="close-beacon-diagnostic-drawer"
              className="p-2 text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-800 border border-zinc-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Quick Telemetry Summary Cards */}
          <div className="p-5 border-b border-zinc-800/80 bg-zinc-900/30 grid grid-cols-3 gap-2.5">
            {/* Discovered count */}
            <div className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800 text-center">
              <div className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                Beacons
              </div>
              <div
                className="text-base font-black text-white font-mono mt-0.5"
                data-testid="telemetry-beacon-count"
              >
                {telemetry.count}
              </div>
            </div>

            {/* Strongest Beacon */}
            <div className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800 text-center">
              <div className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                Max RSSI
              </div>
              <div
                className="text-base font-black text-emerald-400 font-mono mt-0.5 flex items-center justify-center gap-1"
                data-testid="telemetry-max-rssi"
              >
                <span>{telemetry.strongest?.rssi ?? "—"}</span>
                <span className="text-[10px] text-zinc-500 font-normal">dBm</span>
              </div>
            </div>

            {/* Average Bars */}
            <div className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800 text-center flex flex-col items-center justify-center">
              <div className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                Avg Signal
              </div>
              <div className="mt-1">
                <BeaconSignalBars
                  rssi={telemetry.averageRssi}
                  size="sm"
                  accessibleLabel={`Average signal strength: ${telemetry.averageBars} of 5 bars`}
                />
              </div>
            </div>
          </div>

          {/* Toolbar: Search & Ping Trigger */}
          <div className="p-4 border-b border-zinc-800/60 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Filter by beacon ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition-colors"
                data-testid="beacon-search-input"
              />
            </div>

            <button
              type="button"
              onClick={handlePing}
              disabled={isSimulatingPing}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                isSimulatingPing
                  ? "bg-purple-600/30 text-purple-300 border-purple-500/40"
                  : "bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border-purple-500/30 active:scale-95"
              }`}
              title="Ping BLE Beacons and update real-time signal bars"
              data-testid="ping-beacons-btn"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isSimulatingPing ? "animate-spin" : ""}`}
              />
              <span>Ping RSSI</span>
            </button>
          </div>

          {/* Beacon List Scrollable Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {filteredBeacons.length === 0 ? (
              <div className="p-8 text-center text-zinc-500 text-xs">
                <Radio className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p>No BLE beacons discovered matching criteria.</p>
              </div>
            ) : (
              filteredBeacons.map((beacon) => {
                const rssi = beacon.rssi ?? -100;
                const bars = rssiToSignalBars(rssi);
                const tier = getSignalTier(rssi);
                const qualityLabel = getSignalQualityLabel(rssi);
                const colors = getSignalBarColors(bars);
                const distance = calculateRssiDistance(
                  rssi,
                  beacon.txPower ?? -59,
                  beacon.pathLossExponent ?? 2.5
                );

                return (
                  <div
                    key={beacon.id}
                    className="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 hover:border-zinc-700/80 transition-all space-y-3"
                    data-testid={`beacon-row-${beacon.id}`}
                  >
                    {/* Top Row: Beacon ID + Cellular 5-Bar Meter */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="p-2 rounded-xl bg-zinc-800/60 text-zinc-300 border border-zinc-700/40">
                          <Signal className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-xs font-bold text-white font-mono truncate">
                            {beacon.id}
                          </h4>
                          <span
                            className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-md border mt-0.5 ${colors.text} ${colors.badgeBg} ${colors.badgeBorder}`}
                          >
                            {qualityLabel}
                          </span>
                        </div>
                      </div>

                      {/* 5-Bar Visualizer Component */}
                      <div className="flex flex-col items-end gap-1">
                        <BeaconSignalBars
                          rssi={rssi}
                          size="md"
                          showLabel={true}
                          labelFormat="rssi"
                        />
                        <span className="text-[10px] font-mono text-zinc-400">
                          {bars} / 5 bars
                        </span>
                      </div>
                    </div>

                    {/* Telemetry Metrics Row */}
                    <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-zinc-800/60">
                      {/* Distance */}
                      <div className="p-2 rounded-lg bg-zinc-950/40 border border-zinc-800/40">
                        <span className="text-zinc-500 text-[10px] block">
                          Estimated Distance
                        </span>
                        <span className="font-mono font-bold text-zinc-200">
                          {distance !== null ? `~${distance} m` : "Unknown"}
                        </span>
                      </div>

                      {/* Coordinates */}
                      <div className="p-2 rounded-lg bg-zinc-950/40 border border-zinc-800/40">
                        <span className="text-zinc-500 text-[10px] block">
                          Floor Location
                        </span>
                        <span className="font-mono font-bold text-zinc-200">
                          ({beacon.x.toFixed(1)}m, {beacon.y.toFixed(1)}m)
                        </span>
                      </div>
                    </div>

                    {/* Parameters Metadata */}
                    <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono px-1">
                      <span>txPower: {beacon.txPower ?? -59} dBm</span>
                      <span>PLE: n={beacon.pathLossExponent ?? 2.5}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer Information */}
          <div className="p-4 border-t border-zinc-800 bg-zinc-900/40 flex items-center justify-between text-xs text-zinc-400">
            <div className="flex items-center gap-1.5 text-[11px]">
              <Info className="w-3.5 h-3.5 text-blue-400" />
              <span>Scale: -50 dBm (5 bars) to -100 dBm (1 bar)</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-bold transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
