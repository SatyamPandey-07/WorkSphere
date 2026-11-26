"use client";

import React from "react";
import Link from "next/link";
import { Compass, ArrowRight } from "lucide-react";
import { HolographicCompass } from "./HolographicCompass";

export interface EmptyBookmarksStateProps {
  className?: string;
  ctaHref?: string;
}

/**
 * Dedicated Glassmorphic Empty State component for Empty Bookmarks Collection (#7206).
 * Renders an animated holographic compass with glowing glassmorphism,
 * clear typography, and a prominent CTA linking to `/venues?search=true`.
 */
export function EmptyBookmarksState({
  className = "",
  ctaHref = "/venues?search=true",
}: EmptyBookmarksStateProps) {
  return (
    <section
      role="region"
      aria-label="Empty saved workspaces"
      data-testid="empty-bookmarks-state"
      className={`relative w-full max-w-lg mx-auto p-8 sm:p-12 text-center rounded-3xl overflow-hidden backdrop-blur-xl bg-white/75 dark:bg-zinc-900/70 border border-zinc-200/80 dark:border-zinc-800/80 shadow-[0_8px_32px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.06)] transition-all ${className}`}
    >
      {/* Decorative ambient background radial highlights */}
      <div
        className="absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-72 bg-gradient-to-br from-cyan-400/15 via-indigo-500/10 to-emerald-400/15 rounded-full blur-3xl pointer-events-none -z-10"
        aria-hidden="true"
      />
      <div
        className="absolute -bottom-20 left-1/2 -translate-x-1/2 w-64 h-64 bg-gradient-to-tr from-violet-500/10 via-sky-400/10 to-transparent rounded-full blur-2xl pointer-events-none -z-10"
        aria-hidden="true"
      />

      {/* Holographic Compass Illustration */}
      <div className="mb-6 flex justify-center">
        <HolographicCompass size={144} />
      </div>

      {/* Primary Heading */}
      <h2
        data-testid="empty-bookmarks-title"
        className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 mb-2.5 font-display"
      >
        No saved workspaces yet
      </h2>

      {/* Supporting Description */}
      <p
        data-testid="empty-bookmarks-description"
        className="text-sm text-zinc-600 dark:text-zinc-400 max-w-sm mx-auto mb-8 leading-relaxed font-normal"
      >
        Explore verified spaces, quiet study nooks, and cafes with dependable Wi-Fi, then save your favorites here for instant access.
      </p>

      {/* Action CTA Button */}
      <div className="flex justify-center">
        <Link
          href={ctaHref}
          data-testid="discover-workspaces-cta"
          aria-label="Discover Workspaces"
          className="group inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl font-semibold text-sm text-white bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-500 hover:via-blue-500 hover:to-indigo-500 active:scale-[0.98] shadow-md shadow-blue-500/20 hover:shadow-lg hover:shadow-cyan-500/30 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 dark:focus:ring-offset-zinc-950"
        >
          <Compass className="w-4 h-4 text-cyan-200 group-hover:rotate-45 transition-transform duration-300" aria-hidden="true" />
          <span>Discover Workspaces</span>
          <ArrowRight className="w-4 h-4 text-blue-200 group-hover:translate-x-0.5 transition-transform duration-200" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

export default EmptyBookmarksState;
