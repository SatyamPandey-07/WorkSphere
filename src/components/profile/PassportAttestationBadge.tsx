"use client";

import React, { useState, useEffect } from "react";
import {
  Clock,
  AlertTriangle,
  Fingerprint,
  Calendar,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import type { PassportStamp } from "@/lib/zkp/nomadProof";
import { computeNomadSignatureFingerprint } from "@/lib/zkp/nomadProof";

export type AttestationStatus = "verified" | "pending" | "invalid";

export interface PassportAttestationBadgeProps {
  stamp: PassportStamp;
  /** Optional initial status override for testing or server-provided state */
  initialStatus?: AttestationStatus;
  className?: string;
  testId?: string;
}

export function PassportAttestationBadge({
  stamp,
  initialStatus,
  className = "",
  testId = "passport-attestation-badge",
}: PassportAttestationBadgeProps) {
  const [status, setStatus] = useState<AttestationStatus | "loading">(
    initialStatus ?? "loading",
  );
  const [timestamp, setTimestamp] = useState<string | null>(
    stamp.issuedAt || null,
  );
  const [fingerprint, setFingerprint] = useState<string | null>(
    stamp.verificationSignature
      ? computeNomadSignatureFingerprint(stamp.verificationSignature)
      : null,
  );
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;

    // If initialStatus is explicitly provided (e.g. In tests or SSR), use it directly
    if (initialStatus) {
      setStatus(initialStatus);
      return;
    }

    async function verifyWithServer() {
      setStatus("loading");
      setVerificationError(null);

      // Handle missing attestation data immediately
      if (!stamp.stampId || !stamp.badgeType || !stamp.nullifierHash) {
        if (!cancelled) {
          setStatus("invalid");
          setVerificationError("Missing required stamp attestation data.");
        }
        return;
      }

      // If stamp has no signature or explicitly designated as offline pending
      if (
        !stamp.verificationSignature ||
        stamp.verificationSignature === "pending_server_verification" ||
        stamp.verificationSignature === "offline_pending"
      ) {
        if (!cancelled) {
          setStatus("pending");
          setTimestamp(stamp.issuedAt || null);
          setFingerprint(null);
        }
        return;
      }

      try {
        const res = await fetch(
          "/api/auth/zkp/nomad-proof/verify-attestation",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              stampId: stamp.stampId,
              badgeType: stamp.badgeType,
              nullifierHash: stamp.nullifierHash,
              epoch: stamp.epoch,
              verificationSignature: stamp.verificationSignature,
              issuedAt: stamp.issuedAt,
            }),
          },
        );

        if (!res.ok) {
          if (!cancelled) {
            setStatus("invalid");
            setVerificationError("Server could not verify attestation.");
          }
          return;
        }

        const data = await res.json();
        if (!cancelled) {
          if (data.status === "verified") {
            setStatus("verified");
            setTimestamp(data.timestamp || stamp.issuedAt || null);
            setFingerprint(
              data.signatureFingerprint ||
                computeNomadSignatureFingerprint(stamp.verificationSignature),
            );
          } else if (data.status === "pending") {
            setStatus("pending");
            setTimestamp(data.timestamp || stamp.issuedAt || null);
            setFingerprint(null);
          } else {
            setStatus("invalid");
            setVerificationError(
              data.error || "Cryptographic verification failed.",
            );
          }
        }
      } catch {
        if (!cancelled) {
          setStatus("invalid");
          setVerificationError("Network error verifying attestation.");
        }
      }
    }

    verifyWithServer();

    return () => {
      cancelled = true;
    };
  }, [
    stamp.stampId,
    stamp.badgeType,
    stamp.verificationSignature,
    stamp.nullifierHash,
    stamp.epoch,
    stamp.issuedAt,
    initialStatus,
  ]);

  const toggleDetails = () => {
    setIsDetailsOpen((prev) => !prev);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleDetails();
    }
  };

  // Status configuration mappings
  const config = {
    loading: {
      label: "Verifying Attestation...",
      badgeStyle: "bg-slate-800/80 border-slate-700 text-slate-300",
      icon: (
        <RefreshCw
          className="w-3.5 h-3.5 animate-spin text-slate-400"
          aria-hidden="true"
        />
      ),
    },
    verified: {
      label: "Attestation: Verified",
      badgeStyle:
        "bg-emerald-500/10 border-emerald-500/30 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.15)]",
      icon: (
        <ShieldCheck
          className="w-3.5 h-3.5 text-emerald-400"
          aria-hidden="true"
        />
      ),
    },
    pending: {
      label: "Attestation: Pending",
      badgeStyle:
        "bg-amber-500/10 border-amber-500/30 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.15)]",
      icon: <Clock className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />,
    },
    invalid: {
      label: "Attestation: Invalid",
      badgeStyle:
        "bg-rose-500/10 border-rose-500/30 text-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.15)]",
      icon: (
        <AlertTriangle
          className="w-3.5 h-3.5 text-rose-400"
          aria-hidden="true"
        />
      ),
    },
  }[status];

  const formattedTimestamp = timestamp
    ? new Date(timestamp).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Unavailable";

  return (
    <div className={`relative inline-block ${className}`.trim()}>
      <button
        type="button"
        data-testid={testId}
        aria-expanded={isDetailsOpen}
        aria-controls={`${testId}-details`}
        aria-label={`${config.label}. Click to view attestation cryptographic details.`}
        onClick={toggleDetails}
        onKeyDown={handleKeyDown}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-mono font-semibold transition-all hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 cursor-pointer ${config.badgeStyle}`}
      >
        {config.icon}
        <span>
          {status === "loading"
            ? "Verifying..."
            : status === "verified"
              ? "Verified"
              : status === "pending"
                ? "Pending"
                : "Invalid"}
        </span>
      </button>

      {/* Popover Card with Attestation Details */}
      {isDetailsOpen && (
        <div
          id={`${testId}-details`}
          role="region"
          aria-label="Attestation cryptographic details"
          data-testid={`${testId}-details`}
          className="absolute left-0 bottom-full mb-2 z-30 w-72 p-3.5 rounded-2xl bg-slate-900/95 border border-slate-700/80 shadow-2xl backdrop-blur-md text-xs font-mono space-y-2.5 text-slate-200 animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
            <span className="font-bold text-[11px] text-white flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" /> Attestation
              Details
            </span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold ${
                status === "verified"
                  ? "bg-emerald-500/20 text-emerald-300"
                  : status === "pending"
                    ? "bg-amber-500/20 text-amber-300"
                    : "bg-rose-500/20 text-rose-300"
              }`}
            >
              {status}
            </span>
          </div>

          {/* Timestamp Detail */}
          <div className="space-y-0.5">
            <span className="text-[10px] text-slate-400 flex items-center gap-1">
              <Calendar className="w-3 h-3 text-cyan-400" /> Attestation
              Timestamp
            </span>
            <div
              data-testid={`${testId}-timestamp`}
              className="text-slate-100 font-semibold truncate"
            >
              {formattedTimestamp}
            </div>
          </div>

          {/* Signature Fingerprint Detail */}
          <div className="space-y-0.5">
            <span className="text-[10px] text-slate-400 flex items-center gap-1">
              <Fingerprint className="w-3 h-3 text-indigo-400" /> Signature
              Fingerprint
            </span>
            <div
              data-testid={`${testId}-fingerprint`}
              className="text-cyan-300 font-bold bg-slate-950/60 p-1.5 rounded-lg border border-slate-800/80 break-all text-[10px]"
            >
              {fingerprint ||
                (status === "pending"
                  ? "Pending server attestation"
                  : "Unavailable / Invalid")}
            </div>
          </div>

          {/* Additional status note */}
          {status === "pending" && (
            <p className="text-[10px] text-amber-300/90 leading-tight pt-1">
              Offline stamp waiting to sync with authoritative server for
              cryptographic signature issuance.
            </p>
          )}

          {status === "invalid" && verificationError && (
            <p className="text-[10px] text-rose-300/90 leading-tight pt-1">
              {verificationError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default PassportAttestationBadge;
