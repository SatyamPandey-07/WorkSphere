"use client";

import { useEffect, useState } from "react";
import { BadgeCheck } from "lucide-react";

export interface NomadPassportVerificationBadgeProps {
  verified?: boolean;
  refreshKey?: number;
  className?: string;
  testId?: string;
}

export function NomadPassportVerificationBadge({
  verified: propVerified,
  refreshKey,
  className = "",
  testId = "nomad-passport-verification-badge",
}: NomadPassportVerificationBadgeProps) {
  const [isVerified, setIsVerified] = useState<boolean | null>(
    propVerified !== undefined ? propVerified : null,
  );
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);

  useEffect(() => {
    if (propVerified !== undefined) {
      setIsVerified(propVerified);
      return;
    }

    let cancelled = false;

    async function fetchStatus() {
      try {
        const response = await fetch("/api/auth/zkp/nomad-proof", {
          cache: "no-store",
        });
        if (!response.ok) {
          if (!cancelled) setIsVerified(false);
          return;
        }

        const data = await response.json();
        if (
          !cancelled &&
          data &&
          data.success === true &&
          data.verified === true
        ) {
          setIsVerified(true);
        } else if (!cancelled) {
          setIsVerified(false);
        }
      } catch {
        if (!cancelled) setIsVerified(false);
      }
    }

    setIsVerified(null);
    fetchStatus();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, propVerified]);

  if (isVerified !== true) return null;

  return (
    <div className={`relative inline-flex ${className}`.trim()}>
      <div
        role="img"
        aria-label="Nomad Passport Verified"
        aria-describedby={`${testId}-tooltip`}
        tabIndex={0}
        data-testid={testId}
        onMouseEnter={() => setIsTooltipOpen(true)}
        onMouseLeave={() => setIsTooltipOpen(false)}
        onFocus={() => setIsTooltipOpen(true)}
        onBlur={() => setIsTooltipOpen(false)}
        className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-700 shadow-[0_0_14px_rgba(34,211,238,0.18)] transition-colors dark:text-cyan-300"
      >
        <BadgeCheck
          className="h-3.5 w-3.5 shrink-0 text-cyan-600 drop-shadow-[0_0_5px_rgba(34,211,238,0.65)] dark:text-cyan-300"
          aria-hidden="true"
        />
        <span>Nomad Passport Verified</span>
      </div>
      {isTooltipOpen && (
        <div
          id={`${testId}-tooltip`}
          role="tooltip"
          className="absolute left-1/2 top-full z-50 mt-2 w-max max-w-64 -translate-x-1/2 rounded-lg border border-cyan-400/20 bg-zinc-950 px-3 py-2 text-xs font-medium text-cyan-100 shadow-[0_8px_24px_rgba(34,211,238,0.16)]"
        >
          Nomad Passport Verified
        </div>
      )}
    </div>
  );
}

export default NomadPassportVerificationBadge;
