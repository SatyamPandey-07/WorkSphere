"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const STORAGE_KEY = "worksphere-cookie-consent";

export function CookieBanner() {
  const [visible, setVisible] = useState(false);

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
    <div
      role="dialog"
      aria-label="Cookie consent"
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
          onClick={() => dismiss("declined")}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
        >
          Decline
        </button>
        <button
          onClick={() => dismiss("granted")}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors"
        >
          Accept All
        </button>
      </div>
    </div>
  );
}
