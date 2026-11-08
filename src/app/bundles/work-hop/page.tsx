import React from "react";
import WorkHopPassCard from "@/components/bookings/WorkHopPassCard";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Smart 'Work-Hop' Multi-Venue Day Pass | WorkSphere",
  description:
    "Combine morning cafes, afternoon focus booths, and evening lounges into a unified discounted day pass with dynamic QR check-ins.",
};

export default function WorkHopBundlesPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 py-8 px-4">
      <WorkHopPassCard />
    </main>
  );
}
