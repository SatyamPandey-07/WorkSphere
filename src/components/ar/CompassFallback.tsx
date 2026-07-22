"use client";

import { useDeviceOrientation } from "@/hooks/useDeviceOrientation";
import { Navigation } from "lucide-react";

export default function CompassFallback() {
  const { heading, error, isSupported } = useDeviceOrientation();

  // For demonstration, we'll just show the compass heading
  // If destinationLat/Lng were provided, we'd calculate the bearing to the destination
  // and show the arrow pointing there.

  return (
    <div className="flex flex-col items-center justify-center w-full h-full min-h-[400px] bg-slate-900 rounded-lg p-6 text-white relative overflow-hidden">
      <div className="absolute top-4 left-4 text-sm font-medium text-slate-400">
        AR Navigation Not Supported
      </div>

      <div className="flex flex-col items-center gap-8 z-10">
        <div className="text-center">
          <h3 className="text-xl font-bold mb-2">2D Compass View</h3>
          <p className="text-slate-400 max-w-xs text-sm">
            Follow the compass to reach your destination. Your device doesn't
            support immersive AR.
          </p>
        </div>

        {!isSupported ? (
          <div className="bg-red-500/20 text-red-300 p-4 rounded-md border border-red-500/50">
            Device orientation not supported on this device.
          </div>
        ) : error ? (
          <div className="bg-red-500/20 text-red-300 p-4 rounded-md border border-red-500/50">
            {error}
          </div>
        ) : (
          <div className="relative w-64 h-64 flex items-center justify-center">
            {/* Compass Base */}
            <div className="absolute inset-0 rounded-full border-4 border-slate-700 bg-slate-800 shadow-[0_0_50px_rgba(0,0,0,0.5)]">
              <div className="absolute top-2 left-1/2 -translate-x-1/2 font-bold text-red-500">
                N
              </div>
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 font-bold text-slate-500">
                S
              </div>
              <div className="absolute right-2 top-1/2 -translate-y-1/2 font-bold text-slate-500">
                E
              </div>
              <div className="absolute left-2 top-1/2 -translate-y-1/2 font-bold text-slate-500">
                W
              </div>
            </div>

            {/* Rotating Arrow (Points North if no destination) */}
            <div
              className="absolute w-full h-full transition-transform duration-200 ease-out flex items-center justify-center"
              style={{
                transform: `rotate(${heading ? -heading : 0}deg)`,
              }}
            >
              <div className="relative w-8 h-48 flex flex-col items-center">
                <Navigation className="w-12 h-12 text-blue-500 fill-blue-500 transform -translate-y-4" />
                <div className="w-1 h-24 bg-gradient-to-b from-blue-500 to-transparent"></div>
              </div>
            </div>

            {/* Center Pin */}
            <div className="absolute w-4 h-4 bg-slate-400 rounded-full border-2 border-slate-900 shadow-lg"></div>
          </div>
        )}

        <div className="text-3xl font-mono font-bold tabular-nums">
          {heading !== null ? `${Math.round(heading)}°` : "---°"}
        </div>
      </div>

      {/* Decorative background grid */}
      <div
        className="absolute inset-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255, 255, 255, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.2) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      ></div>
    </div>
  );
}
