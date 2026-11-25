'use client';

import React, { useMemo } from 'react';
import {
  buildCertificateFilename,
  downloadCertificateSvg,
  generateCertificateSvg,
  type NomadCertificateData,
} from '@/lib/pdf/generateCertificateSvg';

export interface NomadCertificateModalProps {
  isOpen: boolean;
  onClose: () => void;
  certificate: NomadCertificateData;
  onDownloadPdf?: (certificate: NomadCertificateData) => void;
}

export const NomadCertificateModal: React.FC<NomadCertificateModalProps> = ({
  isOpen,
  onClose,
  certificate,
  onDownloadPdf,
}) => {
  const svgMarkup = useMemo(
    () => generateCertificateSvg(certificate),
    [certificate]
  );

  if (!isOpen) return null;

  const svgFilename = buildCertificateFilename(certificate.bookingId);

  const handleDownloadSvg = () => {
    downloadCertificateSvg(certificate);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Nomad Attendance Certificate"
      data-testid="nomad-certificate-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
    >
      <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Nomad Attendance Certificate
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Booking #{certificate.bookingId} · {certificate.venueName}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close certificate modal"
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </div>

        <div
          data-testid="certificate-svg-preview"
          className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-950"
          dangerouslySetInnerHTML={{ __html: svgMarkup }}
        />

        <div className="mt-4 rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
          <span className="font-semibold">Verified Hash:</span>{' '}
          <span data-testid="certificate-hash-text" className="font-mono break-all">
            {certificate.verificationHash}
          </span>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2.5">
          {onDownloadPdf && (
            <button
              type="button"
              onClick={() => onDownloadPdf(certificate)}
              data-testid="download-certificate-pdf-btn"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              Download PDF
            </button>
          )}

          <button
            type="button"
            onClick={handleDownloadSvg}
            data-testid="download-certificate-svg-btn"
            aria-label={`Download SVG (${svgFilename})`}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-indigo-700"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
            >
              <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
              <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
            </svg>
            <span>Download SVG</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default NomadCertificateModal;
