"use client";

import { useScrollProgress } from "@/hooks/useScrollProgress";

export function ScrollProgress() {
  const progress = useScrollProgress();

  return (
    <div
      className="fixed top-0 left-0 right-auto h-1 bg-gradient-to-r from-blue-600 to-purple-600 z-50 pointer-events-none transition-all duration-75"
      style={{ width: `${progress}%` }}
      aria-hidden="true"
    />
  );
}
