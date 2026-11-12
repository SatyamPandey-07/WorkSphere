import React from "react";
import type { Metadata } from "next";
import DynamicErgonomicCoach from "@/components/wellness/DynamicErgonomicCoach";

export const metadata: Metadata = {
  title: "Dynamic Ergonomic Health & Biometric Break Coach | WorkSphere",
  description:
    "Real-time posture checks, sit-to-stand desk duration ratio tracking with weekly summary analytics, 20-20-20 eye strain countdowns, micro-stretch routines, and ergonomic wellness tracking for hybrid professionals.",
};

export default function ErgonomicsPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white">
            Ergonomic Health & Biometric Break Coach
          </h1>
          <p className="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto">
            Stay pain-free and hyper-focused with real-time sitting vs. standing desk duration ratio tracking,
            weekly summary analytics, automated 20-20-20 eye rest intervals, posture assessments, and guided micro-stretch sequences.
          </p>
        </div>

        <DynamicErgonomicCoach />
      </div>
    </div>
  );
}
