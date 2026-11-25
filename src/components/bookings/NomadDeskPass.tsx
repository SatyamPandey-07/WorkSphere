'use client';
import React from 'react';
export interface NomadDeskPassProps { venueName: string; confirmationId: string; seatLabel?: string; dateLabel?: string; onDownloadPng?: (filename: string, dataUrl: string) => void; }
export function sanitizeFilenameSegment(raw: string | null | undefined, fallback = 'pass'): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[\/\\:*?"<>|]+/g, '-').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 64);
  return cleaned.length > 0 ? cleaned : fallback;
}
export function buildDeskPassPngFilename(venueName: string | null | undefined, confirmationId: string | null | undefined): string { return `nomad-desk-pass-${sanitizeFilenameSegment(venueName, 'worksphere-venue')}-${sanitizeFilenameSegment(confirmationId, 'pass')}.png`; }
export const NomadDeskPass: React.FC<NomadDeskPassProps> = ({ venueName, confirmationId, seatLabel = 'Hot Desk', dateLabel = 'Today', onDownloadPng }) => {
  const filename = buildDeskPassPngFilename(venueName, confirmationId);
  const handleDownload = () => {
    const dataUrl = `data:image/png;base64,${Buffer.from(encodeURIComponent(`NomadDeskPass:${venueName}:${confirmationId}`), 'utf8').toString('base64')}`;
    if (onDownloadPng) { onDownloadPng(filename, dataUrl); return; }
    if (typeof document !== 'undefined') { const a = document.createElement('a'); a.href = dataUrl; a.download = filename; a.click(); }
  };
  return (
    <section data-testid="nomad-desk-pass" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{venueName || 'Workspace Venue'}</h3><p className="text-xs text-slate-500 dark:text-slate-400">Pass #{confirmationId || 'N/A'} · {seatLabel} · {dateLabel}</p></div>
        <button type="button" data-testid="download-pass-png-btn" onClick={handleDownload} className="rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700">Download PNG</button>
      </div>
    </section>
  );
};
export default NomadDeskPass;
