"use client";

import React, { useState, useRef, useCallback } from "react";
import { Download, AlertCircle, FileSpreadsheet, FileCode, CheckCircle2 } from "lucide-react";
import { WebVitalsWidget } from "./WebVitalsWidget";
import { RouteLatencyHeatmap } from "./RouteLatencyHeatmap";

export type ExportWindow = "24h" | "7d" | "30d";
export type ExportFormat = "csv" | "json";

export interface VitalsDashboardProps {
  className?: string;
  defaultWindow?: ExportWindow;
  showHeatmap?: boolean;
  showWebVitals?: boolean;
}

export function VitalsDashboard({
  className = "",
  defaultWindow = "24h",
  showHeatmap = true,
  showWebVitals = true,
}: VitalsDashboardProps) {
  const [selectedWindow, setSelectedWindow] = useState<ExportWindow>(defaultWindow);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [isExportingJson, setIsExportingJson] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  const activeExportRef = useRef(false);

  const triggerDownload = useCallback((blob: Blob, filename: string) => {
    if (typeof window === "undefined") return;
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.setAttribute("aria-hidden", "true");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }, []);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      if (activeExportRef.current) return;
      activeExportRef.current = true;
      setExportError(null);
      setExportSuccess(null);

      if (format === "csv") {
        setIsExportingCsv(true);
      } else {
        setIsExportingJson(true);
      }

      try {
        const endpoint = `/api/admin/vitals/export?format=${format}&window=${selectedWindow}`;
        const response = await fetch(endpoint, {
          method: "GET",
          headers: {
            Accept: format === "csv" ? "text/csv" : "application/json",
          },
          cache: "no-store",
        });

        if (!response.ok) {
          let errorMessage = `Export failed with status ${response.status}`;
          try {
            const errJson = await response.json();
            if (errJson?.error) errorMessage = errJson.error;
          } catch {
            // Use fallback message
          }
          throw new Error(errorMessage);
        }

        const blob = await response.blob();
        const filename =
          format === "csv"
            ? "route-latency-vitals.csv"
            : `route-latency-vitals-${selectedWindow}.json`;

        triggerDownload(blob, filename);
        setExportSuccess(
          `Successfully exported telemetry heatmap as ${format.toUpperCase()} (${selectedWindow})`,
        );
      } catch (err: any) {
        console.error("[VitalsDashboard] Export error:", err);
        setExportError(err?.message || "Failed to export vitals data. Please try again.");
      } finally {
        activeExportRef.current = false;
        setIsExportingCsv(false);
        setIsExportingJson(false);
      }
    },
    [selectedWindow, triggerDownload],
  );

  return (
    <div
      data-testid="vitals-dashboard"
      className={`space-y-6 rounded-2xl bg-zinc-950 p-6 text-white border border-zinc-800 ${className}`}
    >
      {/* Dashboard Top Header & Export Toolbar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-zinc-800/80 pb-5">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-zinc-100 flex items-center gap-2">
            Route Latency & Vitals Telemetry
          </h2>
          <p className="text-sm text-zinc-400 mt-1">
            Real-time route latency percentiles, error rates, and Web Vitals telemetry aggregation.
          </p>
        </div>

        {/* Export Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Time Window Selector */}
          <div className="flex items-center rounded-xl bg-zinc-900 p-1 border border-zinc-800">
            {(["24h", "7d", "30d"] as ExportWindow[]).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setSelectedWindow(w)}
                data-testid={`window-select-${w}`}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  selectedWindow === w
                    ? "bg-violet-600 text-white shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {w}
              </button>
            ))}
          </div>

          {/* Export CSV Button */}
          <button
            type="button"
            data-testid="export-csv-btn"
            disabled={isExportingCsv || isExportingJson}
            onClick={() => handleExport("csv")}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800 hover:text-white disabled:opacity-50"
            title="Export route latency heatmap metrics as CSV"
            aria-label="Export CSV"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
            <span>{isExportingCsv ? "Exporting CSV..." : "Export CSV"}</span>
          </button>

          {/* Export JSON Button */}
          <button
            type="button"
            data-testid="export-json-btn"
            disabled={isExportingCsv || isExportingJson}
            onClick={() => handleExport("json")}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800 hover:text-white disabled:opacity-50"
            title="Export route latency heatmap metrics as JSON"
            aria-label="Export JSON"
          >
            <FileCode className="h-4 w-4 text-violet-400" />
            <span>{isExportingJson ? "Exporting JSON..." : "Export JSON"}</span>
          </button>
        </div>
      </div>

      {/* Alert Notices */}
      {exportError && (
        <div
          role="alert"
          data-testid="export-error-notice"
          className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{exportError}</span>
        </div>
      )}

      {exportSuccess && (
        <div
          role="status"
          data-testid="export-success-notice"
          className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{exportSuccess}</span>
        </div>
      )}

      {/* Heatmap & WebVitals Sections */}
      {showHeatmap && (
        <div className="pt-2">
          <RouteLatencyHeatmap initialRange={selectedWindow === "30d" || selectedWindow === "7d" ? "7d" : "24h"} />
        </div>
      )}

      {showWebVitals && (
        <div className="pt-2">
          <WebVitalsWidget initialRange={selectedWindow} />
        </div>
      )}
    </div>
  );
}

export default VitalsDashboard;
