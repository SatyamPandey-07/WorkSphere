"use client";

import React, { useState, useEffect } from "react";
import {
  Leaf,
  TreePine,
  Footprints,
  Bike,
  Train,
  Car,
  FileSpreadsheet,
  CheckCircle2,
  Sparkles,
  Award,
  RefreshCw,
  TrendingDown,
  Sun,
  Globe,
  MapPin,
  AlertCircle,
} from "lucide-react";
import {
  CarbonFootprintSummary,
  CommuteMode,
  safeParseDistance,
} from "@/lib/sustainability/carbonEngine";
import { LanternPowerRing } from "./LanternPowerRing";

export default function CarbonFootprintTracker() {

  const [summary, setSummary] = useState<CarbonFootprintSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCarbonAnalytics = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analytics/carbon-footprint");
      const data = await res.json();
      if (res.ok && data.success) {
        setSummary(data.summary);
      } else {
        setError(data.error || "Failed to load carbon footprint analytics.");
      }
    } catch (err) {
      console.error("Failed to load carbon analytics:", err);
      setError("Unable to connect to carbon analytics service.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCarbonAnalytics();
  }, []);

  const handleExportESG = async () => {
    if (!summary) return;
    setExporting(true);
    try {
      const res = await fetch("/api/analytics/carbon-footprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary, format: "csv" }),
      });
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `WorkSphere-Scope3-ESG-Report-${summary.periodMonth.replace(" ", "-")}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export error:", err);
    } finally {
      setExporting(false);
    }
  };

  const handleExportCSV = () => {
    if (!summary?.records.length) return;

    const headers = [
      "Date",
      "Venue",
      "Commute Mode",
      "Distance (km)",
      "CO2 (kg)",
      "Offset Status",
    ];
    const escapeCsvValue = (value: string | number) => {
      const csvValue =
        typeof value === "string" && /^[\t\r ]*[=+\-@]/.test(value)
          ? `'${value}`
          : String(value);
      return `"${csvValue.replace(/"/g, '""')}"`;
    };
    const rows = summary.records.map((record) => [
      record.date,
      record.venueName,
      record.commuteMode,
      safeParseDistance(record.distanceKm).toFixed(1),
      (safeParseDistance(record.emissionsGramsCo2) / 1000).toFixed(3),
      record.isGreenCertifiedVenue ? "Offset" : "Not offset",
    ]);
    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map(escapeCsvValue).join(",")),
    ].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");

    anchor.href = url;
    anchor.download = `worksphere-carbon-report-${now.getFullYear()}-${month}.csv`;
    try {
      document.body.appendChild(anchor);
      anchor.click();
    } finally {
      anchor.remove();
      window.URL.revokeObjectURL(url);
    }
  };

  const getModeIcon = (mode: CommuteMode) => {
    switch (mode) {
      case "WALKING":
        return <Footprints className="w-4 h-4 text-emerald-400" />;
      case "BICYCLING":
        return <Bike className="w-4 h-4 text-cyan-400" />;
      case "PUBLIC_TRANSIT":
        return <Train className="w-4 h-4 text-blue-400" />;
      case "ELECTRIC_VEHICLE":
        return <Sparkles className="w-4 h-4 text-teal-400" />;
      case "GASOLINE_CAR":
      default:
        return <Car className="w-4 h-4 text-slate-400" />;
    }
  };

  const totalDistance = summary ? safeParseDistance(summary.totalDistanceKm) : 0;
  const missingDistanceRecordsCount = summary
    ? summary.records.filter((r) => safeParseDistance(r.distanceKm) === 0).length
    : 0;
  const isMissingCommuteDistance = Boolean(
    summary && (totalDistance === 0 || summary.records.length === 0)
  );
  const hasPartialMissingDistance = Boolean(
    summary && totalDistance > 0 && missingDistanceRecordsCount > 0
  );

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6">
      {/* Top Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-emerald-950/40 to-slate-900 border border-emerald-500/30 p-6 md:p-8 backdrop-blur-xl shadow-2xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold uppercase tracking-wider">
              <Leaf className="w-3.5 h-3.5" /> Scope 3 ESG Sustainability
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              Remote Work Carbon Footprint & Eco-Tracker
            </h1>
            <p className="text-xs md:text-sm text-slate-300 max-w-2xl">
              Track commuter CO₂ emissions across walking, cycling, and transit. Certify green workspace visits and export corporate Scope 3 ESG carbon audit reports.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-4 shrink-0">
            {/* Green Lantern Willpower Power Ring Widget */}
            <div className="flex items-center gap-3 p-2.5 rounded-2xl bg-emerald-950/30 border border-emerald-500/20 backdrop-blur-md">
              <LanternPowerRing
                size="md"
                tooltipPlacement="bottom"
                data-testid="carbon-lantern-power-ring"
              />
              <div className="text-left pr-1">
                <span className="block text-[10px] font-mono font-semibold uppercase text-emerald-400/80 tracking-wider">
                  Willpower Ring
                </span>
                <span className="text-xs font-bold text-white">
                  Battery Status
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleExportCSV}
                disabled={!summary?.records.length}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-emerald-500/40 bg-slate-900/70 hover:bg-slate-800 text-emerald-200 text-xs font-bold transition disabled:opacity-50"
              >
                <FileSpreadsheet className="w-4 h-4" />
                Export CSV
              </button>
              <button
                onClick={handleExportESG}
                disabled={exporting || !summary}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/30 transition disabled:opacity-50"
              >
                <FileSpreadsheet className="w-4 h-4" />
                {exporting ? "Generating..." : "Export Scope 3 ESG CSV"}
              </button>
            </div>
          </div>
        </div>
      </div>


      {/* API / Connectivity Error Banner */}
      {error && !loading && (
        <div
          data-testid="carbon-fetch-error"
          className="p-4 sm:p-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 text-rose-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 backdrop-blur-md"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400 shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <p className="text-xs text-rose-200 font-medium">{error}</p>
          </div>
          <button
            onClick={fetchCarbonAnalytics}
            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-rose-500 hover:bg-rose-400 text-white transition shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Partial Missing Commute Distance Notice */}
      {hasPartialMissingDistance && !loading && !error && (
        <div
          data-testid="partial-missing-commute-distance-prompt"
          className="p-4 rounded-2xl border border-sky-500/30 bg-sky-500/10 text-sky-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 backdrop-blur-md"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-sky-500/20 text-sky-400 shrink-0">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-sky-200">
                {missingDistanceRecordsCount} commute {missingDistanceRecordsCount === 1 ? "record has" : "records have"} uncalculated distance
              </h4>
              <p className="text-xs text-sky-300/80 mt-0.5">
                Some workspace check-ins are missing transit distance. Configure default commute origin in settings for full Scope 3 coverage.
              </p>
            </div>
          </div>
          <a
            href="/settings"
            className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-950 bg-sky-400 hover:bg-sky-300 transition shrink-0"
          >
            Update Location
          </a>
        </div>
      )}

      {/* All Missing Commute Distance Gentle Prompt */}
      {isMissingCommuteDistance && !loading && !error && (
        <div
          data-testid="missing-commute-distance-prompt"
          className="p-4 sm:p-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 backdrop-blur-md"
        >
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 shrink-0">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-amber-200">
                No home location or commute distance recorded
              </h4>
              <p className="text-xs text-amber-300/80 mt-0.5">
                Set your home location and primary transit mode to automatically calculate your carbon savings for workspace check-ins.
              </p>
            </div>
          </div>

          <a
            href="/settings"
            className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 transition shrink-0"
          >
            Set Transit Mode
          </a>
        </div>
      )}

      {loading ? (
        <div className="p-12 rounded-3xl bg-slate-900/40 border border-slate-800 flex flex-col items-center justify-center gap-3 text-slate-400">
          <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
          <p className="text-sm">Calculating multimodal transit emissions and tree offset equivalencies...</p>
        </div>
      ) : summary ? (
        <div className="space-y-6">
          {/* Top 3 Core Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Avoided Emissions */}
            <div className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-2 backdrop-blur-md shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingDown className="w-4 h-4" /> Avoided Emissions
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300">
                  vs Driving
                </span>
              </div>
              <div className="text-3xl font-black text-emerald-400 font-mono">
                {safeParseDistance(summary.totalAvoidedKgCo2).toFixed(2)}{" "}
                <span className="text-sm text-slate-300">kg CO₂</span>
              </div>
              <p className="text-[11px] text-slate-400">Saved by choosing low-carbon transit & walking</p>
            </div>

            {/* Trees Offset Equivalency */}
            <div className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-2 backdrop-blur-md shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-teal-400 uppercase tracking-wider flex items-center gap-1.5">
                  <TreePine className="w-4 h-4" /> Tree Equivalency
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-teal-500/10 text-teal-300">
                  {summary.periodMonth}
                </span>
              </div>
              <div className="text-3xl font-black text-white font-mono">
                🌲 {safeParseDistance(summary.treesEquivalentOffset).toFixed(1)}{" "}
                <span className="text-sm text-slate-300">Trees</span>
              </div>
              <p className="text-[11px] text-slate-400">Monthly carbon absorption equivalent</p>
            </div>

            {/* Eco Workspace Visits */}
            <div className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-2 backdrop-blur-md shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Sun className="w-4 h-4" /> Green Certified Hubs
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300">
                  Solar / Zero Waste
                </span>
              </div>
              <div className="text-3xl font-black text-white font-mono">
                {summary.greenVenuesVisitedCount}{" "}
                <span className="text-sm text-slate-300">Visits</span>
              </div>
              <p className="text-[11px] text-slate-400">Workspaces powered by verified green grids</p>
            </div>
          </div>

          {/* Multimodal Commute Breakdown Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Mode Breakdown Bars (7 cols) */}
            <div className="lg:col-span-7 rounded-3xl bg-slate-900/80 border border-slate-800 p-6 space-y-4 backdrop-blur-md shadow-lg">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Globe className="w-4 h-4 text-emerald-400" /> Commute Distance & Emissions by Mode
              </h2>

              <div className="space-y-3 pt-2">
                {summary.modeBreakdown.map((item) => {
                  const safeDist = safeParseDistance(item.distanceKm);
                  const safeEmissions = safeParseDistance(item.emissionsKgCo2);

                  return (
                    <div
                      key={item.mode}
                      className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 font-semibold text-white">
                          {getModeIcon(item.mode)}
                          <span>{item.label}</span>
                        </div>
                        <span className="font-mono text-slate-300">
                          {safeDist.toFixed(1)} km ({item.percentage}%)
                        </span>
                      </div>

                      <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400"
                          style={{ width: `${item.percentage}%` }}
                        />
                      </div>

                      <div className="flex justify-between text-[10px] font-mono text-slate-500">
                        <span>Emissions: {safeEmissions.toFixed(2)} kg CO₂</span>
                        <span>
                          {item.mode === "WALKING" || item.mode === "BICYCLING"
                            ? "✨ 100% Zero Emissions"
                            : "Low Impact"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: Eco-Badges Roster (5 cols) */}
            <div className="lg:col-span-5 rounded-3xl bg-slate-900/80 border border-slate-800 p-6 space-y-4 backdrop-blur-md shadow-lg">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Award className="w-4 h-4 text-teal-400" /> Verified Sustainability Badges
              </h2>

              <div className="space-y-3">
                {summary.ecoBadgesEarned.map((badge) => (
                  <div
                    key={badge.id}
                    className={`p-3.5 rounded-2xl border transition-all ${
                      badge.verified
                        ? "bg-emerald-950/20 border-emerald-500/40"
                        : "bg-slate-950/40 border-slate-800 opacity-50"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                        <CheckCircle2
                          className={`w-3.5 h-3.5 ${
                            badge.verified ? "text-emerald-400" : "text-slate-600"
                          }`}
                        />
                        {badge.name}
                      </h3>
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-black/40 text-slate-300">
                        {badge.category}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      {badge.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
