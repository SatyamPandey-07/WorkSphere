import React from "react";
import EmergencyEvacuationRouter from "@/components/venue/EmergencyEvacuationRouter";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Emergency Evacuation & Egress Wayfinding Router | WorkSphere",
  description:
    "Real-time emergency egress wayfinding, shortest-path fire exit routing, on-site AED defibrillator locator, and outdoor assembly muster point navigation.",
};

export default function EvacuationPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4">
      <EmergencyEvacuationRouter />
    </main>
  );
}
