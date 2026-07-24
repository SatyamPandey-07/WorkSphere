"use client";

import { useState, useEffect } from "react";
import { BadgeCheck, GraduationCap } from "lucide-react";

interface StudentVerificationBadgeProps {
  /** Force-refresh when the parent knows verification just succeeded. */
  refreshKey?: number;
}

export function StudentVerificationBadge({
  refreshKey,
}: StudentVerificationBadgeProps) {
  const [verified, setVerified] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchStatus() {
      try {
        const res = await fetch("/api/user/verify-student");
        const data = await res.json();
        if (!cancelled) setVerified(data.verified);
      } catch {
        if (!cancelled) setVerified(false);
      }
    }

    fetchStatus();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (verified === null) return null;

  if (verified) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-700 dark:text-green-400 text-xs font-semibold">
        <BadgeCheck className="w-3.5 h-3.5" />
        <span>Verified Student</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 text-xs font-medium">
      <GraduationCap className="w-3.5 h-3.5" />
      <span>Student Not Verified</span>
    </div>
  );
}
