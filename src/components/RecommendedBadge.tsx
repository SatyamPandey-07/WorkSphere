import React from "react";
import { Sparkles } from "lucide-react";

export function RecommendedBadge() {
  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-gradient-to-r from-amber-500/10 to-orange-500/10 text-amber-600 dark:from-amber-400/10 dark:to-orange-400/10 dark:text-amber-400 border border-amber-500/20 text-xs font-medium shadow-sm transition-all hover:shadow-md">
      <Sparkles className="w-3.5 h-3.5" />
      <span>Recommended for You</span>
    </div>
  );
}
