'use client';

import React, { useMemo } from 'react';

export interface NomadCredentialData {
  username: string;
  verifiedAt: string;
  credentialHash: string;
  tierLabel?: string;
}

export interface NomadPassportCertificateProps extends NomadCredentialData {
  onDownload?: (filename: string, svgContent: string) => void;
  className?: string;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function formatShortHash(hash: string): string {
  const clean = hash.trim();
  if (clean.length <= 20) return clean;
  return `${clean.slice(0, 10)}…${clean.slice(-8)}`;
}

export function sanitizeFilenameSlug(username: string): string {
  const slug = username
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'nomad';
}

export function buildNomadCredentialSvg(data: NomadCredentialData): string {
  const safeUser = escapeXml(data.username.trim() || 'Verified Nomad');
  const safeDate = escapeXml(data.verifiedAt.trim());
  const fullHash = escapeXml(data.credentialHash.trim());
  const shortHash = escapeXml(formatShortHash(data.credentialHash));
  const safeTier = escapeXml(data.tierLabel?.trim() || 'VERIFIED DIGITAL NOMAD');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" role="img" aria-labelledby="cred-title cred-desc">',
    `  <title id="cred-title">WorkSphere Nomad Passport — ${safeUser}</title>`,
    `  <desc id="cred-desc">Verified digital nomad credential for ${safeUser}, issued ${safeDate}, hash ${fullHash}</desc>`,
    '  <defs>',
    '    <linearGradient id="ws-bg" x1="0%" y1="0%" x2="100%" y2="100%">',
    '      <stop offset="0%" stop-color="#0f172a" />',
    '      <stop offset="55%" stop-color="#1e1b4b" />',
    '      <stop offset="100%" stop-color="#312e81" />',
    '    </linearGradient>',
    '    <linearGradient id="ws-accent" x1="0%" y1="0%" x2="100%" y2="0%">',
    '      <stop offset="0%" stop-color="#8b5cf6" />',
    '      <stop offset="100%" stop-color="#ec4899" />',
    '    </linearGradient>',
    '  </defs>',
    '  <rect x="0" y="0" width="640" height="360" rx="20" fill="url(#ws-bg)" />',
    '  <rect x="14" y="14" width="612" height="332" rx="14" fill="none" stroke="url(#ws-accent)" stroke-width="2" />',
    `  <text x="320" y="195" text-anchor="middle" font-family="monospace" font-size="11" fill="#ffffff" fill-opacity="0.06" letter-spacing="2">${fullHash}</text>`,
    `  <text x="320" y="220" text-anchor="middle" font-family="monospace" font-size="11" fill="#ffffff" fill-opacity="0.06" letter-spacing="2">${fullHash}</text>`,
    '  <circle cx="556" cy="84" r="34" fill="none" stroke="#34d399" stroke-width="2.5" />',
    '  <path d="M542 84 L552 94 L572 72" fill="none" stroke="#34d399" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />',
    '  <text x="40" y="64" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="700" fill="#c4b5fd" letter-spacing="2">WORKSPHERE NOMAD PASSPORT</text>',
    `  <rect x="40" y="78" width="220" height="24" rx="12" fill="url(#ws-accent)" />`,
    `  <text x="150" y="94" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" fill="#ffffff" letter-spacing="1">${safeTier}</text>`,
    `  <text x="40" y="162" font-family="system-ui, -apple-system, sans-serif" font-size="30" font-weight="700" fill="#f8fafc">${safeUser}</text>`,
    `  <text x="40" y="198" font-family="system-ui, -apple-system, sans-serif" font-size="14" fill="#cbd5e1">Verified On: ${safeDate}</text>`,
    '  <line x1="40" y1="268" x2="600" y2="268" stroke="#475569" stroke-width="1" />',
    '  <text x="40" y="296" font-family="monospace" font-size="11" fill="#94a3b8">SHA-256 WATERMARK</text>',
    `  <text x="40" y="316" font-family="monospace" font-size="12" fill="#e2e8f0">${shortHash}</text>`,
    '  <text x="600" y="316" text-anchor="end" font-family="system-ui, -apple-system, sans-serif" font-size="12" font-weight="600" fill="#34d399">AUTHENTICATED</text>',
    '</svg>',
  ].join('\n');
}

export function triggerSvgBlobDownload(filename: string, svgContent: string): void {
  const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export const NomadPassportCertificate: React.FC<NomadPassportCertificateProps> = ({
  username,
  verifiedAt,
  credentialHash,
  tierLabel = 'VERIFIED DIGITAL NOMAD',
  onDownload,
  className = '',
}) => {
  const svgMarkup = useMemo(
    () =>
      buildNomadCredentialSvg({
        username,
        verifiedAt,
        credentialHash,
        tierLabel,
      }),
    [username, verifiedAt, credentialHash, tierLabel]
  );

  const handleDownload = () => {
    const filename = `nomad-passport-${sanitizeFilenameSlug(username)}.svg`;
    triggerSvgBlobDownload(filename, svgMarkup);
    onDownload?.(filename, svgMarkup);
  };

  return (
    <section
      aria-label="Nomad Passport Credential Badge"
      className={`flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`.trim()}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Nomad Passport Credential
          </h3>
          <p className="text-xs text-slate-600">
            Vectorized SVG badge with embedded verification hash watermark
          </p>
        </div>

        <button
          type="button"
          onClick={handleDownload}
          data-testid="download-credential-svg-btn"
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          Download Credential (.SVG)
        </button>
      </div>

      <div
        data-testid="nomad-credential-preview"
        className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950 p-2"
        dangerouslySetInnerHTML={{ __html: svgMarkup }}
      />
    </section>
  );
};