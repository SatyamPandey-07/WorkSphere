"use client";

import React, { useState } from "react";
import { Wifi, QrCode, Copy, Check, Zap, ShieldCheck } from "lucide-react";
import { VenueWifiConnectModal } from "./VenueWifiConnectModal";

interface VenueWifiCardProps {
  venue: {
    id: string;
    name: string;
    wifiQuality?: number | null;
    wifiSpeed?: number | null;
  };
}

export function VenueWifiCard({ venue }: VenueWifiCardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Fallback default guest password for fast 1-click clipboard copy
  const sanitizedName = venue.name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 18);
  const guestPass = `${sanitizedName.toLowerCase()}work2026`;

  const handleQuickCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(guestPass);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <>
      <div className="flex items-center justify-between p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/80 dark:border-zinc-800 hover:border-blue-500/40 transition-all group">
        <div className="flex items-center gap-3.5">
          <div className="p-3 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 group-hover:scale-105 transition-transform shrink-0">
            <Wifi className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-black uppercase tracking-widest text-zinc-900 dark:text-zinc-100">
                High-Speed Wi-Fi
              </h4>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                ⚡ {venue.wifiSpeed || 250} Mbps
              </span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Auto-join via QR or 1-tap copy
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleQuickCopy}
            className="hidden sm:inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-zinc-200 dark:bg-zinc-700/80 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-bold transition-colors"
            title="Copy Wi-Fi password"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Password</span>
              </>
            )}
          </button>

          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md shadow-blue-900/20 active:scale-[0.98] transition-all"
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
