import React from "react";
import type { Metadata } from "next";
import SmartBaristaOrderView from "@/components/cafe/SmartBaristaOrderView";

export const metadata: Metadata = {
  title: "Smart Cafe Dietary Filter & Barista Pre-Ordering | WorkSphere",
  description:
    "Mobile barista pre-ordering with real-time allergen & dietary filters, custom roast builders, live queue estimations, and digital pickup passes.",
};

export default function CafeOrderPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white">
            Smart Cafe & Barista Pre-Ordering
          </h1>
          <p className="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto">
            Order your artisan coffee, matcha, and healthy snacks directly to your workspace desk with
            precision dietary filters and live barista queue tracking.
          </p>
        </div>

        <SmartBaristaOrderView />
      </div>
    </div>
  );
}
