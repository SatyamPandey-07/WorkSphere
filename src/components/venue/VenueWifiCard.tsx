"use client";

import React, { useState } from "react";
import { Wifi, QrCode } from "lucide-react";
import { VenueWifiConnectModal } from "./VenueWifiConnectModal";

export interface VenueWifiCardProps {
  venue: {
    id: string;
    name: string;
    wifiQuality?: number | null;
    wifiSpeed?: number | null;
  } | null | undefined;
  /** Optional custom CSS classes */
  className?: string;
  /** Optional test identifier */
  testId?: string;
  /** Optional callback fired when the Connect QR button is clicked */
  onConnectClick?: () => void;
}

export function VenueWifiCard({
  venue,
  className = "",
  testId = "venue-wifi-card",
  onConnectClick,
}: VenueWifiCardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  if (!venue) return null;

  const handleOpenModal = () => {
    setIsModalOpen(true);
    onConnectClick?.();
  };

  const speed =
    typeof venue.wifiSpeed === "number" && !isNaN(venue.wifiSpeed) && venue.wifiSpeed > 0
      ? venue.wifiSpeed
      : 250;

  const getQualityLabel = (quality: number | null | undefined) => {
    if (typeof quality !== "number" || isNaN(quality)) return null;
    if (quality >= 4.5) return "Excellent";
    if (quality >= 3.5) return "Good";
    if (quality >= 2.5) return "Fair";
    return "Basic";
  };

  const qualityLabel = getQualityLabel(venue.wifiQuality);

  return (
    <>
      <div
        role="region"
        aria-label={`Wi-Fi details for ${venue.name}`}
        data-testid={testId}
        className={`flex items-center justify-between p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/80 dark:border-zinc-800 hover:border-blue-500/40 transition-all group ${className}`.trim()}
      >
        <div className="flex items-center gap-3.5">
          <div
            className="p-3 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 group-hover:scale-105 transition-transform shrink-0"
            data-testid="wifi-icon-container"
          >
            <Wifi className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center flex-wrap gap-2">
              <h4
                className="text-xs font-black uppercase tracking-widest text-zinc-900 dark:text-zinc-100"
                data-testid="wifi-title"
              >
                High-Speed Wi-Fi
              </h4>
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                data-testid="wifi-speed-badge"
              >
                ⚡ {speed} Mbps
              </span>
              {qualityLabel && (
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                  data-testid="wifi-quality-badge"
                >
                  {qualityLabel} Quality
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Auto-join via QR or 1-tap copy
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleOpenModal}
            aria-label={`Connect to ${venue.name} Wi-Fi via QR code`}
            aria-haspopup="dialog"
            aria-expanded={isModalOpen}
            data-testid="wifi-connect-btn"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md shadow-blue-900/20 active:scale-[0.98] transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Connect QR</span>
          </button>
        </div>
      </div>

      <VenueWifiConnectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        venueId={venue.id}
        venueName={venue.name}
      />
    </>
  );
}

export default VenueWifiCard;
