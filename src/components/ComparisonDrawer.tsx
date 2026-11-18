"use client";

import React, { useEffect } from "react";
import { X, Check } from "lucide-react";
import { RadarChart } from "./ui/RadarChart";

import type { Venue } from "@/types/venue";

export interface ComparisonDrawerProps {
  selectedVenues: Venue[];
  onRemoveVenue: (id: string) => void;
  onClearAll?: () => void;
  onClose?: () => void;
}

export function ComparisonDrawer({
  selectedVenues,
  onRemoveVenue,
  onClearAll,
  onClose,
}: ComparisonDrawerProps) {
  const venues = Array.isArray(selectedVenues) ? selectedVenues : [];

  useEffect(() => {
    if (venues.length < 2) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (onClose) {
          onClose();
        } else if (onClearAll) {
          onClearAll();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [venues.length, onClose, onClearAll]);

  // Only show drawer if 2 or more venues are selected
  if (venues.length < 2) return null;

  // --- Helper Functions to determine the "winning" stat ---
  const validWifiQualities = venues.map((v) =>
    typeof v.wifiQuality === "number" && Number.isFinite(v.wifiQuality)
      ? v.wifiQuality
      : 0,
  );
  const maxWifi =
    validWifiQualities.length > 0 ? Math.max(...validWifiQualities) : 0;

  const getNoiseScore = (level?: string | null) => {
    if (level === "quiet") return 3;
    if (level === "moderate") return 2;
    return 1;
  };
  const bestNoiseScore = Math.max(
    ...venues.map((v) => getNoiseScore(v.noiseLevel)),
  );

  return (
    <div
      role="region"
      aria-label="Venue Comparison Drawer"
      data-testid="comparison-drawer"
      className="fixed bottom-0 left-0 right-0 z-50 p-4 transform transition-transform duration-300 translate-y-0"
    >
      <div className="max-w-5xl mx-auto bg-white dark:bg-zinc-950 border-t-2 border-l-2 border-r-2 border-zinc-200 dark:border-zinc-800 rounded-t-2xl shadow-[0_-10px_40px_rgba(0,0,0,0.1)] overflow-hidden">
        {/* Header */}
        <div className="bg-zinc-50 dark:bg-zinc-900 p-4 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
          <h3
            data-testid="comparison-drawer-title"
            className="font-black uppercase tracking-widest text-zinc-800 dark:text-zinc-100 text-sm"
          >
            Comparing {venues.length} / 3 Venues
          </h3>
          {(onClearAll || onClose) && (
            <button
              type="button"
              onClick={onClose || onClearAll}
              data-testid="comparison-clear-all-btn"
              aria-label="Close comparison drawer"
              className="px-3 py-1 text-xs font-semibold rounded-lg bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer"
            >
              Clear Comparison
            </button>
          )}
        </div>

        {/* Comparison Radar Chart */}
        <div
          data-testid="comparison-radar-chart-section"
          className="flex flex-col md:flex-row items-center justify-center gap-8 p-4 border-b border-zinc-200 dark:border-zinc-800"
        >
          <RadarChart
            data={venues.map((venue, i) => {
              const noiseScore =
                venue.noiseLevel === "quiet"
                  ? 100
                  : venue.noiseLevel === "moderate"
                    ? 60
                    : 20;
              const charCode0 =
                typeof venue.id === "string" && venue.id.length > 0
                  ? venue.id.charCodeAt(0)
                  : 65;
              const charCodeLast =
                typeof venue.id === "string" && venue.id.length > 0
                  ? venue.id.charCodeAt(venue.id.length - 1)
                  : 65;

              const seatingScore = venue.seating
                ? venue.seating * 20
                : 60 + (charCode0 % 40);
              const coffeeScore = venue.coffee
                ? venue.coffee * 20
                : 50 + (charCodeLast % 50);
              const colors = ["#3b82f6", "#10b981", "#f59e0b"];

              const wifiVal =
                typeof venue.wifiQuality === "number" &&
                Number.isFinite(venue.wifiQuality)
                  ? venue.wifiQuality * 20
                  : 0;

              return {
                name: venue.name || `Venue ${i + 1}`,
                color: colors[i % colors.length],
                values: [
                  wifiVal,
                  noiseScore,
                  venue.hasOutlets ? 100 : 20,
                  seatingScore,
                  coffeeScore,
                ],
              };
            })}
            labels={["WiFi", "Quietness", "Outlets", "Seating", "Coffee"]}
            size={250}
          />
          <div className="flex flex-col gap-3">
            {venues.map((venue, i) => {
              const colors = ["#3b82f6", "#10b981", "#f59e0b"];
              return (
                <div key={venue.id} className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: colors[i % colors.length] }}
                  />
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {venue.name}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Comparison Table */}
        <div className="overflow-x-auto p-4">
          <table
            data-testid="comparison-table"
            className="w-full text-left border-collapse"
          >
            <thead>
              <tr>
                <th className="p-3 text-xs font-bold text-zinc-500 uppercase">
                  Feature
                </th>
                {venues.map((venue) => (
                  <th
                    key={venue.id}
                    className="p-3 font-bold text-zinc-900 dark:text-zinc-100 relative min-w-[150px]"
                  >
                    <div className="flex justify-between items-center">
                      <span className="truncate pr-2">{venue.name}</span>
                      <button
                        type="button"
                        onClick={() => onRemoveVenue(venue.id)}
                        data-testid={`remove-venue-${venue.id}-btn`}
                        className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full transition-colors cursor-pointer"
                        aria-label={`Remove ${venue.name} from comparison`}
                        title={`Remove ${venue.name} from comparison`}
                      >
                        <X className="w-4 h-4 text-zinc-400" />
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Row: WiFi Quality */}
              <tr
                data-testid="comparison-row-wifi"
                className="border-t border-zinc-100 dark:border-zinc-800"
              >
                <td className="p-3 text-sm font-semibold text-zinc-600 dark:text-zinc-400">
                  WiFi Quality
                </td>
                {venues.map((venue) => {
                  const isWinner =
                    maxWifi > 0 && venue.wifiQuality === maxWifi;
                  return (
                    <td
                      key={venue.id}
                      data-testid={`comparison-cell-wifi-${venue.id}`}
                      className={`p-3 text-sm font-bold ${
                        isWinner
                          ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-lg"
                          : "text-zinc-800 dark:text-zinc-200"
                      }`}
                    >
                      {venue.wifiQuality != null
                        ? `${venue.wifiQuality} / 5`
                        : "N/A"}
                    </td>
                  );
                })}
              </tr>

              {/* Row: Power Outlets */}
              <tr
                data-testid="comparison-row-outlets"
                className="border-t border-zinc-100 dark:border-zinc-800"
              >
                <td className="p-3 text-sm font-semibold text-zinc-600 dark:text-zinc-400">
                  Power Outlets
                </td>
                {venues.map((venue) => {
                  const isWinner = Boolean(venue.hasOutlets);
                  return (
                    <td
                      key={venue.id}
                      data-testid={`comparison-cell-outlets-${venue.id}`}
                      className={`p-3 text-sm ${
                        isWinner
                          ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-lg font-bold"
                          : "text-zinc-800 dark:text-zinc-200"
                      }`}
                    >
                      {venue.hasOutlets ? (
                        <Check
                          data-testid={`outlets-check-${venue.id}`}
                          className="w-5 h-5 text-green-600 dark:text-green-400"
                        />
                      ) : (
                        "No"
                      )}
                    </td>
                  );
                })}
              </tr>

              {/* Row: Noise Level */}
              <tr
                data-testid="comparison-row-noise"
                className="border-t border-zinc-100 dark:border-zinc-800"
              >
                <td className="p-3 text-sm font-semibold text-zinc-600 dark:text-zinc-400">
                  Noise Level
                </td>
                {venues.map((venue) => {
                  const isWinner =
                    getNoiseScore(venue.noiseLevel) === bestNoiseScore;
                  return (
                    <td
                      key={venue.id}
                      data-testid={`comparison-cell-noise-${venue.id}`}
                      className={`p-3 text-sm capitalize ${
                        isWinner
                          ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-lg font-bold"
                          : "text-zinc-800 dark:text-zinc-200"
                      }`}
                    >
                      {venue.noiseLevel || "N/A"}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default ComparisonDrawer;
