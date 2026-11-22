"use client";

import React, { useMemo } from "react";
import { Download } from "lucide-react";
import {
  downloadNomadBadge,
  generateNomadBadgeSvg,
  type NomadBadgeParams,
} from "@/lib/profile/badgeGenerator";

export interface NomadPassportCertificateProps extends NomadBadgeParams {
  className?: string;
}

/**
 * Shows a preview of the user's SVG credential badge with a "Download Badge"
 * action. The preview is rendered through an <img> data URI so the SVG markup
 * is never injected into the page DOM.
 */
export function NomadPassportCertificate({
  displayName,
  rank,
  verifiedCheckIns,
  issuedAt,
  className = "",
}: NomadPassportCertificateProps) {
  // Pin the timestamp so the preview and the downloaded file match.
  const issuedAtMs = useMemo(
    () => (issuedAt === undefined ? Date.now() : new Date(issuedAt).getTime()),
    [issuedAt],
  );

  const { svg, error } = useMemo(() => {
    try {
      return {
        svg: generateNomadBadgeSvg({
          displayName,
          rank,
          verifiedCheckIns,
          issuedAt: issuedAtMs,
        }),
        error: null as string | null,
      };
    } catch (err) {
      return {
        svg: null,
        error: err instanceof Error ? err.message : "Unable to build badge",
      };
    }
  }, [displayName, rank, verifiedCheckIns, issuedAtMs]);

  const previewSrc = svg
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    : null;

  return (
    <section
      data-testid="nomad-passport-certificate"
      className={`rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3 ${className}`}
    >
      {previewSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewSrc}
          alt={`Nomad badge for ${displayName}`}
          className="w-full h-auto rounded-xl"
          data-testid="nomad-badge-preview"
        />
      ) : (
        <p role="alert" data-testid="nomad-badge-error" className="text-sm text-red-500">
          Badge unavailable: {error}
        </p>
      )}
      <button
        type="button"
        data-testid="download-badge-button"
        disabled={!svg}
        onClick={() =>
          downloadNomadBadge({
            displayName,
            rank,
            verifiedCheckIns,
            issuedAt: issuedAtMs,
          })
        }
        className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        Download Badge
      </button>
    </section>
  );
}

export default NomadPassportCertificate;
