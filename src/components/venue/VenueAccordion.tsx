"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Clock, Sparkles, Wifi, Zap, VolumeX, PhoneCall, Armchair, Headphones, Dog } from "lucide-react";
import { cn } from "@/lib/utils";
import { NextOpeningTimeBadge } from "@/components/venue/NextOpeningTimeBadge";

export interface VenueAccordionProps {
  amenities?: string[];
  openingHours?: string | null;
  className?: string;
}

export function VenueAccordion({
  amenities,
  openingHours,
  className,
}: VenueAccordionProps) {
  const list = amenities ?? [];
  const [isAmenitiesOpen, setIsAmenitiesOpen] = useState(true);
  const [isOpeningHoursOpen, setIsOpeningHoursOpen] = useState(false);

  const getAmenityIcon = (amenity: string) => {
    const lower = amenity.toLowerCase();
    if (lower.includes("wifi")) return <Wifi className="w-4 h-4 text-green-500" />;
    if (lower.includes("power") || lower.includes("outlet")) return <Zap className="w-4 h-4 text-amber-500" />;
    if (lower.includes("quiet")) return <VolumeX className="w-4 h-4 text-blue-500" />;
    if (lower.includes("phone")) return <PhoneCall className="w-4 h-4 text-purple-500" />;
    if (lower.includes("ergonomic")) return <Armchair className="w-4 h-4 text-indigo-500" />;
    if (lower.includes("headset") || lower.includes("anc")) return <Headphones className="w-4 h-4 text-pink-500" />;
    if (lower.includes("dog") || lower.includes("pet")) return <Dog className="w-4 h-4 text-amber-600" />;
    return <Sparkles className="w-4 h-4 text-zinc-400" />;
  };

  return (
    <div className={cn("space-y-4 pt-2", className)}>
      {/* Collapsible Amenities Accordion Section */}
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden bg-white dark:bg-zinc-900 shadow-sm transition-all">
        <button
          type="button"
          id="venue-amenities-trigger"
          aria-expanded={isAmenitiesOpen}
          aria-controls="venue-amenities-panel"
          onClick={() => setIsAmenitiesOpen((prev) => !prev)}
          className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-500" />
            <span className="text-xs font-black uppercase tracking-widest text-zinc-700 dark:text-zinc-300">
              Venue Amenities ({list.length})
            </span>
          </div>
          {isAmenitiesOpen ? (
            <ChevronUp className="w-4 h-4 text-zinc-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-zinc-500" />
          )}
        </button>

        {isAmenitiesOpen && (
          <div
            id="venue-amenities-panel"
            role="region"
            aria-labelledby="venue-amenities-trigger"
            className="px-5 pb-5 pt-1 border-t border-zinc-100 dark:border-zinc-800/60"
          >
            {list.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {list.map((item, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2.5 p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-100 dark:border-zinc-800/80 text-sm font-medium text-zinc-800 dark:text-zinc-200"
                  >
                    {getAmenityIcon(item)}
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400 italic">
                No specific amenity details listed for this venue.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Collapsible Opening Hours Accordion Section */}
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden bg-white dark:bg-zinc-900 shadow-sm transition-all">
        <button
          type="button"
          id="venue-opening-hours-trigger"
          aria-expanded={isOpeningHoursOpen}
          aria-controls="venue-opening-hours-panel"
          onClick={() => setIsOpeningHoursOpen((prev) => !prev)}
          className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" />
              <span className="text-xs font-black uppercase tracking-widest text-zinc-700 dark:text-zinc-300">
                Opening Hours
              </span>
            </div>
            {openingHours && <NextOpeningTimeBadge hours={openingHours} />}
          </div>
          {isOpeningHoursOpen ? (
            <ChevronUp className="w-4 h-4 text-zinc-500 shrink-0 ml-2" />
          ) : (
            <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0 ml-2" />
          )}
        </button>

        {isOpeningHoursOpen && (
          <div
            id="venue-opening-hours-panel"
            role="region"
            aria-labelledby="venue-opening-hours-trigger"
            className="px-5 pb-5 pt-1 border-t border-zinc-100 dark:border-zinc-800/60"
          >
            {openingHours ? (
              <div className="space-y-2.5">
                <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-100 dark:border-zinc-800/80 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  <p className="whitespace-pre-line">{openingHours}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400 italic">
                Opening hours not specified for this venue.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
