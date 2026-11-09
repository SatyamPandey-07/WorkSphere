import React from "react";
import CarbonFootprintTracker from "@/components/analytics/CarbonFootprintTracker";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Remote Work Carbon Footprint & Scope 3 ESG Tracker | WorkSphere",
  description:
    "Track multimodal commuter carbon footprints, avoided CO2 savings against driving, green workspace certifications, and export corporate Scope 3 ESG dossiers.",
};

export default function CarbonPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4">
      <CarbonFootprintTracker />
    </main>
  );
}
