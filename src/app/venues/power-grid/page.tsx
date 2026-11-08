import React from "react";
import PowerGridReliabilityMonitor from "@/components/venue/PowerGridReliabilityMonitor";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Smart Power Grid & Outlet Voltage / Reliability Monitor | WorkSphere",
  description:
    "Monitor real-time workspace power grid health, verified 140W/100W USB-C PD charging speeds, AC voltage stability, and crowdsourced dead-plug reports.",
};

export default function PowerGridPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4">
      <PowerGridReliabilityMonitor />
    </main>
  );
}
