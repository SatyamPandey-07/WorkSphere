"use client";

import React from "react";
import { SplitPaneWorkspace } from "@/components/venues/SplitPaneWorkspace";

export default function VenuesDiscoveryPage() {
  const leftFeed = (
    <div className="p-6 space-y-4 h-full overflow-y-auto bg-slate-950 border-r border-slate-900">
      <div className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight text-slate-100">
          Coworking Discovery Feed
        </h1>
        <p className="text-xs text-slate-400">
          Explore verified spaces, acoustic ratings, and real-time mesh
          occupancy.
        </p>
      </div>

      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((id) => (
          <div
            key={id}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-4 hover:border-emerald-500/50 transition cursor-pointer shadow-lg space-y-2"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-100">
                WorkSphere Hub #{id} - Downtown Core
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                42 dB • Quiet
              </span>
            </div>
            <p className="text-xs text-slate-400">
              High-speed fiber optics, ergonomic standing desks, and soundproof
              pod access.
            </p>
            <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono pt-2 border-t border-slate-800/80">
              <span>📍 450m away</span>
              <span className="text-emerald-400">12 Desks Available</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const rightMap = (
    <div className="w-full h-full bg-slate-900 flex items-center justify-center relative">
      {/* Placeholder for Interactive Leaflet Map Component */}
      <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] opacity-40" />
      <div className="text-center space-y-2 z-10 p-6">
        <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 animate-pulse">
          🗺️
        </div>
        <h3 className="text-sm font-bold text-slate-200">
          Interactive Leaflet Map View
        </h3>
        <p className="text-xs text-slate-400 max-w-xs mx-auto">
          Vector raster tiles rendered with automatic tile provider fallback and
          proximity markers.
        </p>
      </div>
    </div>
  );

  return (
    <main className="w-full h-screen overflow-hidden bg-slate-950">
      <SplitPaneWorkspace
        leftPane={leftFeed}
        rightPane={rightMap}
        defaultRatio={45}
      />
    </main>
  );
}
