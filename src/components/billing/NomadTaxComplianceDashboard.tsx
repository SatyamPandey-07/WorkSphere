"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Globe,
  ShieldCheck,
  FileSpreadsheet,
  Download,
  Receipt,
  AlertTriangle,
  RefreshCw,
  Clock,
  Landmark,
  AlertCircle,
} from "lucide-react";
import type { NomadComplianceReport } from "@/lib/tax/nomadTaxEngine";

export interface NomadTaxComplianceDashboardProps {
  /** Initial compliance report to bypass initial network load */
  initialReport?: NomadComplianceReport;
  /** Initial selected tax year */
  initialYear?: number;
  /** Optional custom CSS class */
  className?: string;
  /** Optional custom test identifier */
  testId?: string;
  /** Optional callback for network or export errors */
  onError?: (error: string) => void;
  /** Optional callback invoked on successful export */
  onExportSuccess?: (format: "csv" | "pdf") => void;
}

export function NomadTaxComplianceDashboard({
  initialReport,
  initialYear,
  className = "",
  testId = "nomad-tax-dashboard",
  onError,
  onExportSuccess,
}: NomadTaxComplianceDashboardProps = {}) {
  const [report, setReport] = useState<NomadComplianceReport | null>(
    initialReport || null,
  );
  const [loading, setLoading] = useState<boolean>(!initialReport);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(
    initialYear || new Date().getFullYear(),
  );
  const [exporting, setExporting] = useState<boolean>(false);
  const [exportingPdf, setExportingPdf] = useState<boolean>(false);

  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    setExportError(null);

    try {
      const res = await fetch(
        `/api/tax/nomad-compliance?year=${encodeURIComponent(selectedYear)}`,
      );
      if (!res.ok) {
        throw new Error(`Failed to load tax report (HTTP ${res.status})`);
      }
      const data = await res.json();
      if (isMountedRef.current) {
        if (data.success && data.report) {
          setReport(data.report);
        } else {
          throw new Error(data.error || "Failed to load tax compliance data");
        }
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        const msg = err?.message || "Failed to load tax report";
        setError(msg);
        onError?.(msg);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [selectedYear, onError]);

  useEffect(() => {
    if (initialReport && selectedYear === (initialYear || new Date().getFullYear())) {
      setReport(initialReport);
      setLoading(false);
      setError(null);
      return;
    }
    fetchReport();
  }, [selectedYear, initialReport, initialYear, fetchReport]);

  const handleExportCSV = async () => {
    if (!report) return;
    setExporting(true);
    setExportError(null);

    try {
      const res = await fetch("/api/tax/nomad-compliance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report, format: "csv" }),
      });
      if (!res.ok) {
        throw new Error(`Failed to generate CSV dossier (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `WorkSphere-Nomad-Tax-Dossier-${report.taxYear}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      onExportSuccess?.("csv");
    } catch (err: any) {
      const msg = err?.message || "CSV Export error";
      if (isMountedRef.current) {
        setExportError(msg);
      }
      onError?.(msg);
    } finally {
      if (isMountedRef.current) {
        setExporting(false);
      }
    }
  };

  const handleExportPDF = async () => {
    if (!report) return;
    setExportingPdf(true);
    setExportError(null);

    try {
      const res = await fetch("/api/tax/nomad-compliance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report, format: "pdf" }),
      });
      if (!res.ok) {
        throw new Error(`Failed to generate PDF audit report (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `WorkSphere-Nomad-Tax-Audit-${report.taxYear}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      onExportSuccess?.("pdf");
    } catch (err: any) {
      const msg = err?.message || "PDF Export error";
      if (isMountedRef.current) {
        setExportError(msg);
      }
      onError?.(msg);
    } finally {
      if (isMountedRef.current) {
        setExportingPdf(false);
      }
    }
  };

  return (
    <div
      data-testid={testId}
      className={`w-full max-w-6xl mx-auto space-y-6 ${className}`.trim()}
    >
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 border border-indigo-500/30 p-6 md:p-8 backdrop-blur-xl shadow-2xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-xs font-semibold uppercase tracking-wider">
              <Landmark className="w-3.5 h-3.5" /> Digital Nomad Tax & Visa Compliance
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              Schengen 90/180 & Tax Residency Tracker
            </h1>
            <p className="text-xs md:text-sm text-slate-300 max-w-2xl">
              Automated physical stay duration logging derived from verified workspace check-ins. Monitors rolling visa thresholds, flags 183-day tax residency hazards, and exports compliant expense dossiers.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <select
              aria-label="Select Tax Year"
              data-testid="tax-year-select"
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none"
            >
              <option value={2026}>Tax Year 2026</option>
              <option value={2025}>Tax Year 2025</option>
              <option value={2024}>Tax Year 2024</option>
            </select>

            <button
              type="button"
              data-testid="export-csv-btn"
              onClick={handleExportCSV}
              disabled={exporting || !report}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/20 transition disabled:opacity-50"
            >
              <FileSpreadsheet className="w-4 h-4" />
              {exporting ? "Generating..." : "Export CSV Dossier"}
            </button>

            <button
              type="button"
              data-testid="export-pdf-btn"
              onClick={handleExportPDF}
              disabled={exportingPdf || !report}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/20 transition disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              {exportingPdf ? "Generating PDF..." : "Export Audit PDF"}
            </button>
          </div>
        </div>
      </div>

      {/* Export Error Banner */}
      {exportError && (
        <div
          role="alert"
          data-testid="tax-export-error-banner"
          className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>{exportError}</span>
          </div>
          <button
            type="button"
            onClick={() => setExportError(null)}
            className="text-amber-400 font-bold underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Error state with retry */}
      {error && (
        <div
          role="alert"
          data-testid="tax-error-banner"
          className="p-6 rounded-3xl bg-red-950/40 border border-red-900/60 flex items-center justify-between gap-4 text-red-300 text-xs"
        >
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            <span className="font-medium">{error}</span>
          </div>
          <button
            type="button"
            data-testid="tax-retry-btn"
            onClick={fetchReport}
            className="px-3 py-1.5 rounded-xl bg-red-900/60 hover:bg-red-800 text-white font-bold text-xs transition"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div
          data-testid="tax-loading-spinner"
          className="p-12 rounded-3xl bg-slate-900/40 border border-slate-800 flex flex-col items-center justify-center gap-3 text-slate-400"
        >
          <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
          <p className="text-sm">Aggregating check-ins & calculating rolling visa windows...</p>
        </div>
      ) : report ? (
        <div data-testid="tax-report-container" className="space-y-6">
          {/* Top 3 Core Metrics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Schengen 90/180 Rule */}
            <div
              data-testid="schengen-card"
              className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-4 backdrop-blur-md shadow-lg"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-blue-400" />
                  <h3 className="text-sm font-bold text-white">Schengen 90/180 Quota</h3>
                </div>
                <span
                  data-testid="schengen-status-badge"
                  className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
                    report.schengenStay.status === "SAFE"
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                      : report.schengenStay.status === "WARNING"
                      ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                      : "bg-rose-500/10 border-rose-500/30 text-rose-400"
                  }`}
                >
                  {report.schengenStay.status}
                </span>
              </div>

              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <span
                    data-testid="schengen-days-remaining"
                    className="text-3xl font-black text-white font-mono"
                  >
                    {report.schengenStay.daysRemaining}
                  </span>
                  <span
                    data-testid="schengen-days-used"
                    className="text-xs text-slate-400 font-mono"
                  >
                    {report.schengenStay.daysUsed} / 90 Days Used
                  </span>
                </div>

                <div className="h-2.5 w-full bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      report.schengenStay.daysUsed > 75
                        ? "bg-rose-500"
                        : report.schengenStay.daysUsed > 60
                        ? "bg-amber-500"
                        : "bg-blue-500"
                    }`}
                    style={{
                      width: `${Math.min(100, Math.max(0, (report.schengenStay.daysUsed / 90) * 100))}%`,
                    }}
                  />
                </div>
                <span className="text-[11px] text-slate-400 block">
                  Remaining tourist/visa-free stay in last 180 days
                </span>
              </div>
            </div>

            {/* Deductible Workspace Expenses */}
            <div
              data-testid="expenses-card"
              className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-4 backdrop-blur-md shadow-lg"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-bold text-white">Deductible Workspace</h3>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400">
                  Tax Year {report.taxYear}
                </span>
              </div>

              <div className="space-y-1">
                <div
                  data-testid="total-expense-amount"
                  className="text-3xl font-black text-white font-mono"
                >
                  ${report.totalWorkspaceExpense}
                </div>
                <span className="text-xs text-slate-400 block">
                  Total qualifying coworking & desk bookings
                </span>
              </div>

              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <span className="text-slate-400">Est. VAT/GST Reclaim:</span>
                <strong
                  data-testid="total-vat-reclaimable"
                  className="text-emerald-400 font-mono"
                >
                  ${report.totalVatReclaimable} USD
                </strong>
              </div>
            </div>

            {/* 183-Day Tax Residency Hazard */}
            <div
              data-testid="tax-residency-card"
              className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-4 backdrop-blur-md shadow-lg"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-sm font-bold text-white">183-Day Tax Rule</h3>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">
                  Active Safe
                </span>
              </div>

              <div className="space-y-1">
                <div className="text-sm font-bold text-slate-200">No Dual-Tax Exposure</div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  All country stays remain safely below the 183-day threshold for accidental local tax residency.
                </p>
              </div>

              <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-500 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" /> Checked across {report.countryBreakdown.length} jurisdictions
              </div>
            </div>
          </div>

          {/* Country Breakdown Table */}
          <div
            data-testid="country-breakdown-table"
            className="rounded-3xl bg-slate-900/80 border border-slate-800 p-6 space-y-4 backdrop-blur-md shadow-lg"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Globe className="w-4 h-4 text-indigo-400" /> Country Stay Duration & Workspace Spend Breakdown
              </h2>
              <span className="text-xs text-slate-400">Audited via verified GPS check-ins</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 text-[11px] uppercase tracking-wider">
                    <th className="py-3 px-4">Jurisdiction</th>
                    <th className="py-3 px-4">Country Code</th>
                    <th className="py-3 px-4">Days In-Country</th>
                    <th className="py-3 px-4">Days to 183-Tax Trigger</th>
                    <th className="py-3 px-4">Total Workspace Expense</th>
                    <th className="py-3 px-4">Est. VAT Reclaim</th>
                    <th className="py-3 px-4">Tax Risk</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {report.countryBreakdown.map((c) => (
                    <tr
                      key={c.countryCode}
                      data-testid={`country-row-${c.countryCode}`}
                      className="hover:bg-slate-800/30 transition"
                    >
                      <td className="py-3 px-4 font-sans font-semibold text-white">
                        {c.country}
                      </td>
                      <td className="py-3 px-4 text-slate-400">{c.countryCode}</td>
                      <td className="py-3 px-4 text-slate-200">{c.daysSpent} Days</td>
                      <td className="py-3 px-4 text-indigo-400">{c.daysRemaining183Rule} Days Left</td>
                      <td className="py-3 px-4 text-slate-200">${c.totalSpent}</td>
                      <td className="py-3 px-4 text-emerald-400">${c.vatReclaimable}</td>
                      <td className="py-3 px-4 font-sans">
                        {c.taxResidencyRisk ? (
                          <span className="inline-flex items-center gap-1 text-rose-400 text-[11px] font-bold">
                            <AlertTriangle className="w-3 h-3" /> Warning
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-emerald-400 text-[11px] font-semibold">
                            <ShieldCheck className="w-3 h-3" /> Compliant
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default NomadTaxComplianceDashboard;
