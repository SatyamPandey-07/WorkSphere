"use client";

import React, { useEffect } from "react";
import { MapPin, Users, Wifi, X, CheckCircle2 } from "lucide-react";
import NoiseVisualizer, { NoiseBand } from "./NoiseVisualizer";

export interface VenueDetails {
  id: string;
  name: string;
  address?: string;
  capacity?: number;
  wifiSpeedMbps?: number;
  description?: string;
  amenities?: string[];
}

interface VenueDetailModalProps {
  venue: VenueDetails | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmitNoiseRating?: (
    venueId: string,
    rating: { db: number; band: NoiseBand; label: string },
  ) => void;
}

export const VenueDetailModal: React.FC<VenueDetailModalProps> = ({
  venue,
  isOpen,
  onClose,
  onSubmitNoiseRating,
}) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !venue) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="venue-detail-modal-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-100 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <h2
              id="venue-detail-modal-title"
              className="text-xl font-bold text-slate-100"
            >
              {venue.name}
            </h2>
            {venue.address && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                <MapPin className="h-3.5 w-3.5 text-cyan-400" />
                <span>{venue.address}</span>
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close venue details"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Venue Metadata */}
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-300">
          {typeof venue.capacity === "number" && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5">
              <Users className="h-3.5 w-3.5 text-indigo-400" />
              <span>{venue.capacity} seats</span>
            </span>
          )}
          {typeof venue.wifiSpeedMbps === "number" && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5">
              <Wifi className="h-3.5 w-3.5 text-emerald-400" />
              <span>{venue.wifiSpeedMbps} Mbps Wi-Fi</span>
            </span>
          )}
        </div>

        {venue.description && (
          <p className="mt-4 text-sm leading-relaxed text-slate-300">
            {venue.description}
          </p>
        )}

        {venue.amenities && venue.amenities.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {venue.amenities.map((amenity) => (
              <span
                key={amenity}
                className="inline-flex items-center gap-1 rounded-full border border-slate-700/80 bg-slate-800/70 px-2.5 py-1 text-xs text-slate-200"
              >
                <CheckCircle2 className="h-3 w-3 text-cyan-400" />
                {amenity}
              </span>
            ))}
          </div>
        )}

        {/* Live Web Audio Ambient Noise Visualizer */}
        <div className="mt-6">
          <NoiseVisualizer
            isActive={isOpen}
            onSampleRating={(rating) => {
              onSubmitNoiseRating?.(venue.id, rating);
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default VenueDetailModal;
