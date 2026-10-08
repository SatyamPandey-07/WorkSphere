"use client";

import React, { useState } from "react";
import { Star, Bell, BellRing, Check, Sparkles } from "lucide-react";
import { DeskFavorite } from "@/lib/venues/deskFavoritesService";

interface DeskFavoriteAlertButtonProps {
  venueId: string;
  venueName?: string;
  deskId: string;
  deskLabel: string;
  deskType?: "standard" | "standing" | "booth" | "quiet";
  price?: number;
  tags?: string[];
  isOccupied?: boolean;
  onUpdate?: () => void;
  variant?: "compact" | "full";
}

export function DeskFavoriteAlertButton({
  venueId,
  venueName,
  deskId,
  deskLabel,
  deskType,
  price,
  tags,
  isOccupied = false,
  onUpdate,
  variant = "compact",
}: DeskFavoriteAlertButtonProps) {
  const [isFavorited, setIsFavorited] = useState(false);
  const [isAlertActive, setIsAlertActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const handleToggleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (loading) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/venues/${venueId}/desks/favorites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venueId,
          venueName,
          deskId,
          deskLabel,
          deskType,
          price,
          tags,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setIsFavorited(data.isFavorited);
        showToast(data.message);
        onUpdate?.();
      }
    } catch (err) {
      console.error("Failed to toggle desk favorite:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAlert = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (loading) return;
    try {
      setLoading(true);
      const nextActive = !isAlertActive;
      const res = await fetch(`/api/venues/${venueId}/desks/favorites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "alert",
          venueId,
          venueName,
          deskId,
          deskLabel,
          deskType,
          price,
          tags,
          active: nextActive,
          alertMethods: ["in_app", "push"],
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setIsAlertActive(nextActive);
        if (nextActive) setIsFavorited(true);
        showToast(data.message);
        onUpdate?.();
      }
    } catch (err) {
      console.error("Failed to toggle vacancy alert:", err);
    } finally {
      setLoading(false);
    }
  };

  if (variant === "compact") {
    return (
      <div className="relative inline-flex items-center gap-1">
        <button
          type="button"
          onClick={handleToggleFavorite}
          disabled={loading}
          className={`p-1.5 rounded-lg transition-all ${
            isFavorited
              ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
              : "bg-zinc-800/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
          }`}
          title={isFavorited ? "Remove from favorite desks" : "Star as favorite desk"}
        >
          <Star className={`w-3.5 h-3.5 ${isFavorited ? "fill-amber-400 text-amber-400" : ""}`} />
        </button>

        {isOccupied && (
          <button
            type="button"
            onClick={handleToggleAlert}
            disabled={loading}
            className={`p-1.5 rounded-lg transition-all ${
              isAlertActive
                ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 ring-1 ring-blue-500/40 animate-pulse"
                : "bg-zinc-800/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
            }`}
            title={isAlertActive ? "Vacancy alert active" : "Notify me when this desk is free"}
          >
            {isAlertActive ? (
              <BellRing className="w-3.5 h-3.5 text-blue-400" />
            ) : (
              <Bell className="w-3.5 h-3.5" />
            )}
          </button>
        )}

        {toastMsg && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1 rounded-lg bg-zinc-900 text-zinc-100 text-[10px] font-semibold whitespace-nowrap shadow-xl border border-zinc-700 z-50 animate-in fade-in zoom-in-95">
            {toastMsg}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleToggleFavorite}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
          isFavorited
            ? "bg-amber-500/10 text-amber-400 border-amber-500/30 shadow-xs"
            : "bg-zinc-800/60 text-zinc-300 border-zinc-700/60 hover:bg-zinc-800"
        }`}
      >
        <Star className={`w-3.5 h-3.5 ${isFavorited ? "fill-amber-400 text-amber-400" : ""}`} />
        <span>{isFavorited ? "Favorited" : "Favorite Desk"}</span>
      </button>

      {isOccupied && (
        <button
          type="button"
          onClick={handleToggleAlert}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
            isAlertActive
              ? "bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-900/40 ring-2 ring-blue-500/30 animate-pulse"
              : "bg-zinc-800/60 text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
          }`}
        >
          {isAlertActive ? (
            <>
              <BellRing className="w-3.5 h-3.5" />
              <span>Alert Active</span>
            </>
          ) : (
            <>
              <Bell className="w-3.5 h-3.5" />
              <span>Notify When Free</span>
            </>
          )}
        </button>
      )}

      {toastMsg && (
        <span className="text-[11px] text-emerald-400 font-semibold animate-in fade-in">
          ✓ {toastMsg}
        </span>
      )}
    </div>
  );
}
