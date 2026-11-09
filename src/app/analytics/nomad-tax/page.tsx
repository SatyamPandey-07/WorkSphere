import React from "react";
import NomadTaxComplianceDashboard from "@/components/billing/NomadTaxComplianceDashboard";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Digital Nomad Tax & Schengen 90/180 Visa Stay Tracker | WorkSphere",
  description:
    "Monitor rolling Schengen stay quotas, mitigate 183-day accidental tax residency hazards, and export one-click tax-deductible workspace expense dossiers.",
};

export default function NomadTaxPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4">
      <NomadTaxComplianceDashboard />
    </main>
  );
}
