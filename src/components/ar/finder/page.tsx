"use client";

import React from "react";
import WebXRWayfindingOverlay from "@/components/ar/WebXRWayfindingOverlay";

export default function ARFinderPage() {
  const sampleDesk = {
    id: "desk-402",
    name: "Hot Desk 402 - Quiet Zone (Floor 4)",
    position: { x: 12.5, y: 0.0, z: -18.2 },
  };

  return (
    <main className="container mx-auto p-4 max-w-4xl min-h-screen flex flex-col justify-center">
      <h1 className="text-2xl font-bold mb-4 text-zinc-100">
        Indoor Campus AR Navigation
      </h1>
      <div className="w-full h-[600px] border border-zinc-800 rounded-xl overflow-hidden shadow-2xl">
        <WebXRWayfindingOverlay destinationDesk={sampleDesk} />
      </div>
    </main>
  );
}
