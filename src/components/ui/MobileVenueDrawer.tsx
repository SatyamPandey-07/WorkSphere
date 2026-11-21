"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, useMotionValue, useTransform, animate, PanInfo } from "framer-motion";
import {
  Star,
  Wifi,
  Zap,
  Volume2,
  Navigation,
  MapPin,
  Calendar,
  X,
  ChevronUp,
  Clock,
  ExternalLink,
  ShieldCheck,
  Coffee,
} from "lucide-react";
import type { MapMarker } from "@/types/map";

export type DrawerSnapPoint = "collapsed" | "half" | "expanded";

export interface MobileVenueDrawerProps {
  venue: MapMarker | null;
  isOpen: boolean;
  onClose: () => void;
  onBook?: (venue: MapMarker) => void;
  onGetDirections?: (venue: MapMarker) => void;
  initialSnap?: DrawerSnapPoint;
  className?: string;
}

// Snap percentages relative to viewport height
export const SNAP_PERCENTAGES = {
  collapsed: 0.15, // 15%: Peek title & rating
  half: 0.5,       // 50%: Amenities & noise meter
  expanded: 0.9,   // 90%: Full detail & booking
} as const;

export function MobileVenueDrawer({
  venue,
  isOpen,
  onClose,
  onBook,
  onGetDirections,
  initialSnap = "collapsed",
  className = "",
}: MobileVenueDrawerProps) {
  const [activeSnap, setActiveSnap] = useState<DrawerSnapPoint>(initialSnap);
  const [bookingConfirmed, setBookingConfirmed] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingDate, setBookingDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });
  const [bookingTime, setBookingTime] = useState("09:00");
  const [windowHeight, setWindowHeight] = useState<number>(() => {
    if (typeof window !== "undefined") {
      return window.innerHeight;
    }
    return 800;
  });

  const sheetY = useMotionValue(0);

  // Measure window height dynamically
  useEffect(() => {
    const updateHeight = () => {
      setWindowHeight(window.innerHeight);
    };
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, []);

  // Compute pixel positions for snap points (from top of viewport)
  // sheet height = windowHeight, so y = windowHeight * (1 - snapPercentage)
  const snapYPositions = useMemo(() => {
    return {
      collapsed: windowHeight * (1 - SNAP_PERCENTAGES.collapsed),
      half: windowHeight * (1 - SNAP_PERCENTAGES.half),
      expanded: windowHeight * (1 - SNAP_PERCENTAGES.expanded),
      dismissed: windowHeight,
    };
  }, [windowHeight]);

  // When venue changes or drawer opens, reset to initial snap
  useEffect(() => {
    if (isOpen && venue) {
      setBookingConfirmed(false);
      setBookingLoading(false);
      const targetSnap = initialSnap;
      setActiveSnap(targetSnap);
      const targetY = snapYPositions[targetSnap];
      sheetY.set(targetY);
    } else {
      sheetY.set(windowHeight);
    }
  }, [isOpen, venue, initialSnap, snapYPositions, sheetY, windowHeight]);

  const snapTo = (snap: DrawerSnapPoint) => {
    setActiveSnap(snap);
    const targetY = snapYPositions[snap];
    animate(sheetY, targetY, {
      type: "spring",
      stiffness: 400,
      damping: 35,
    });
  };

  const handleDragEnd = (
    _e: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo
  ) => {
    const currentY = sheetY.get();
    const velocityY = info.velocity.y;

    // Fast flick down or pulled below collapsed -> dismiss
    if (velocityY > 800 || currentY > snapYPositions.collapsed + 60) {
      animate(sheetY, snapYPositions.dismissed, {
        type: "spring",
        stiffness: 400,
        damping: 35,
        onComplete: onClose,
      });
      return;
    }

    // Fast flick up
    if (velocityY < -800) {
      if (activeSnap === "collapsed") {
        snapTo("half");
      } else {
        snapTo("expanded");
      }
      return;
    }

    // Find nearest snap point by distance
    const snaps: Array<{ snap: DrawerSnapPoint; y: number; dist: number }> = [
      {
        snap: "collapsed",
        y: snapYPositions.collapsed,
        dist: Math.abs(currentY - snapYPositions.collapsed),
      },
      {
        snap: "half",
        y: snapYPositions.half,
        dist: Math.abs(currentY - snapYPositions.half),
      },
      {
        snap: "expanded",
        y: snapYPositions.expanded,
        dist: Math.abs(currentY - snapYPositions.expanded),
      },
    ];

    snaps.sort((a, b) => a.dist - b.dist);
    const closest = snaps[0];
    snapTo(closest.snap);
  };

  if (!isOpen || !venue) {
    return null;
  }

  const rating = venue.rating ?? venue.score ?? 4.5;
  const noiseLevel = venue.noiseLevel || (venue.amenities?.quiet ? "quiet" : "moderate");
  const noiseColor =
    noiseLevel === "quiet"
      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
      : noiseLevel === "moderate"
        ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
        : "text-rose-400 bg-rose-500/10 border-rose-500/20";

  const handleBookingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setBookingLoading(true);
    setTimeout(() => {
      setBookingLoading(false);
      setBookingConfirmed(true);
      if (onBook) {
        onBook(venue);
      }
    }, 600);
  };

  return (
    <div
      data-testid="mobile-venue-drawer-root"
      className={`fixed inset-0 pointer-events-none z-[1001] ${className}`}
      aria-label={`Details for ${venue.name}`}
    >
      {/* Semi-transparent backdrop only active when expanded or half to let map be clickable when collapsed */}
      {activeSnap !== "collapsed" && (
        <div
          data-testid="mobile-drawer-backdrop"
          onClick={() => snapTo("collapsed")}
          className="absolute inset-0 bg-black/40 backdrop-blur-[2px] pointer-events-auto transition-opacity"
        />
      )}

      {/* Draggable bottom sheet */}
      <motion.div
        data-testid="mobile-venue-drawer"
        data-snap-point={activeSnap}
        role="dialog"
        aria-modal={activeSnap === "expanded"}
        aria-label={venue.name}
        style={{ y: sheetY, height: windowHeight }}
        drag="y"
        dragConstraints={{
          top: snapYPositions.expanded,
          bottom: snapYPositions.collapsed,
        }}
        dragElastic={0.15}
        onDragEnd={handleDragEnd}
        className="absolute left-0 right-0 top-0 bg-zinc-900 border-t border-zinc-700/80 rounded-t-3xl shadow-2xl flex flex-col pointer-events-auto overflow-hidden touch-none select-none text-zinc-100"
      >
        {/* Drag Handle Header */}
        <div
          data-testid="mobile-drawer-handle"
          className="pt-3 pb-2 px-6 flex flex-col items-center cursor-grab active:cursor-grabbing border-b border-zinc-800/60 shrink-0"
          onClick={() => {
            if (activeSnap === "collapsed") snapTo("half");
            else if (activeSnap === "half") snapTo("expanded");
            else snapTo("collapsed");
          }}
        >
          <div className="w-12 h-1.5 bg-zinc-600 rounded-full mb-2" />

          {/* Collapsed Peek Header (15% Snap) */}
          <div className="w-full flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3
                  data-testid="drawer-venue-title"
                  className="font-bold text-base text-white truncate"
                >
                  {venue.name}
                </h3>
                {venue.category && (
                  <span className="text-[10px] uppercase font-semibold tracking-wider px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 shrink-0">
                    {venue.category}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-zinc-400">
                <div
                  data-testid="drawer-venue-rating"
                  className="flex items-center gap-1 text-amber-400 font-semibold"
                >
                  <Star className="w-3.5 h-3.5 fill-amber-400" />
                  <span>{rating.toFixed(1)}</span>
                </div>
                {venue.address && (
                  <span className="truncate text-zinc-400">
                    • {venue.address}
                  </span>
                )}
              </div>
            </div>

            {/* Quick Actions in Peek Header */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                data-testid="drawer-expand-btn"
                aria-label="Expand drawer"
                onClick={(e) => {
                  e.stopPropagation();
                  snapTo(activeSnap === "expanded" ? "collapsed" : "expanded");
                }}
                className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
              >
                <ChevronUp
                  className={`w-4 h-4 transition-transform duration-200 ${
                    activeSnap === "expanded" ? "rotate-180" : ""
                  }`}
                />
              </button>
              <button
                type="button"
                data-testid="drawer-close-btn"
                aria-label="Close drawer"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
                className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable Content Container (for 50% & 90% snaps) */}
        <div
          data-testid="drawer-content-container"
          className="flex-1 overflow-y-auto px-6 py-4 space-y-6 touch-auto"
        >
          {/* Half Snap Content (50%): Amenities & Noise Meter */}
          <section data-testid="drawer-section-amenities" className="space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              Amenities & Environment
            </h4>

            {/* 3-Box Amenities Grid */}
            <div className="grid grid-cols-3 gap-2 text-center">
              {/* WiFi */}
              <div
                data-testid="drawer-metric-wifi"
                className="bg-zinc-800/60 p-3 rounded-xl border border-zinc-700/50 flex flex-col items-center"
              >
                <Wifi className="w-5 h-5 text-blue-400 mb-1" />
                <span className="text-[10px] text-zinc-400 uppercase font-semibold">
                  WiFi
                </span>
                <span className="text-sm font-bold text-white">
                  {venue.amenities?.wifiSpeed
                    ? `${venue.amenities.wifiSpeed} Mbps`
                    : venue.wifiQuality
                      ? `${venue.wifiQuality}/5`
                      : venue.amenities?.wifi !== false
                        ? "Fast"
                        : "None"}
                </span>
              </div>

              {/* Power Outlets */}
              <div
                data-testid="drawer-metric-outlets"
                className="bg-zinc-800/60 p-3 rounded-xl border border-zinc-700/50 flex flex-col items-center"
              >
                <Zap className="w-5 h-5 text-amber-400 mb-1" />
                <span className="text-[10px] text-zinc-400 uppercase font-semibold">
                  Power
                </span>
                <span className="text-sm font-bold text-white">
                  {venue.hasOutlets || venue.amenities?.outlets !== false
                    ? venue.outletDensity || "Available"
                    : "None"}
                </span>
              </div>

              {/* Noise Level */}
              <div
                data-testid="drawer-metric-noise"
                className="bg-zinc-800/60 p-3 rounded-xl border border-zinc-700/50 flex flex-col items-center"
              >
                <Volume2 className="w-5 h-5 text-purple-400 mb-1" />
                <span className="text-[10px] text-zinc-400 uppercase font-semibold">
                  Noise
                </span>
                <span className="text-sm font-bold text-white capitalize">
                  {noiseLevel}
                </span>
              </div>
            </div>

            {/* Live Noise Meter Card */}
            <div
              data-testid="drawer-noise-meter"
              className="p-4 rounded-xl bg-zinc-800/40 border border-zinc-700/40 space-y-2"
            >
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-zinc-400" />
                  <span className="font-semibold text-zinc-200">
                    Acoustic Noise Meter
                  </span>
                </div>
                <span
                  data-testid="drawer-noise-badge"
                  className={`min-w-0 max-w-[45%] truncate px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${noiseColor}`}
                >
                  {noiseLevel} space
                </span>
              </div>
              <div className="w-full bg-zinc-700/50 rounded-full h-2 overflow-hidden">
                <div
                  data-testid="drawer-noise-bar"
                  className={`h-full rounded-full transition-all duration-300 ${
                    noiseLevel === "quiet"
                      ? "w-1/3 bg-emerald-500"
                      : noiseLevel === "moderate"
                        ? "w-2/3 bg-amber-500"
                        : "w-full bg-rose-500"
                  }`}
                />
              </div>
              <p className="text-[11px] text-zinc-400">
                {noiseLevel === "quiet"
                  ? "Optimal for focused deep work, audio calls, and reading."
                  : noiseLevel === "moderate"
                    ? "Normal cafe chatter with background ambient music."
                    : "High energy, busy atmosphere. Noise-cancelling headphones recommended."}
              </p>
            </div>
          </section>

          {/* Expanded Snap Content (90%): Full Detail & Booking Form */}
          <section
            data-testid="drawer-section-booking"
            className="space-y-4 pt-2 border-t border-zinc-800/80"
          >
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                Full Details & Desk Reservation
              </h4>
              {onGetDirections && (
                <button
                  type="button"
                  data-testid="drawer-directions-btn"
                  onClick={() => onGetDirections(venue)}
                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-semibold"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  Directions
                </button>
              )}
            </div>

            {venue.openingHours && (
              <div className="flex items-center gap-2 text-xs text-zinc-300">
                <Clock className="w-4 h-4 text-zinc-400" />
                <span>Hours: {venue.openingHours}</span>
              </div>
            )}

            {/* Booking Desk Form */}
            <div className="p-4 rounded-xl bg-zinc-800/50 border border-zinc-700/50">
              {bookingConfirmed ? (
                <div
                  data-testid="drawer-booking-success"
                  className="text-center py-4 space-y-2"
                >
                  <ShieldCheck className="w-10 h-10 text-emerald-400 mx-auto" />
                  <h5 className="font-bold text-white text-sm">
                    Desk Reserved Successfully!
                  </h5>
                  <p className="text-xs text-zinc-400">
                    A confirmation pass has been added for {venue.name} on{" "}
                    {bookingDate} at {bookingTime}.
                  </p>
                  <button
                    type="button"
                    onClick={() => setBookingConfirmed(false)}
                    className="mt-2 text-xs font-semibold text-blue-400 hover:text-blue-300 underline"
                  >
                    Reserve another time slot
                  </button>
                </div>
              ) : (
                <form
                  data-testid="drawer-booking-form"
                  onSubmit={handleBookingSubmit}
                  className="space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Coffee className="w-4 h-4 text-amber-400" />
                      Instant Desk Booking
                    </span>
                    <span className="text-[11px] text-emerald-400 font-semibold">
                      Free Hold • Instant
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <label
                        htmlFor="booking-date"
                        className="block text-zinc-400 mb-1 text-[11px]"
                      >
                        Date
                      </label>
                      <input
                        id="booking-date"
                        data-testid="drawer-booking-date-input"
                        type="date"
                        value={bookingDate}
                        onChange={(e) => setBookingDate(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white text-xs focus:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                        required
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="booking-time"
                        className="block text-zinc-400 mb-1 text-[11px]"
                      >
                        Time
                      </label>
                      <input
                        id="booking-time"
                        data-testid="drawer-booking-time-input"
                        type="time"
                        value={bookingTime}
                        onChange={(e) => setBookingTime(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white text-xs focus:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                        required
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    data-testid="drawer-submit-booking-btn"
                    disabled={bookingLoading}
                    className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider transition-colors shadow-lg active:scale-[0.98] disabled:opacity-50"
                  >
                    {bookingLoading ? "Reserving..." : "Reserve Workspace"}
                  </button>
                </form>
              )}
            </div>
          </section>
        </div>
      </motion.div>
    </div>
  );
}

export default MobileVenueDrawer;

