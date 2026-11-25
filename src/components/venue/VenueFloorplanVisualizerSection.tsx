"use client";

import React, { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import type { IsometricDeskData } from "@/components/floorplan/IsometricDeskView";
import { Loader2, Armchair, AlertCircle, RefreshCw } from "lucide-react";
import Link from "next/link";

// Dynamic import with SSR disabled for Three.js WebGL canvas compatibility
const IsometricDeskView = dynamic(
  () => import("@/components/floorplan/IsometricDeskView"),
  {
    ssr: false,
    loading: () => (
      <div
        data-testid="isometric-desk-view-loading"
        className="w-full h-80 rounded-2xl bg-zinc-950/80 border border-zinc-800 flex flex-col items-center justify-center gap-3 text-zinc-400"
      >
        <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
        <span className="text-xs font-mono">Loading 3D Desk Visualizer...</span>
      </div>
    ),
  },
);

export interface VenueFloorplanVisualizerSectionProps {
  venueId: string;
  venueName?: string;
  className?: string;
}

export function VenueFloorplanVisualizerSection({
  venueId,
  venueName: _venueName,
  className = "",
}: VenueFloorplanVisualizerSectionProps) {
  const [desks, setDesks] = useState<IsometricDeskData[]>([]);
  const [selectedDeskId, setSelectedDeskId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAvailability = useCallback(async () => {
    if (!venueId) return;
    setIsLoading(true);
    setError(null);

    try {
      // Query the venue reservations availability endpoint
      const today = new Date().toISOString().split("T")[0];
      const params = new URLSearchParams({
        venueId,
        date: today,
        time: "09:00",
        duration: "60",
      });

      const res = await fetch(`/api/reservations/availability?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Failed to load desk availability: HTTP ${res.status}`);
      }

      const data = await res.json();
      if (Array.isArray(data.seats)) {
        const mappedDesks: IsometricDeskData[] = data.seats.map((seat: any) => ({
          id: seat.id,
          label: seat.seatNumber,
          seatNumber: seat.seatNumber,
          x: seat.x ?? 50,
          y: seat.y ?? 50,
          width: seat.width ?? 72,
          height: seat.height ?? 48,
          status: seat.available ? "available" : "occupied",
          available: seat.available,
          type: seat.type,
          amenities: seat.amenities,
        }));
        setDesks(mappedDesks);
      } else {
        setDesks([]);
      }
    } catch (err: any) {
      console.warn("[VenueFloorplanVisualizerSection] Availability fetch failed:", err);
      setError(err?.message || "Failed to load desk availability");
    } finally {
      setIsLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    void fetchAvailability();
  }, [fetchAvailability]);

  const selectedDesk = desks.find((d) => d.id === selectedDeskId);

  return (
    <div
      data-testid="venue-floorplan-visualizer-section"
      className={`space-y-3 ${className}`}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">
          <Armchair className="w-3.5 h-3.5 text-indigo-400" />
          <span>Interactive 3D Floorplan & Desk Availability</span>
        </h3>
        <button
          type="button"
          onClick={fetchAvailability}
          disabled={isLoading}
          className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 transition disabled:opacity-50 cursor-pointer"
          title="Refresh real-time desk availability"
        >
          <RefreshCw className={`w-3 h-3 ${isLoading ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Could not retrieve live layout: {error}</span>
        </div>
      )}

      {/* 3D Isometric Visualizer Container */}
      <div className="h-96 w-full rounded-2xl overflow-hidden shadow-inner">
        <IsometricDeskView
          desks={desks}
          selectedDeskId={selectedDeskId}
          onDeskSelect={setSelectedDeskId}
          floorplanDimensions={{ width: 800, height: 480 }}
          className="w-full h-full"
        />
      </div>

      {/* Action / Selection helper */}
      {selectedDesk && (
        <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-100 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-800 text-xs animate-in fade-in">
          <div>
            <span className="font-bold text-zinc-900 dark:text-zinc-100">
              Desk {selectedDesk.label ?? selectedDesk.seatNumber}
            </span>
            <span className="text-zinc-400 ml-2">
              Status:{" "}
              <span
                className={`font-semibold ${
                  selectedDesk.status === "available"
                    ? "text-emerald-500"
                    : selectedDesk.status === "reserved"
                      ? "text-amber-500"
                      : "text-rose-500"
                }`}
              >
                {selectedDesk.status}
              </span>
            </span>
          </div>
          <Link
            href={`/reserve/${venueId}`}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs transition"
          >
            Reserve Seat
          </Link>
        </div>
      )}
    </div>
  );
}

export default VenueFloorplanVisualizerSection;
