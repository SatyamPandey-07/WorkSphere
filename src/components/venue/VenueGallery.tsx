"use client";

import React, { useState } from "react";
import Image from "next/image";

export interface PhotoAttribution {
  photographer?: string;
  photographerUrl?: string;
  photoUrl?: string;
}

export interface VenueGalleryProps {
  photos: string[];
  alt?: string;
  attribution?: PhotoAttribution;
  className?: string;
}

export function VenueGallery({
  photos = [],
  alt = "Venue photo",
  attribution,
  className = "",
}: VenueGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  if (!photos || photos.length === 0) {
    return (
      <div className={`relative w-full h-48 bg-slate-800 rounded-lg flex items-center justify-center text-slate-400 ${className}`}>
        No photos available
      </div>
    );
  }

  // Fallback to "Verified Contributor" if photographer is undefined or empty
  const photographerName = attribution?.photographer?.trim() || "Verified Contributor";

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* Main Display Image */}
      <div className="relative w-full h-64 overflow-hidden rounded-lg bg-slate-900">
        <Image
          src={photos[selectedIndex]}
          alt={`${alt} - ${selectedIndex + 1}`}
          fill
          className="object-cover transition-all duration-300"
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        />
      </div>

      {/* Thumbnails row if multiple photos */}
      {photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((photo, idx) => (
            <button
              key={idx}
              onClick={() => setSelectedIndex(idx)}
              className={`relative w-16 h-16 rounded-md overflow-hidden flex-shrink-0 border-2 transition-all ${
                selectedIndex === idx ? "border-indigo-500 scale-95" : "border-transparent opacity-70 hover:opacity-100"
              }`}
            >
              <Image src={photo} alt={`Thumbnail ${idx + 1}`} fill className="object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* Photo Attribution Footer */}
      {attribution && (
        <div className="text-xs text-slate-400 mt-1">
          Photo by{" "}
          {attribution.photographerUrl ? (
            <a
              href={attribution.photographerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-slate-200 transition-colors"
            >
              {photographerName}
            </a>
          ) : (
            <span>{photographerName}</span>
          )}
        </div>
      )}
    </div>
  );
}
