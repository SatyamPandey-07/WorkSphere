"use client";

import { useState, useEffect } from "react";
import { BadgeCheck, GraduationCap } from "lucide-react";

interface StudentVerificationBadgeProps {
  /** Force-refresh when the parent knows verification just succeeded. */
  refreshKey?: number;
}

interface VerificationResponse {
  verified: boolean;
  expiresAt?: string;
  commitmentHash?: string;
}

function shortenHash(hash?: string) {
  if (!hash || hash.length < 10) return hash;
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}

function formatDate(isoStr?: string) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

export function StudentVerificationBadge({
  refreshKey,
}: StudentVerificationBadgeProps) {
  const [data, setData] = useState<VerificationResponse | null>(null);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchStatus() {
      try {
        const res = await fetch("/api/user/verify-student");
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setData({ verified: false });
      }
    }

    fetchStatus();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (!data) return null;

  let isExpired = false;
  let isExpiringSoon = false;

  if (data.expiresAt) {
    const expires = new Date(data.expiresAt);
    if (!isNaN(expires.getTime())) {
      const now = new Date();
      const diffTime = expires.getTime() - now.getTime();
      const diffDays = diffTime / (1000 * 60 * 60 * 24);

      if (diffDays < 0) {
        isExpired = true;
      } else if (diffDays <= 14) {
        isExpiringSoon = true;
      }
    }
  }

  const unverifiedBadge = (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 text-xs font-medium">
      <GraduationCap className="w-3.5 h-3.5" />
      <span>Student Not Verified</span>
    </div>
  );

  if (!data.verified || isExpired) {
    return unverifiedBadge;
  }

  const badgeContent = (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-700 dark:text-green-400 text-xs font-semibold cursor-help"
      tabIndex={0}
      onMouseEnter={() => setIsTooltipOpen(true)}
      onMouseLeave={() => setIsTooltipOpen(false)}
      onFocus={() => setIsTooltipOpen(true)}
      onBlur={() => setIsTooltipOpen(false)}
      aria-describedby="student-verification-tooltip"
    >
      <BadgeCheck className="w-3.5 h-3.5" />
      <span>Verified Student</span>
    </div>
  );

  const hasTooltipInfo = !!(data.expiresAt || data.commitmentHash);

  return (
    <div className="relative flex items-center gap-2">
      {badgeContent}

      {hasTooltipInfo && isTooltipOpen && (
        <div
          id="student-verification-tooltip"
          role="tooltip"
          className="absolute top-full mt-2 left-1/2 -translate-x-1/2 z-50 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md shadow-md w-max flex flex-col gap-1"
        >
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
            Verified Student
          </span>
          {data.expiresAt && (
            <span className="text-xs">
              Expires: {formatDate(data.expiresAt)}
            </span>
          )}
          {data.commitmentHash && (
            <span className="text-xs font-mono">
              Proof: {shortenHash(data.commitmentHash)}
            </span>
          )}
        </div>
      )}

      {isExpiringSoon && (
        <div className="px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-[10px] font-semibold whitespace-nowrap">
          Renew Soon
        </div>
      )}
    </div>
  );
}
