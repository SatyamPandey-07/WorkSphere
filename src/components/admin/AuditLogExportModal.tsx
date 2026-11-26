"use client";

import { useState, useEffect, useRef } from "react";

export interface AuditLogExportModalProps {
  open: boolean;
  onClose: () => void;
  venueId: string;
  closeOnBackdropClick?: boolean;
}

export type QuickSelectPreset = "24h" | "7d" | "30d" | "custom";

export default function AuditLogExportModal({
  open,
  onClose,
  venueId,
  closeOnBackdropClick = true,
}: AuditLogExportModalProps) {
  const [preset, setPreset] = useState<QuickSelectPreset>("7d");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [format, setFormat] = useState<"csv" | "pdf">("csv");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(true);

  // Set initial preset dates on mount or when opening
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const applyPreset = (selectedPreset: QuickSelectPreset) => {
    setPreset(selectedPreset);
    setError(null);

    if (selectedPreset === "custom") {
      return;
    }

    const now = new Date();
    let start: Date;

    if (selectedPreset === "24h") {
      start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    } else if (selectedPreset === "7d") {
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (selectedPreset === "30d") {
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else {
      return;
    }

    setStartDate(start.toISOString().slice(0, 16));
    setEndDate(now.toISOString().slice(0, 16));
  };

  useEffect(() => {
    if (open) {
      applyPreset("7d");
      setError(null);
    }
  }, [open]);

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

  const validateRange = (): { valid: boolean; startIso?: string; endIso?: string; error?: string } => {
    if (!startDate || !endDate) {
      return { valid: false, error: "Please select both a start date and an end date." };
    }

    const startObj = new Date(startDate);
    const endObj = new Date(endDate);

    if (isNaN(startObj.getTime()) || isNaN(endObj.getTime())) {
      return { valid: false, error: "Please provide valid dates." };
    }

    if (startObj.getTime() >= endObj.getTime()) {
      return { valid: false, error: "Start date must be strictly before end date." };
    }

    const diffDays = (endObj.getTime() - startObj.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > 90) {
      return { valid: false, error: "Date range cannot exceed 90 days." };
    }

    return {
      valid: true,
      startIso: startObj.toISOString(),
      endIso: endObj.toISOString(),
    };
  };

  async function handleExport() {
    setError(null);

    const validation = validateRange();
    if (!validation.valid) {
      setError(validation.error || "Invalid date range");
      return;
    }

    setLoading(true);

    try {
      const params = new URLSearchParams({
        format,
        startDate: validation.startIso!,
        endDate: validation.endIso!,
      });

      const res = await fetch(`/api/admin/venues/${encodeURIComponent(venueId)}/export?${params.toString()}`);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Export failed");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `venue-${venueId}-audit.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      if (isMountedRef.current) {
        setLoading(false);
        onClose();
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err.message || "Failed to download audit export");
        setLoading(false);
      }
    }
  }

  return (
    <div
      data-testid="audit-log-export-modal-backdrop"
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-export-title"
        data-testid="audit-log-export-modal"
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800 dark:text-white"
      >
        <h2
          id="audit-export-title"
          data-testid="audit-export-title"
          className="mb-4 text-lg font-semibold text-gray-900 dark:text-white"
        >
          Export Audit Logs
        </h2>

        {/* Quick select presets */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
            Date Range Preset
          </label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Date Range Presets">
            <button
              type="button"
              data-testid="preset-24h"
              aria-pressed={preset === "24h"}
              onClick={() => applyPreset("24h")}
              className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                preset === "24h"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200"
              }`}
            >
              Last 24 Hours
            </button>
            <button
              type="button"
              data-testid="preset-7d"
              aria-pressed={preset === "7d"}
              onClick={() => applyPreset("7d")}
              className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                preset === "7d"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200"
              }`}
            >
              Last 7 Days
            </button>
            <button
              type="button"
              data-testid="preset-30d"
              aria-pressed={preset === "30d"}
              onClick={() => applyPreset("30d")}
              className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                preset === "30d"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200"
              }`}
            >
              Last 30 Days
            </button>
            <button
              type="button"
              data-testid="preset-custom"
              aria-pressed={preset === "custom"}
              onClick={() => applyPreset("custom")}
              className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                preset === "custom"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200"
              }`}
            >
              Custom Range
            </button>
          </div>
        </div>

        {/* Date inputs */}
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="audit-start-date"
              className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              Start Date
            </label>
            <input
              id="audit-start-date"
              data-testid="audit-start-date"
              type="datetime-local"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPreset("custom");
              }}
              className="w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
          </div>
          <div>
            <label
              htmlFor="audit-end-date"
              className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              End Date
            </label>
            <input
              id="audit-end-date"
              data-testid="audit-end-date"
              type="datetime-local"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPreset("custom");
              }}
              className="w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
          </div>
        </div>

        {/* Format select */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
            Export Format
          </label>
          <div className="flex gap-4">
            <label className="inline-flex items-center text-sm">
              <input
                type="radio"
                name="audit-format"
                value="csv"
                checked={format === "csv"}
                onChange={() => setFormat("csv")}
                className="mr-2 text-blue-600 focus:ring-blue-500"
              />
              CSV (Spreadsheet)
            </label>
            <label className="inline-flex items-center text-sm">
              <input
                type="radio"
                name="audit-format"
                value="pdf"
                checked={format === "pdf"}
                onChange={() => setFormat("pdf")}
                className="mr-2 text-blue-600 focus:ring-blue-500"
              />
              PDF Document
            </label>
          </div>
        </div>

        {/* Error alert */}
        {error && (
          <div
            role="alert"
            data-testid="audit-export-error"
            className="mb-4 rounded bg-red-50 p-2.5 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400"
          >
            {error}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="audit-export-cancel-btn"
            onClick={onClose}
            disabled={loading}
            className="rounded px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="audit-export-submit-btn"
            onClick={handleExport}
            disabled={loading}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Exporting..." : "Download Export"}
          </button>
        </div>
      </div>
    </div>
  );
}
