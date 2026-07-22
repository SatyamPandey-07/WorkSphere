"use client";

import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  Loader2,
} from "lucide-react";
import type {
  VerificationStatus,
  SignatureVerificationResult,
} from "@/types/pdfSignature";

interface SignatureVerificationBadgeProps {
  status: VerificationStatus;
  result?: SignatureVerificationResult | null;
  signerName?: string;
  className?: string;
}

export function SignatureVerificationBadge({
  status,
  result,
  signerName,
  className = "",
}: SignatureVerificationBadgeProps) {
  const displaySigner = signerName || result?.signerName || "";

  if (status === "verified") {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium border-green-500/30 bg-green-500/15 text-green-500 ${className}`}
        role="status"
        aria-live="polite"
      >
        <ShieldCheck size={16} />
        Digitally Verified
        {displaySigner && (
          <span className="opacity-80 font-normal ml-1">
            by {displaySigner}
          </span>
        )}
        {result?.algorithm && (
          <span className="text-xs opacity-60 px-1.5 py-0.5 rounded bg-white/10 ml-1">
            {result.algorithm}
          </span>
        )}
      </span>
    );
  }

  if (status === "invalid") {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium border-red-500/30 bg-red-500/15 text-red-500 ${className}`}
        role="status"
        aria-live="polite"
      >
        <ShieldAlert size={16} />
        Signature Invalid
        {result?.error && (
          <span className="text-xs opacity-80 max-w-[200px] truncate ml-1">
            {result.error}
          </span>
        )}
      </span>
    );
  }

  if (status === "unsigned") {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium border-slate-500/30 bg-slate-500/15 text-slate-400 ${className}`}
        role="status"
        aria-live="polite"
      >
        <ShieldOff size={16} />
        No Digital Signature
      </span>
    );
  }

  if (status === "verifying" || status === "loading") {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium border-blue-500/30 bg-blue-500/15 text-blue-500 ${className}`}
        role="status"
        aria-live="polite"
      >
        <Loader2 size={16} className="animate-spin" />
        Verifying Signature...
      </span>
    );
  }

  if (status === "error") {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium border-red-500/30 bg-red-500/15 text-red-500 ${className}`}
        role="status"
        aria-live="polite"
      >
        <ShieldAlert size={16} />
        Verification Error
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium border-slate-500/20 bg-slate-500/10 text-slate-500 ${className}`}
      role="status"
      aria-live="polite"
    >
      <Shield size={16} />
      Awaiting Verification
    </span>
  );
}
