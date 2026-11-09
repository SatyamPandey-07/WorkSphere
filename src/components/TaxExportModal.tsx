"use client";

import { useState, useEffect, useRef } from "react";
import { JobStatusTracker } from "@/components/JobStatusTracker";

export interface TaxExportModalProps {
  open: boolean;
  onClose: () => void;
  closeOnBackdropClick?: boolean;
}

const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 6 }, (_, i) => currentYear - i);

export default function TaxExportModal({
  open,
  onClose,
  closeOnBackdropClick = true,
}: TaxExportModalProps) {
  const [mode, setMode] = useState<"year" | "custom">("year");
  const [taxYear, setTaxYear] = useState(String(currentYear));
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [format, setFormat] = useState<"pdf" | "csv" | "xlsx">("pdf");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose, loading]);

  if (!open) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnBackdropClick && !loading && e.target === e.currentTarget) {
      onClose();
    }
  };

  async function handleExport() {
    setLoading(true);
    setError(null);
    setJobId(null);
    try {
      const body: Record<string, unknown> = { format };
      if (mode === "year") {
        body.taxYear = taxYear;
      } else {
        if (!startDate || !endDate) {
          if (isMountedRef.current) {
            setError("Please select both a start and end date");
            setLoading(false);
          }
          return;
        }
        if (new Date(startDate) > new Date(endDate)) {
          if (isMountedRef.current) {
            setError("Start date cannot be after end date");
            setLoading(false);
          }
          return;
        }
        body.startDate = startDate;
        body.endDate = endDate;
      }

      const res = await fetch("/api/bookings/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Export failed");
      }

      if (format === "csv" || format === "xlsx") {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `WorkSphere_Tax_Export.${format}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        if (isMountedRef.current) {
          onClose();
          setLoading(false);
        }
      } else {
        // PDF now returns a jobId
        const data = await res.json();
        if (isMountedRef.current) {
          setJobId(data.jobId || null);
          setLoading(false);
        }
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err.message || "Something went wrong");
        setLoading(false);
      }
    }
  }

  return (
    <div
      data-testid="tax-export-modal-backdrop"
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tax-export-title"
        data-testid="tax-export-modal"
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
      >
        <h2 id="tax-export-title" data-testid="tax-export-title" className="mb-4 text-lg font-semibold">
          Export Tax Summary
        </h2>

        <div className="mb-4 flex gap-2" role="group" aria-label="Export Mode">
          <button
            type="button"
            data-testid="tax-export-mode-year-btn"
            aria-pressed={mode === "year"}
            className={`flex-1 rounded px-3 py-2 text-sm ${mode === "year" ? "accent-bg text-white" : "bg-gray-100"}`}
            onClick={() => setMode("year")}
          >
            Tax Year
          </button>
          <button
            type="button"
            data-testid="tax-export-mode-custom-btn"
            aria-pressed={mode === "custom"}
            className={`flex-1 rounded px-3 py-2 text-sm ${mode === "custom" ? "accent-bg text-white" : "bg-gray-100"}`}
            onClick={() => setMode("custom")}
          >
            Custom Range
          </button>
        </div>

        {mode === "year" ? (
          <select
            data-testid="tax-export-year-select"
            aria-label="Select Tax Year"
            className="mb-4 w-full rounded border p-2"
            value={taxYear}
            onChange={(e) => setTaxYear(e.target.value)}
          >
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        ) : (
          <div className="mb-4 flex gap-2">
            <input
              type="date"
              data-testid="tax-export-start-date-input"
              aria-label="Start Date"
              className="w-full rounded border p-2"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <input
              type="date"
              data-testid="tax-export-end-date-input"
              aria-label="End Date"
              className="w-full rounded border p-2"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        )}

        <div className="mb-4 flex gap-2" role="group" aria-label="Export Format">
          <button
            type="button"
            data-testid="tax-export-format-pdf-btn"
            aria-pressed={format === "pdf"}
            className={`flex-1 rounded px-3 py-2 text-sm ${format === "pdf" ? "accent-bg text-white" : "bg-gray-100"}`}
            onClick={() => setFormat("pdf")}
          >
            PDF
          </button>
          <button
            type="button"
            data-testid="tax-export-format-csv-btn"
            aria-pressed={format === "csv"}
            className={`flex-1 rounded px-3 py-2 text-sm ${format === "csv" ? "accent-bg text-white" : "bg-gray-100"}`}
            onClick={() => setFormat("csv")}
          >
            CSV
          </button>
          <button
            type="button"
            data-testid="tax-export-format-xlsx-btn"
            aria-pressed={format === "xlsx"}
            className={`flex-1 rounded px-3 py-2 text-sm ${format === "xlsx" ? "accent-bg text-white" : "bg-gray-100"}`}
            onClick={() => setFormat("xlsx")}
          >
            Excel (.xlsx)
          </button>
        </div>

        {error && (
          <p
            role="alert"
            data-testid="tax-export-error-msg"
            className="mb-3 text-sm text-red-600"
          >
            {error}
          </p>
        )}

        {jobId ? (
          <div className="my-6" data-testid="tax-export-job-tracker">
            <JobStatusTracker jobId={jobId} />
          </div>
        ) : (
          <p className="mb-4 text-xs text-gray-500">
            Estimate only — $15/hr flat rate, 8% flat tax. Verify against your
            actual invoices before filing.
          </p>
        )}

        <div className="flex justify-end gap-2">
          {jobId ? (
            <button
              type="button"
              data-testid="tax-export-close-btn"
              className="rounded px-4 py-2 text-sm bg-gray-200 text-gray-800"
              onClick={onClose}
            >
              Close
            </button>
          ) : (
            <>
              <button
                type="button"
                data-testid="tax-export-cancel-btn"
                className="rounded px-4 py-2 text-sm text-gray-600"
                onClick={onClose}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="tax-export-submit-btn"
                className="rounded accent-bg px-4 py-2 text-sm text-white disabled:opacity-50"
                onClick={handleExport}
                disabled={loading}
              >
                {loading ? "Exporting..." : "Export"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
