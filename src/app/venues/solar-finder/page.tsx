import React from "react";
import SolarDeskSelector from "@/components/venue/SolarDeskSelector";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Solar Orientation & Natural Light Desk Selector | WorkSphere",
  description:
    "Simulate sun angle, solar azimuth, and natural window lighting across coworking floorplans to reserve glare-free workspaces.",
};

export default function SolarFinderPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4">
      <SolarDeskSelector />
    </main>
  );
}
