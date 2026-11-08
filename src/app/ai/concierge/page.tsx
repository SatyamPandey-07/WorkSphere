import React from "react";
import type { Metadata } from "next";
import AutonomousConciergeDashboard from "@/components/ai/AutonomousConciergeDashboard";

export const metadata: Metadata = {
  title: "Autonomous AI Concierge & Micro-Climate Re-balancing | WorkSphere",
  description:
    "Autonomous environmental monitoring, weather shift auto-pilot, acoustic noise spike mitigation, and proactive desk migration for hybrid workspaces.",
};

export default function ConciergePage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white">
            Autonomous AI Concierge & Re-Balancing Auto-Pilot
          </h1>
          <p className="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto">
            Real-time environmental telemetry scans and auto-migrates coworkers during sudden weather
            storms, decibel spikes, and HVAC fluctuations for uninterrupted focus.
          </p>
        </div>

        <AutonomousConciergeDashboard />
      </div>
    </div>
  );
}
