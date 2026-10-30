"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Star,
  Bell,
  BellRing,
  Armchair,
  Clock,
  Sparkles,
  ChevronRight,
  X,
} from "lucide-react";
import { DeskFavorite, DeskAvailabilityStatus } from "@/lib/venues/deskFavoritesService";
import { cn } from "@/lib/utils";

export interface FavoriteItemWithStatus extends DeskFavorite {
  availability?: DeskAvailabilityStatus;
}

export interface FavoriteDesksDrawerProps {
  venueId: string;
  venueName?: string;
  onSelectDesk?: (deskId: string) => void;
  initialFavorites?: FavoriteItemWithStatus[];
  className?: string;
}

export function FavoriteDesksDrawer({
  venueId,
  venueName,
  onSelectDesk,
  initialFavorites,
  className = "",
}: FavoriteDesksDrawerProps) {
  const [favorites, setFavorites] = useState<FavoriteItemWithStatus[]>(
    initialFavorites || []
  );
  const [loading, setLoading] = useState(!initialFavorites);
  const [activeNotification, setActiveNotification] = useState<string | null>(
    null
  );

  const isMountedRef = useRef(true);
  const notificationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (notificationTimeoutRef.current) {
        clearTimeout(notificationTimeoutRef.current);
      }
    };
  }, []);

  const fetchFavorites = useCallback(async () => {
    if (!venueId) return;
    try {
      const res = await fetch(
        `/api/venues/${encodeURIComponent(venueId)}/desks/favorites`
      );
      if (res.ok) {
        const data = await res.json();
        if (isMountedRef.current && data?.success) {
          setFavorites(data.favorites || []);
        }
      }
    } catch {
      // Ignore network fetch errors
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [venueId]);

  useEffect(() => {
    if (!initialFavorites) {
      void fetchFavorites();
    }
  }, [fetchFavorites, initialFavorites]);

  const handleToggleAlert = async (fav: FavoriteItemWithStatus) => {
    if (!venueId || !fav?.deskId) return;
    try {
      const nextActive = !fav.isFreeAlertActive;
      const res = await fetch(
        `/api/venues/${encodeURIComponent(venueId)}/desks/favorites`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "alert",
            venueId,
            deskId: fav.deskId,
            deskLabel: fav.deskLabel,
            deskType: fav.deskType,
            price: fav.price,
            tags: fav.tags,
            active: nextActive,
          }),
        }
      );

      if (res.ok) {
        if (isMountedRef.current) {
          setFavorites((prev) =>
            prev.map((item) =>
              item.deskId === fav.deskId
                ? { ...item, isFreeAlertActive: nextActive }
                : item
            )
          );
        }
        void fetchFavorites();
      }
    } catch {
      // Ignore alert toggle errors
    }
  };

  const simulateDeskFreeAlert = (deskLabel: string) => {
    setActiveNotification(
      `🎉 Ding! Your favorite desk "${deskLabel}" is now FREE! Tap to book before it's taken.`
    );
    if (notificationTimeoutRef.current) {
      clearTimeout(notificationTimeoutRef.current);
    }
    notificationTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        setActiveNotification(null);
      }
    }, 6000);
  };

  if (loading || favorites.length === 0) return null;

  return (
    <div
      data-testid="favorite-desks-drawer"
      className={cn(
        "rounded-3xl p-5 bg-zinc-900/90 border border-zinc-800 text-zinc-100 shadow-xl space-y-4",
        className
      )}
    >
      {/* Live Push / In-App Notification Banner */}
      {activeNotification && (
        <div
          data-testid="favorite-desks-notification-banner"
          className="p-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold text-xs flex items-center justify-between shadow-lg shadow-emerald-950/40 animate-in fade-in slide-in-from-top-2 duration-300"
        >
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-xl bg-white/20">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span data-testid="favorite-desks-notification-text">
              {activeNotification}
            </span>
          </div>
          <button
            type="button"
            aria-label="Dismiss notification"
            data-testid="favorite-desks-notification-dismiss"
            onClick={() => setActiveNotification(null)}
            className="p-1 rounded-lg bg-black/20 hover:bg-black/30 text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
            <Star className="w-4 h-4 fill-amber-400" />
          </div>
          <div>
            <h4
              data-testid="favorite-desks-header-title"
              className="text-sm font-black text-white"
            >
              {venueName
                ? `${venueName} — Saved Desks`
                : "Your Saved Desks & Vacancy Alerts"}
            </h4>
            <p className="text-[11px] text-zinc-400">
              Instant alerts trigger the moment an occupied desk frees up.
            </p>
          </div>
        </div>

        <span
          data-testid="favorite-desks-count-badge"
          className="text-xs px-2.5 py-1 rounded-full bg-zinc-800 text-zinc-300 font-bold"
        >
          {favorites.length} saved
        </span>
      </div>

      {/* Desk List */}
      <div
        className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        data-testid="favorite-desks-grid"
      >
        {favorites.map((fav) => {
          const isFree = fav.availability?.isFree ?? true;
          return (
            <div
              key={fav.id || fav.deskId}
              data-testid={`favorite-desk-card-${fav.deskId}`}
              className={cn(
                "p-3.5 rounded-2xl border transition-all flex flex-col justify-between gap-3",
                isFree
                  ? "bg-emerald-950/20 border-emerald-900/40 hover:border-emerald-700"
                  : "bg-zinc-950/60 border-zinc-800/80 hover:border-zinc-700"
              )}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div
                    className={cn(
                      "p-2 rounded-xl",
                      isFree
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "bg-zinc-800 text-zinc-400"
                    )}
                  >
                    <Armchair className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white flex items-center gap-1.5">
                      <span>Desk {fav.deskLabel}</span>
                      <span className="text-[10px] text-zinc-500 capitalize font-medium">
                        ({fav.deskType})
                      </span>
                    </div>
                    <div className="text-[10px] text-zinc-400 mt-0.5 font-mono">
                      ${fav.price || 15}/hr
                    </div>
                  </div>
                </div>

                {isFree ? (
                  <span
                    data-testid={`favorite-desk-status-${fav.deskId}`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Free Now
                  </span>
                ) : (
                  <span
                    data-testid={`favorite-desk-status-${fav.deskId}`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  >
                    <Clock className="w-3 h-3" />
                    Occupied
                  </span>
                )}
              </div>

              {/* Action row */}
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-800/60">
                <button
                  type="button"
                  aria-label={`Toggle vacancy alert for desk ${fav.deskLabel}`}
                  data-testid={`favorite-desk-toggle-alert-${fav.deskId}`}
                  onClick={() => handleToggleAlert(fav)}
                  className={cn(
                    "flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg transition-colors cursor-pointer",
                    fav.isFreeAlertActive
                      ? "bg-blue-600/20 text-blue-400 border border-blue-500/30"
                      : "text-zinc-400 hover:text-zinc-200 bg-zinc-800/60"
                  )}
                  title="Toggle vacancy alert"
                >
                  {fav.isFreeAlertActive ? (
                    <>
                      <BellRing className="w-3 h-3 text-blue-400 animate-bounce" />
                      Alert On
                    </>
                  ) : (
                    <>
                      <Bell className="w-3 h-3" />
                      Notify When Free
                    </>
                  )}
                </button>

                {isFree ? (
                  <button
                    type="button"
                    aria-label={`Reserve desk ${fav.deskLabel}`}
                    data-testid={`favorite-desk-reserve-${fav.deskId}`}
                    onClick={() => onSelectDesk?.(fav.deskId)}
                    className="flex items-center gap-1 text-[11px] font-bold px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs transition-colors cursor-pointer"
                  >
                    <span>Reserve</span>
                    <ChevronRight className="w-3 h-3" />
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={`Simulate vacancy alert for desk ${fav.deskLabel}`}
                    data-testid={`favorite-desk-test-alert-${fav.deskId}`}
                    onClick={() => simulateDeskFreeAlert(fav.deskLabel)}
                    className="text-[10px] text-zinc-500 hover:text-blue-400 transition-colors cursor-pointer"
                    title="Simulate push notification"
                  >
                    Test Alert
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default FavoriteDesksDrawer;
