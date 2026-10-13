"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";

const STORAGE_KEY = "worksphere-cookie-consent";

interface CookieBannerProps {
  reducedMotion?: boolean;
}

export function CookieBanner({ reducedMotion }: CookieBannerProps = {}) {
  const [visible, setVisible] = useState(false);
  const framerReducedMotion = useReducedMotion();
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setVisible(true);
      }
    } catch {
      // localStorage unavailable (private browsing, WebViews) — show banner every session
      setVisible(true);
    }
  }, []);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function"
    ) {
      const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      setSystemReducedMotion(mediaQuery.matches);
      const listener = (event: MediaQueryListEvent) => {
        setSystemReducedMotion(event.matches);
      };
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener("change", listener);
        return () => mediaQuery.removeEventListener("change", listener);
      } else if ("addListener" in mediaQuery) {
        (mediaQuery as any).addListener(listener);
        return () => (mediaQuery as any).removeListener(listener);
      }
    }
  }, []);

  const shouldReduceMotion = Boolean(
    reducedMotion ?? (framerReducedMotion || systemReducedMotion),
  );

  if (!visible) return null;

  const dismiss = (choice: "granted" | "declined") => {
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // ignore
    }
    setVisible(false);
  };

  return (
    <motion.div
      role="dialog"
      aria-label="Cookie consent"
      data-reduced-motion={shouldReduceMotion ? "true" : "false"}
      initial={
        shouldReduceMotion ? { opacity: 0, y: 0 } : { opacity: 0, y: 50 }
      }
      animate={{ opacity: 1, y: 0 }}
      transition={
        shouldReduceMotion
          ? { duration: 0.15 }
          : { type: "spring", stiffness: 300, damping: 30 }
      }
      className="fixed bottom-0 left-0 right-0 z-[60] bg-white dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 shadow-2xl px-4 py-4 sm:flex sm:items-center sm:justify-between sm:gap-6"
    >
      <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed mb-3 sm:mb-0">
        We use cookies to improve your experience.{" "}
        <Link
          href="/privacy"
          className="underline hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        >
          Privacy Policy
        </Link>
      </p>

      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={() => dismiss("declined")}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
        >
          Decline
        </button>
        <button
          type="button"
          onClick={() => dismiss("granted")}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors"
        >
          Accept All
        </button>
      </div>
    </motion.div>
  );
}
