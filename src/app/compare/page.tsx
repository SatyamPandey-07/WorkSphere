"use client";

import { Suspense } from "react";
import { TopNav } from "@/components/TopNav";
import SiteFooter from "@/components/site-footer";
import { MultiCityComparison } from "@/components/venues/MultiCityComparison";
import { Loader2 } from "lucide-react";

function CompareContent() {
  return <MultiCityComparison />;
}

export default function ComparePage() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-[#050510] text-zinc-900 dark:text-white flex flex-col transition-colors">
      <TopNav />

      <main className="container mx-auto px-4 py-8 flex-1">
        <Suspense
          fallback={
            <div className="h-64 flex items-center justify-center gap-2 text-xs text-zinc-500">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              <span>Loading nomad multi-city workspace comparison…</span>
            </div>
          }
        >
          <CompareContent />
        </Suspense>
      </main>

      <SiteFooter />
    </div>
  );
}
