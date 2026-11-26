"use client";

import React, { useState, useId } from "react";
import {
  Volume2,
  FileSpreadsheet,
  FileCode,
  Check,
  AlertCircle,
  Activity,
  Layers,
} from "lucide-react";
import {
  downloadNoiseMetricsJSON,
  downloadNoiseMetricsCSV,
  type NoiseTelemetryRecord,
} from "@/lib/export/noiseMetricsExport";

export interface NoiseMetricsPanelProps {
  venueId: string;
  venueName?: string;
  records?: NoiseTelemetryRecord[];
  isLoading?: boolean;
  onExportSuccess?: (format: "json" | "csv", filename?: string) => void;
  onExportError?: (error: Error) => void;
  className?: string;
  "data-testid"?: string;
}

export function NoiseMetricsPanel({
  venueId,
  venueName = "Venue",
  records = [],
  isLoading = false,
  onExportSuccess,
  onExportError,
  className = "",
  "data-testid": testId = "noise-metrics-panel",
}: NoiseMetricsPanelProps) {
  const panelHeadingId = useId();
  const [downloadedFormat, setDownloadedFormat] = useState<"json" | "csv" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const safeRecords = React.useMemo(
    () => (Array.isArray(records) ? records : []),
    [records]
  );
  const hasRecords = safeRecords.length > 0;

  const handleExportJSON = () => {
    setErrorMessage(null);
    if (!hasRecords) {
      const err = new Error("No telemetry records available to export.");
      setErrorMessage(err.message);
      onExportError?.(err);
      return;
    }

    try {
      const success = downloadNoiseMetricsJSON(venueId, safeRecords);
      if (success) {
        setDownloadedFormat("json");
        onExportSuccess?.("json");
        setTimeout(() => setDownloadedFormat(null), 2500);
      } else {
        throw new Error("Failed to generate JSON export.");
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      setErrorMessage(error.message);
      onExportError?.(error);
    }
  };

  const handleExportCSV = () => {
    setErrorMessage(null);
    if (!hasRecords) {
      const err = new Error("No telemetry records available to export.");
      setErrorMessage(err.message);
      onExportError?.(err);
      return;
    }

    try {
      const success = downloadNoiseMetricsCSV(venueId, safeRecords);
      if (success) {
        setDownloadedFormat("csv");
        onExportSuccess?.("csv");
        setTimeout(() => setDownloadedFormat(null), 2500);
      } else {
        throw new Error("Failed to generate CSV export.");
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      setErrorMessage(error.message);
      onExportError?.(error);
    }
  };

  // Compute summary stats if records available
  const stats = React.useMemo(() => {
    if (!hasRecords) return null;
    const decibelValues = safeRecords
      .map((r) => (r.decibels !== undefined ? r.decibels : r.avgDecibels))
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

    const peakFreqValues = safeRecords
      .map((r) => (r.peakFrequencyHz !== undefined ? r.peakFrequencyHz : r.peakFrequency))
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

    const avgDb =
      decibelValues.length > 0
        ? Math.round(
            (decibelValues.reduce((sum, v) => sum + v, 0) / decibelValues.length) * 10
          ) / 10
        : null;

    const maxDb =
      decibelValues.length > 0 ? Math.max(...decibelValues) : null;

    const dominantFreq =
      peakFreqValues.length > 0
        ? Math.round(
            peakFreqValues.reduce((sum, v) => sum + v, 0) / peakFreqValues.length
          )
        : null;

    return { avgDb, maxDb, dominantFreq, count: safeRecords.length };
  }, [safeRecords, hasRecords]);

  return (
    <section
      data-testid={testId}
      aria-labelledby={panelHeadingId}
      className={`rounded-2xl border border-white/10 bg-black/20 p-5 text-white backdrop-blur-md shadow-sm transition-all ${className}`}
    >
      {/* Header and Controls Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Volume2 className="w-5 h-5 text-pink-400" aria-hidden="true" />
            <h3
              id={panelHeadingId}
              className="text-base sm:text-lg font-bold text-white tracking-wide"
            >
              Noise Analytics & Telemetry
            </h3>
          </div>
          <p className="text-xs text-zinc-400">
            Acoustic sensor metrics, decibel distributions, and telemetry logs for {venueName}.
          </p>
        </div>

        {/* Export Controls Toolbar */}
        <div
          role="toolbar"
          aria-label="Export options"
          className="flex items-center gap-2.5 self-start sm:self-auto"
        >
          {/* Export CSV Button */}
          <button
            type="button"
            data-testid="export-noise-metrics-csv-btn"
            disabled={isLoading || !hasRecords}
            onClick={handleExportCSV}
            aria-label="Export noise metrics as CSV"
            title={
              !hasRecords
                ? "No telemetry records to export"
                : `Export ${safeRecords.length} noise records as CSV`
            }
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-black/20 px-3.5 py-2 text-xs font-bold uppercase tracking-wider text-zinc-200 transition-all hover:bg-black/40 hover:border-white/20 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            {downloadedFormat === "csv" ? (
              <>
                <Check className="w-3.5 h-3.5 text-green-400" aria-hidden="true" />
                <span className="text-green-400">Exported</span>
              </>
            ) : (
              <>
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                <span>Export CSV</span>
              </>
            )}
          </button>

          {/* Export JSON Button */}
          <button
            type="button"
            data-testid="export-noise-metrics-json-btn"
            disabled={isLoading || !hasRecords}
            onClick={handleExportJSON}
            aria-label="Export noise metrics as JSON"
            title={
              !hasRecords
                ? "No telemetry records to export"
                : `Export ${safeRecords.length} noise records as JSON`
            }
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-black/20 px-3.5 py-2 text-xs font-bold uppercase tracking-wider text-zinc-200 transition-all hover:bg-black/40 hover:border-white/20 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-pink-500/50"
          >
            {downloadedFormat === "json" ? (
              <>
                <Check className="w-3.5 h-3.5 text-green-400" aria-hidden="true" />
                <span className="text-green-400">Exported</span>
              </>
            ) : (
              <>
                <FileCode className="w-3.5 h-3.5 text-pink-400" aria-hidden="true" />
                <span>Export JSON</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* User Feedback Alert on Error */}
      {errorMessage && (
        <div
          role="alert"
          data-testid="export-error-notice"
          className="mt-4 flex items-center gap-2 p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-xs text-rose-300 font-medium"
        >
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Content Area: Loading, Empty, or Telemetry Stats */}
      {isLoading ? (
        <div
          role="status"
          aria-label="Loading telemetry records"
          data-testid="noise-metrics-loading"
          className="py-8 text-center text-xs text-zinc-400 animate-pulse"
        >
          Loading noise metrics telemetry…
        </div>
      ) : !hasRecords ? (
        <div
          role="status"
          aria-live="polite"
          data-testid="noise-metrics-empty-state"
          className="py-8 text-center"
        >
          <Volume2 className="w-8 h-8 text-zinc-600 mx-auto mb-2" aria-hidden="true" />
          <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
            No Telemetry Records Available
          </p>
          <p className="text-[11px] text-zinc-500 mt-1 max-w-sm mx-auto">
            Acoustic decibel readings and peak frequency records will appear here once recorded.
          </p>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="telemetry-stats-grid">
          <div className="p-3.5 rounded-xl bg-black/30 border border-white/5 flex flex-col">
            <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1 flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-pink-400" aria-hidden="true" />
              Avg Sound Level
            </span>
            <span className="text-lg font-bold text-white">
              {stats?.avgDb !== null ? `${stats?.avgDb} dB` : "—"}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-black/30 border border-white/5 flex flex-col">
            <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1 flex items-center gap-1.5">
              <Volume2 className="w-3 h-3 text-orange-400" aria-hidden="true" />
              Peak Sound Level
            </span>
            <span className="text-lg font-bold text-white">
              {stats?.maxDb !== null ? `${stats?.maxDb} dB` : "—"}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-black/30 border border-white/5 flex flex-col">
            <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1 flex items-center gap-1.5">
              <Layers className="w-3 h-3 text-cyan-400" aria-hidden="true" />
              Dominant Freq
            </span>
            <span className="text-lg font-bold text-white">
              {stats?.dominantFreq !== null ? `${stats?.dominantFreq} Hz` : "—"}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-black/30 border border-white/5 flex flex-col">
            <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1">
              Sample Count
            </span>
            <span className="text-lg font-bold text-white">
              {stats?.count ?? 0}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

export default NoiseMetricsPanel;
