"use client";

import { X, Check } from "lucide-react";

// Assuming these match your venue data structure
interface Venue {
  id: string;
  name: string;
  wifiQuality: number; // e.g., 1-5
  hasOutlets: boolean;
  noiseLevel: "quiet" | "moderate" | "loud";
}

interface ComparisonDrawerProps {
  selectedVenues: Venue[];
  onRemoveVenue: (id: string) => void;
}

export function ComparisonDrawer({
  selectedVenues,
  onRemoveVenue,
}: ComparisonDrawerProps) {
  // Only show drawer if 2 or more venues are selected
  if (selectedVenues.length < 2) return null;

  // --- Helper Functions to determine the "winning" stat ---
  const maxWifi = Math.max(...selectedVenues.map((v) => v.wifiQuality || 0));

  const getNoiseScore = (level: string) => {
    if (level === "quiet") return 3;
    if (level === "moderate") return 2;
    return 1;
  };
  const bestNoiseScore = Math.max(
    ...selectedVenues.map((v) => getNoiseScore(v.noiseLevel)),
  );

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 transform transition-transform duration-300 translate-y-0">
      <div className="max-w-5xl mx-auto bg-white dark:bg-zinc-950 border-t-2 border-l-2 border-r-2 border-zinc-200 dark:border-zinc-800 rounded-t-2xl shadow-[0_-10px_40px_rgba(0,0,0,0.1)] overflow-hidden">
        {/* Header */}
        <div className="bg-zinc-50 dark:bg-zinc-900 p-4 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
          <h3 className="font-black uppercase tracking-widest text-zinc-800 dark:text-zinc-100 text-sm">
            Comparing {selectedVenues.length} / 3 Venues
          </h3>
        </div>

        {/* Comparison Table */}
        <div className="overflow-x-auto p-4">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr>
                <th className="p-3 text-xs font-bold text-zinc-500 uppercase">
                  Feature
                </th>
                {selectedVenues.map((venue) => (
                  <th
                    key={venue.id}
                    className="p-3 font-bold text-zinc-900 dark:text-zinc-100 relative min-w-[150px]"
                  >
                    <div className="flex justify-between items-center">
                      <span className="truncate pr-2">{venue.name}</span>
                      <button
                        onClick={() => onRemoveVenue(venue.id)}
                        className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full transition-colors"
                        title="Remove from comparison"
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
              <tr className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="p-3 text-sm font-semibold text-zinc-600 dark:text-zinc-400">
                  WiFi Quality
                </td>
                {selectedVenues.map((venue) => {
                  const isWinner = venue.wifiQuality === maxWifi;
                  return (
                    <td
                      key={venue.id}
                      className={`p-3 text-sm font-bold ${isWinner ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-lg" : "text-zinc-800 dark:text-zinc-200"}`}
                    >
                      {venue.wifiQuality} / 5
                    </td>
                  );
                })}
              </tr>

              {/* Row: Power Outlets */}
              <tr className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="p-3 text-sm font-semibold text-zinc-600 dark:text-zinc-400">
                  Power Outlets
                </td>
                {selectedVenues.map((venue) => {
                  const isWinner = venue.hasOutlets;
                  return (
                    <td
                      key={venue.id}
                      className={`p-3 text-sm ${isWinner ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-lg font-bold" : "text-zinc-800 dark:text-zinc-200"}`}
                    >
                      {venue.hasOutlets ? <Check className="w-5 h-5" /> : "No"}
                    </td>
                  );
                })}
              </tr>

              {/* Row: Noise Level */}
              <tr className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="p-3 text-sm font-semibold text-zinc-600 dark:text-zinc-400">
                  Noise Level
                </td>
                {selectedVenues.map((venue) => {
                  const isWinner =
                    getNoiseScore(venue.noiseLevel) === bestNoiseScore;
                  return (
                    <td
                      key={venue.id}
                      className={`p-3 text-sm capitalize ${isWinner ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-lg font-bold" : "text-zinc-800 dark:text-zinc-200"}`}
                    >
                      {venue.noiseLevel}
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
