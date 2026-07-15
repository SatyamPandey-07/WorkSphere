"use client";

import { useState } from "react";
import { JobStatusTracker } from "@/components/JobStatusTracker";

interface TaxExportModalProps {
  open: boolean;
  onClose: () => void;
}

const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 6 }, (_, i) => currentYear - i);

export default function TaxExportModal({ open, onClose }: TaxExportModalProps) {
  const [mode, setMode] = useState<"year" | "custom">("year");
  const [taxYear, setTaxYear] = useState(String(currentYear));
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [format, setFormat] = useState<"pdf" | "csv">("pdf");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  if (!open) return null;

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
          setError("Please select both a start and end date");
          setLoading(false);
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

      if (format === "csv") {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `WorkSphere_Tax_Export.${format}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        onClose();
        setLoading(false);
      } else {
        // PDF now returns a jobId
        const data = await res.json();
        setJobId(data.jobId);
        setLoading(false);
      }
    } catch (err: any) {
      setError(err.message || "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">Export Tax Summary</h2>

        <div className="mb-4 flex gap-2">
          <button
            className={`flex-1 rounded px-3 py-2 text-sm ${mode === "year" ? "bg-blue-600 text-white" : "bg-gray-100"}`}
            onClick={() => setMode("year")}
          >
            Tax Year
          </button>
          <button
            className={`flex-1 rounded px-3 py-2 text-sm ${mode === "custom" ? "bg-blue-600 text-white" : "bg-gray-100"}`}
            onClick={() => setMode("custom")}
          >
            Custom Range
          </button>
        </div>

        {mode === "year" ? (
          <select
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
              className="w-full rounded border p-2"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <input
              type="date"
              className="w-full rounded border p-2"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        )}

        <div className="mb-4 flex gap-2">
          <button
            className={`flex-1 rounded px-3 py-2 text-sm ${format === "pdf" ? "bg-blue-600 text-white" : "bg-gray-100"}`}
            onClick={() => setFormat("pdf")}
          >
            PDF
          </button>
          <button
            className={`flex-1 rounded px-3 py-2 text-sm ${format === "csv" ? "bg-blue-600 text-white" : "bg-gray-100"}`}
            onClick={() => setFormat("csv")}
          >
            CSV
          </button>
        </div>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        {jobId ? (
          <div className="my-6">
            <JobStatusTracker jobId={jobId} />
          </div>
        ) : (
          <p className="mb-4 text-xs text-gray-500">
            Estimate only — $15/hr flat rate, 8% flat tax. Verify against your actual invoices before filing.
          </p>
        )}

        <div className="flex justify-end gap-2">
          {jobId ? (
            <button
              className="rounded px-4 py-2 text-sm bg-gray-200 text-gray-800"
              onClick={onClose}
            >
              Close
            </button>
          ) : (
            <>
              <button
                className="rounded px-4 py-2 text-sm text-gray-600"
                onClick={onClose}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
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