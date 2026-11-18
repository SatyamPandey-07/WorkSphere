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
  Trophy,
  Medal,
  Users,
  Plane,
  Building2,
  Download,
  ShieldCheck,
} from "lucide-react";
import {
  CarbonFootprintSummary,
  CommuteMode,
  safeParseDistance,
  TeamCarbonSavings,
  aggregateTeamCarbonSavings,
  generateTeamBadgeSVG,
} from "@/lib/sustainability/carbonEngine";
import { LanternPowerRing } from "./LanternPowerRing";

export default function CarbonFootprintTracker() {
  const [summary, setSummary] = useState<CarbonFootprintSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<TeamCarbonSavings | null>(null);
  const [badgeExported, setBadgeExported] = useState(false);

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
  const teams: TeamCarbonSavings[] = React.useMemo(() => {
    if (summary?.teamLeaderboard && summary.teamLeaderboard.length > 0) {
      return summary.teamLeaderboard;
    }
    return aggregateTeamCarbonSavings();
  }, [summary]);

  const activeSelectedTeam =
    selectedTeam || (teams.length > 0 ? teams[0] : null);

  const handleExportTeamBadge = (teamToExport?: TeamCarbonSavings) => {
    const target = teamToExport || activeSelectedTeam;
    if (!target) return;

    const svgContent = generateTeamBadgeSVG(
      target,
      summary?.periodMonth || "October 2026",
    );
    const blob = new Blob([svgContent], {
      type: "image/svg+xml;charset=utf-8;",
    });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const sanitizedName = target.teamName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    a.download = `worksphere-team-carbon-badge-${sanitizedName}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    setBadgeExported(true);
    setTimeout(() => setBadgeExported(false), 3000);
  };

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

          {/* Team Aggregate Carbon Savings Leaderboard & Visual Ranking Podium (#5309) */}
          <div
            data-testid="team-carbon-leaderboard"
            className="rounded-3xl bg-slate-900/80 border border-slate-800 p-6 md:p-8 space-y-8 backdrop-blur-md shadow-2xl"
          >
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold uppercase tracking-wider">
                  <Trophy className="w-3.5 h-3.5 text-amber-400" /> Regional Hub Sustainability Champions
                </div>
                <h2 className="text-xl md:text-2xl font-black text-white tracking-tight flex items-center gap-2">
                  Team & Organization Carbon Savings Leaderboard
                </h2>
                <p className="text-xs md:text-sm text-slate-400 max-w-2xl">
                  Celebrating distributed teams that slash Scope 3 flight and transit emissions by collaborating from regional eco-hubs instead of cross-country flights to HQ.
                </p>
              </div>

              {activeSelectedTeam && (
                <button
                  onClick={() => handleExportTeamBadge(activeSelectedTeam)}
                  data-testid="export-team-badge-btn"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white text-xs font-bold shadow-lg shadow-emerald-500/20 transition shrink-0"
                >
                  <Download className="w-4 h-4" />
                  {badgeExported ? "Badge Exported! ✓" : "Export Team Sustainability Badge"}
                </button>
              )}
            </div>

            {/* Visual Ranking Podium */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                  <Award className="w-4 h-4" /> Monthly Top Performing Podia
                </h3>
                <span className="text-[11px] font-mono text-slate-400">
                  {summary.periodMonth} • Flight & Transit Avoidance
                </span>
              </div>

              <div
                data-testid="carbon-ranking-podium"
                className="grid grid-cols-1 md:grid-cols-3 gap-5 items-end pt-4"
              >
                {/* 2nd Place (Silver) */}
                {teams[1] && (
                  <div
                    data-testid="podium-rank-2"
                    onClick={() => setSelectedTeam(teams[1])}
                    className={`cursor-pointer group relative rounded-3xl p-5 border transition-all duration-300 flex flex-col justify-between ${
                      activeSelectedTeam?.teamId === teams[1].teamId
                        ? "bg-slate-900 border-slate-400/80 shadow-lg shadow-slate-500/10 ring-2 ring-slate-400/40"
                        : "bg-slate-950/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900/60"
                    }`}
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-400/10 border border-slate-400/30 text-slate-300 font-mono text-[11px] font-bold">
                          <Medal className="w-3.5 h-3.5 text-slate-300" /> 2nd Place
                        </span>
                        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                          Silver Tier
                        </span>
                      </div>

                      <div>
                        <h4 className="text-sm font-bold text-white group-hover:text-slate-200 transition">
                          {teams[1].teamName}
                        </h4>
                        <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 text-cyan-400 shrink-0" />
                          {teams[1].regionalHub}
                        </p>
                      </div>

                      <div className="p-3 rounded-2xl bg-black/40 border border-slate-800/80 space-y-1">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          Avoided Emissions
                        </div>
                        <div className="text-2xl font-black text-white font-mono">
                          {teams[1].monthlyAvoidedKgCo2}{" "}
                          <span className="text-xs text-slate-400 font-normal">kg CO₂e</span>
                        </div>
                        <div className="flex justify-between text-[10px] font-mono text-slate-400 pt-1 border-t border-slate-800">
                          <span className="flex items-center gap-1">
                            <Plane className="w-3 h-3 text-rose-400" />
                            {teams[1].flightEmissionsAvoidedKg} kg flights
                          </span>
                          <span className="flex items-center gap-1">
                            <TreePine className="w-3 h-3 text-emerald-400" />
                            {teams[1].treesEquivalent} trees
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" /> {teams[1].membersCount} members
                      </span>
                      <span className="font-semibold text-slate-300 group-hover:underline">
                        Select Badge →
                      </span>
                    </div>
                  </div>
                )}

                {/* 1st Place (Gold / Emerald Champion - Elevated & Highlighted) */}
                {teams[0] && (
                  <div
                    data-testid="podium-rank-1"
                    onClick={() => setSelectedTeam(teams[0])}
                    className={`cursor-pointer group relative rounded-3xl p-6 border transition-all duration-300 md:-translate-y-3 flex flex-col justify-between ${
                      activeSelectedTeam?.teamId === teams[0].teamId
                        ? "bg-gradient-to-b from-emerald-950/70 via-slate-900 to-slate-950 border-emerald-500/80 shadow-2xl shadow-emerald-500/20 ring-2 ring-emerald-500/50"
                        : "bg-gradient-to-b from-emerald-950/40 via-slate-900 to-slate-950 border-emerald-500/40 hover:border-emerald-500/70 hover:shadow-xl"
                    }`}
                  >
                    <div className="space-y-3.5">
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono text-xs font-bold shadow-sm">
                          <Trophy className="w-4 h-4 text-amber-400" /> 1st Place Champion
                        </span>
                        <span className="text-[10px] font-mono uppercase px-2.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          Emerald Tier
                        </span>
                      </div>

                      <div>
                        <h4 className="text-base font-extrabold text-white group-hover:text-emerald-300 transition">
                          {teams[0].teamName}
                        </h4>
                        <p className="text-xs text-emerald-200/90 flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          {teams[0].regionalHub}
                        </p>
                      </div>

                      <div className="p-4 rounded-2xl bg-black/60 border border-emerald-500/30 space-y-1.5">
                        <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                          Total Monthly Avoided CO₂e
                        </div>
                        <div className="text-3xl font-black text-emerald-400 font-mono">
                          {teams[0].monthlyAvoidedKgCo2}{" "}
                          <span className="text-sm text-slate-300 font-normal">kg</span>
                        </div>
                        <div className="flex justify-between text-[11px] font-mono text-slate-300 pt-1.5 border-t border-slate-800">
                          <span className="flex items-center gap-1 text-emerald-300">
                            <Plane className="w-3 h-3 text-emerald-400" />
                            {teams[0].flightEmissionsAvoidedKg} kg flights
                          </span>
                          <span className="flex items-center gap-1 text-teal-300">
                            <TreePine className="w-3 h-3 text-teal-400" />
                            {teams[0].treesEquivalent} trees
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 pt-3.5 border-t border-emerald-500/20 flex items-center justify-between text-xs text-emerald-300/90 font-medium">
                      <span className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5" /> {teams[0].membersCount} active members
                      </span>
                      <span className="font-bold text-white group-hover:underline flex items-center gap-1">
                        Select Badge →
                      </span>
                    </div>
                  </div>
                )}

                {/* 3rd Place (Bronze) */}
                {teams[2] && (
                  <div
                    data-testid="podium-rank-3"
                    onClick={() => setSelectedTeam(teams[2])}
                    className={`cursor-pointer group relative rounded-3xl p-5 border transition-all duration-300 flex flex-col justify-between ${
                      activeSelectedTeam?.teamId === teams[2].teamId
                        ? "bg-slate-900 border-amber-600/80 shadow-lg shadow-amber-600/10 ring-2 ring-amber-600/40"
                        : "bg-slate-950/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900/60"
                    }`}
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-600/10 border border-amber-600/30 text-amber-300 font-mono text-[11px] font-bold">
                          <Medal className="w-3.5 h-3.5 text-amber-500" /> 3rd Place
                        </span>
                        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                          Bronze Tier
                        </span>
                      </div>

                      <div>
                        <h4 className="text-sm font-bold text-white group-hover:text-amber-200 transition">
                          {teams[2].teamName}
                        </h4>
                        <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 text-cyan-400 shrink-0" />
                          {teams[2].regionalHub}
                        </p>
                      </div>

                      <div className="p-3 rounded-2xl bg-black/40 border border-slate-800/80 space-y-1">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          Avoided Emissions
                        </div>
                        <div className="text-2xl font-black text-white font-mono">
                          {teams[2].monthlyAvoidedKgCo2}{" "}
                          <span className="text-xs text-slate-400 font-normal">kg CO₂e</span>
                        </div>
                        <div className="flex justify-between text-[10px] font-mono text-slate-400 pt-1 border-t border-slate-800">
                          <span className="flex items-center gap-1">
                            <Plane className="w-3 h-3 text-rose-400" />
                            {teams[2].flightEmissionsAvoidedKg} kg flights
                          </span>
                          <span className="flex items-center gap-1">
                            <TreePine className="w-3 h-3 text-emerald-400" />
                            {teams[2].treesEquivalent} trees
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" /> {teams[2].membersCount} members
                      </span>
                      <span className="font-semibold text-amber-300 group-hover:underline">
                        Select Badge →
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Exportable Team Badge Preview Card */}
            {activeSelectedTeam && (
              <div
                data-testid="team-badge-preview"
                className="rounded-3xl border border-emerald-500/40 bg-gradient-to-r from-emerald-950/40 via-slate-900 to-teal-950/30 p-6 flex flex-col md:flex-row items-center justify-between gap-6 backdrop-blur-md"
              >
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                    <Trophy className="w-8 h-8 text-amber-400" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-mono font-bold uppercase">
                        Rank #{activeSelectedTeam.rank} • {activeSelectedTeam.badgeTier} Badge
                      </span>
                      <span className="flex items-center gap-1 text-[11px] text-slate-400">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Scope 3 Certified
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-white">
                      {activeSelectedTeam.teamName}
                    </h3>
                    <p className="text-xs text-slate-300">
                      Regional Hub: <span className="text-emerald-300 font-semibold">{activeSelectedTeam.regionalHub}</span> • Saved{" "}
                      <span className="font-mono text-emerald-400 font-bold">{activeSelectedTeam.monthlyAvoidedKgCo2} kg CO₂e</span> ({activeSelectedTeam.treesEquivalent} trees)
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => handleExportTeamBadge(activeSelectedTeam)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/30 transition"
                  >
                    <Download className="w-4 h-4" />
                    Download ESG Vector Badge
                  </button>
                </div>
              </div>
            )}

            {/* Complete Team Organization Standings Table */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                All Participating Teams & Regional Hubs
              </h3>

              <div className="overflow-x-auto rounded-2xl border border-slate-800">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/80 text-[11px] text-slate-400 font-mono">
                      <th className="py-3 px-4">Rank</th>
                      <th className="py-3 px-4">Team & Department</th>
                      <th className="py-3 px-4">Regional Hub</th>
                      <th className="py-3 px-4">Members</th>
                      <th className="py-3 px-4">Avoided Flights</th>
                      <th className="py-3 px-4">Transit Saved</th>
                      <th className="py-3 px-4">Total Avoided CO₂e</th>
                      <th className="py-3 px-4 text-right">Badge Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-sans">
                    {teams.map((t) => (
                      <tr
                        key={t.teamId}
                        onClick={() => setSelectedTeam(t)}
                        className={`cursor-pointer transition-colors ${
                          activeSelectedTeam?.teamId === t.teamId
                            ? "bg-emerald-950/20"
                            : "hover:bg-slate-900/50"
                        }`}
                      >
                        <td className="py-3.5 px-4 font-mono font-bold">
                          {t.rank === 1 ? (
                            <span className="text-amber-400">🥇 1</span>
                          ) : t.rank === 2 ? (
                            <span className="text-slate-300">🥈 2</span>
                          ) : t.rank === 3 ? (
                            <span className="text-amber-600">🥉 3</span>
                          ) : (
                            <span className="text-slate-500">#{t.rank}</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-white">{t.teamName}</div>
                          <div className="text-[10px] text-slate-400">{t.department}</div>
                        </td>
                        <td className="py-3.5 px-4 text-slate-300">
                          <span className="flex items-center gap-1.5">
                            <Building2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                            {t.regionalHub}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-mono text-slate-300">
                          {t.membersCount}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-emerald-300">
                          {t.flightEmissionsAvoidedKg} kg
                        </td>
                        <td className="py-3.5 px-4 font-mono text-cyan-300">
                          {t.transitEmissionsSavedKg} kg
                        </td>
                        <td className="py-3.5 px-4 font-mono font-bold text-emerald-400">
                          {t.monthlyAvoidedKgCo2} kg
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleExportTeamBadge(t);
                            }}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-700 hover:border-emerald-500/50 hover:bg-slate-800 text-[11px] text-slate-300 hover:text-emerald-300 transition"
                          >
                            <Download className="w-3 h-3" /> Export
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
