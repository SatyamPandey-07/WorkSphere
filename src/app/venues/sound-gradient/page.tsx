import React from "react";
import SpatialAcousticGradientViewer from "@/components/venue/SpatialAcousticGradientViewer";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "3D Spatial Acoustic Gradient & Sound Zoning Map | WorkSphere",
  description:
    "Explore continuous spatial sound pressure gradients, simulate espresso bar noise decay, and reserve quiet focus desks.",
};

export default function SoundGradientPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4">
      <SpatialAcousticGradientViewer />
    </main>
  );
}
