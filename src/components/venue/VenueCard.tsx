"use client";

import React from "react";
import Image from "next/image";
import { PhotoAttribution } from "./VenueGallery";

export interface VenueCardProps {
  id: string;
  name: string;
  address?: string;
  imageUrl?: string;
  attribution?: PhotoAttribution;
  rating?: number;
  wifiSpeed?: number;
  noiseLevel?: string;
  onClick?: () => void;
}

export function VenueCard({
  name,
  address,
  imageUrl,
  attribution,
  rating,
  wifiSpeed,
  noiseLevel,
  onClick,
}: VenueCardProps) {
  // Fallback check for photographer string
  const photographerName = attribution?.photographer?.trim() || "Verified Contributor";

  return (
    <div
      onClick={onClick}
      className="group relative flex flex-col overflow-hidden rounded-xl bg-slate-900 border border-slate-800 p-4 shadow-md transition-all hover:border-slate-700 cursor-pointer"
    >
      {/* Venue Photo Container */}
      {imageUrl && (
        <div className="relative h-40 w-full overflow-hidden rounded-lg bg-slate-800">
          <Image
            src={imageUrl}
            alt={name}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
        </div>
      )}

      {/* Venue Details */}
      <div className="mt-3 flex flex-col gap-1">
        <h3 className="font-semibold text-lg text-slate-100 group-hover:text-indigo-400 transition-colors">
          {name}
        </h3>
        {address && <p className="text-xs text-slate-400">{address}</p>}

        <div className="mt-2 flex items-center gap-3 text-xs text-slate-300">
          {rating !== undefined && <span>⭐ {rating.toFixed(1)}</span>}
          {wifiSpeed !== undefined && <span>⚡ {wifiSpeed} Mbps</span>}
          {noiseLevel && <span className="capitalize">🔊 {noiseLevel}</span>}
        </div>

        {/* Photo Attribution with secure link & fallback safeguard */}
        {attribution && (
          <div className="mt-2 text-[11px] text-slate-500">
            Photo by{" "}
            {attribution.photographerUrl ? (
              <a
                href={attribution.photographerUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="underline hover:text-slate-300"
              >
                {photographerName}
              </a>
            ) : (
              <span>{photographerName}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}