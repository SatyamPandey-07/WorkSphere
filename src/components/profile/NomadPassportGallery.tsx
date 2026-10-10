"use client";

import React, { useState } from "react";
import {
  ShieldCheck,
  Award,
  Sparkles,
  Lock,
  Download,
  CheckCircle2,
  Cpu,
  Globe,
  RefreshCw,
  X,
  Eye,
  MapPin,
  Calendar,
  Compass,
} from "lucide-react";
import {
  generateClientNomadProof,
  generateBadgeSvgMarkup,
  type NomadProductivityStatement,
  type PassportStamp,
} from "@/lib/zkp/nomadProof";
import { downloadSVG } from "@/lib/qr/svgQr";
import NomadPassportCoin from "./NomadPassportCoin";

const AVAILABLE_STATEMENTS: NomadProductivityStatement[] = [
  {
    badgeType: "NOMAD_100_HOURS",
    tierTitle: "100-Hour Deep Work Focus Master",
    minThresholdStreak: 14,
    minThresholdHours: 100,
    epoch: 2026,
  },
  {
    badgeType: "STREAK_30_DAYS",
    tierTitle: "30-Day Workspace Streak Champion",
    minThresholdStreak: 30,
    minThresholdHours: 60,
    epoch: 2026,
  },
  {
    badgeType: "MULTI_CITY_EXPLORER",
    tierTitle: "Multi-City Global Nomad Explorer",
    minThresholdStreak: 10,
    minThresholdHours: 40,
    epoch: 2026,
  },
];

const INITIAL_EARNED_STAMPS: PassportStamp[] = [
  {
    stampId: "STAMP-PORTUGAL-LISBOA-2026-PT0928",
    badgeType: "COUNTRY_PORTUGAL",
    tierTitle: "Portugal Nomad Residency",
    countryName: "Portugal",
    countryCode: "PT",
    venueName: "Second Home Coworking Lisboa",
    visitDate: "2026-09-28",
    epoch: 2026,
    issuedAt: new Date(Date.now() - 11 * 86400000).toISOString(),
    nullifierHash: "e4d909c290d0fb1ca068ffaddf22cbd0ffd823ef45a2789123456789abcdef01",
    verificationSignature: "8f7e2a9b3c4d5e6f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f",
    svgMarkup: "",
  },
  {
    stampId: "STAMP-JAPAN-TOKYO-2026-JP1002",
    badgeType: "COUNTRY_JAPAN",
    tierTitle: "Japan Nomad Residency",
    countryName: "Japan",
    countryCode: "JP",
    venueName: "Blink Community Roppongi",
    visitDate: "2026-10-02",
    epoch: 2026,
    issuedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
    nullifierHash: "a7b3c9d1234ef9876543210fedcba9876543210fedcba9876543210fedcba987",
    verificationSignature: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f8f7e2a9b3c4d5e6f",
    svgMarkup: "",
  },
  {
    stampId: "STAMP-NOMAD_50_HOURS-2026-A89B4C21",
    badgeType: "NOMAD_50_HOURS",
    tierTitle: "50-Hour Focus Veteran",
    venueName: "SoMa Focus Hub & Roastery",
    visitDate: "2026-10-04",
    epoch: 2026,
    issuedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    nullifierHash: "e4d909c290d0fb1ca068ffaddf22cbd0ffd823ef45a2789123456789abcdef01",
    verificationSignature: "8f7e2a9b3c4d5e6f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f",
    svgMarkup: "",
  },
];

export interface NomadPassportGalleryProps {
  initialStamps?: PassportStamp[];
}

export default function NomadPassportGallery({
  initialStamps,
}: NomadPassportGalleryProps = {}) {
  const [selectedStatement, setSelectedStatement] = useState<NomadProductivityStatement>(
    AVAILABLE_STATEMENTS[0]
  );
  const [generatingProof, setGeneratingProof] = useState(false);
  const [mintedStamps, setMintedStamps] = useState<PassportStamp[]>(
    initialStamps ?? INITIAL_EARNED_STAMPS
  );
  const [activeStamp, setActiveStamp] = useState<PassportStamp | null>(
    (initialStamps ?? INITIAL_EARNED_STAMPS)[0] ?? null
  );
  const [previewModalStamp, setPreviewModalStamp] = useState<PassportStamp | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleGenerateAndVerifyProof = async () => {
    setGeneratingProof(true);
    setSuccessMsg(null);
    try {
      const identitySecret = "user_nomad_secret_seed_99812";
      const actualStreak = 32;
      const actualHours = 124;

      const payload = await generateClientNomadProof(
        identitySecret,
        actualStreak,
        actualHours,
        selectedStatement
      );

      const res = await fetch("/api/auth/zkp/nomad-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success && data.stamp) {
        const enrichedStamp: PassportStamp = {
          ...data.stamp,
          venueName: "Mission Focus Coworking & Cafe",
          visitDate: new Date().toISOString().split("T")[0],
        };
        setMintedStamps((prev) => [enrichedStamp, ...prev]);
        setActiveStamp(enrichedStamp);
        setSuccessMsg(`Minted Zero-Knowledge Passport Stamp: ${data.stamp.tierTitle}!`);
      }
    } catch (err: any) {
      console.error("ZK Proof error:", err);
    } finally {
      setGeneratingProof(false);
    }
  };

  // Download crisp vector SVG badge containing venue name & visit date
  const handleDownloadBadgeSvg = (stamp: PassportStamp) => {
    const svgMarkup = generateBadgeSvgMarkup(stamp);
    downloadSVG(svgMarkup, `${stamp.stampId}-badge.svg`);
  };

  // Download high-res PNG badge for personal portfolios
  const handleDownloadBadgePng = (stamp: PassportStamp) => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const svgMarkup = generateBadgeSvgMarkup(stamp);
    const canvas = document.createElement("canvas");
    const size = 800;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const blob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      const pngUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = pngUrl;
      a.download = `${stamp.stampId}-badge.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    };
    img.src = url;
  };

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6">
      {/* Top Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 border border-indigo-500/30 p-6 md:p-8 backdrop-blur-xl shadow-2xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-semibold uppercase tracking-wider">
              <ShieldCheck className="w-3.5 h-3.5" /> Zero-Knowledge Identity Credentials
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              Proof-of-Productivity & Digital Nomad Passport
            </h1>
            <p className="text-xs md:text-sm text-slate-300 max-w-2xl">
              Export earned country stamps and verified focus badges as crisp vector SVG or high-res PNG badges with venue names and visit dates for personal portfolios.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 text-xs space-y-1 font-mono">
              <span className="text-slate-400 block text-[10px]">Earned Country Badges</span>
              <strong className="text-cyan-400 text-base">{mintedStamps.length} Stamps Minted</strong>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-800/80 flex items-center gap-2 text-xs text-slate-400">
          <Lock className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span>Privacy Guaranteed: Merkle leaf commitments prevent timeline & venue doxxing.</span>
        </div>
      </div>

      {/* Earned Country & Productivity Stamps Shelf */}
      <div className="rounded-3xl bg-slate-900/80 border border-slate-800 p-6 space-y-4 backdrop-blur-md shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Globe className="w-4 h-4 text-cyan-400" /> Earned Passport Stamps & Country Badges
          </h2>
          <span className="text-xs text-slate-400">Click any badge to preview or download</span>
        </div>

        {mintedStamps.length === 0 ? (
          <div
            data-testid="zero-stamps-empty-state"
            className="flex flex-col items-center justify-center py-12 px-6 rounded-2xl bg-slate-950/40 border border-dashed border-slate-800 text-center space-y-4 animate-in fade-in duration-300"
          >
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 shadow-lg shadow-cyan-950/50">
              <Compass className="w-8 h-8 animate-pulse" />
            </div>
            <div className="space-y-1.5 max-w-md">
              <h3 className="text-base font-bold text-white tracking-tight">
                Your Nomad Passport is Brand New!
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Check in to coworking spaces, cafes, and verified focus hubs around the world to collect verifiable cryptographic country badges and streak credentials.
              </p>
            </div>
            <a
              href="/venues"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-bold shadow-lg shadow-cyan-600/30 transition-all hover:scale-[1.02]"
            >
              <Compass className="w-4 h-4" />
              <span>Explore Venues to Earn Your First Stamp</span>
            </a>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {mintedStamps.map((stamp) => {
              const isSelected = activeStamp?.stampId === stamp.stampId;
              const badgeSvg = generateBadgeSvgMarkup(stamp);

              return (
                <div
                  key={stamp.stampId}
                  onClick={() => {
                    setActiveStamp(stamp);
                    setPreviewModalStamp(stamp);
                  }}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between space-y-3 ${
                    isSelected
                      ? "bg-indigo-500/10 border-cyan-400 shadow-md shadow-indigo-950/40"
                      : "bg-slate-950/60 border-slate-800 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      dangerouslySetInnerHTML={{ __html: badgeSvg }}
                      className="w-14 h-14 rounded-full drop-shadow-md shrink-0 flex items-center justify-center"
                    />
                    <div className="space-y-1 min-w-0">
                      <h3 className="text-xs font-bold text-white truncate">
                        {stamp.countryName ? `${stamp.countryName} Country Stamp` : stamp.tierTitle}
                      </h3>
                      {stamp.venueName && (
                        <p className="text-[11px] text-cyan-300 flex items-center gap-1 truncate">
                          <MapPin className="w-3 h-3 shrink-0" /> {stamp.venueName}
                        </p>
                      )}
                      <span className="text-[10px] text-slate-400 font-mono block">
                        Visited: {stamp.visitDate || new Date(stamp.issuedAt).toISOString().split("T")[0]}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                    <span className="text-[10px] font-mono text-emerald-400 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> ZK Verified
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveStamp(stamp);
                        setPreviewModalStamp(stamp);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[11px] font-medium flex items-center gap-1 transition"
                    >
                      <Eye className="w-3 h-3" /> Preview
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Main Grid: Proof Builder & Active Stamp Visualizer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: ZK Proof Minting (7 cols) */}
        <div className="lg:col-span-7 rounded-3xl bg-slate-900/80 border border-slate-800 p-6 space-y-5 backdrop-blur-md shadow-lg">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Cpu className="w-4 h-4 text-cyan-400" /> Unlock Zero-Knowledge Credentials
            </h2>
            <span className="text-[11px] text-slate-400">Epoch 2026</span>
          </div>

          {/* Statement Selectors */}
          <div className="space-y-3">
            {AVAILABLE_STATEMENTS.map((stmt) => {
              const isSelected = selectedStatement.badgeType === stmt.badgeType;
              return (
                <div
                  key={stmt.badgeType}
                  onClick={() => setSelectedStatement(stmt)}
                  className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                    isSelected
                      ? "bg-indigo-500/10 border-cyan-400 shadow-md shadow-indigo-950/40"
                      : "bg-slate-950/60 border-slate-800 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <h3 className="text-xs font-bold text-white">{stmt.tierTitle}</h3>
                      <div className="flex items-center gap-3 text-[11px] text-slate-400 font-mono">
                        <span>Min Streak: {stmt.minThresholdStreak} Days</span>
                        <span>•</span>
                        <span>Min Focus: {stmt.minThresholdHours} Hours</span>
                      </div>
                    </div>
                    {isSelected ? (
                      <CheckCircle2 className="w-5 h-5 text-cyan-400" />
                    ) : (
                      <Award className="w-5 h-5 text-slate-600" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Mint Action Button */}
          <button
            onClick={handleGenerateAndVerifyProof}
            disabled={generatingProof}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 transition disabled:opacity-50"
          >
            {generatingProof ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Computing Poseidon Commitments & SNARK Proof...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Generate ZK Proof & Mint Passport Stamp
              </>
            )}
          </button>

          {successMsg && (
            <div className="p-3.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-medium flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}
        </div>

        {/* Right Column: Active Stamp Visualizer (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          {activeStamp ? (
            <div className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-5 backdrop-blur-md shadow-lg flex flex-col items-center">
              <div className="w-full flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                  Passport Stamp Attestation
                </span>
                <button
                  type="button"
                  onClick={() => setPreviewModalStamp(activeStamp)}
                  className="text-xs text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-1"
                >
                  <Eye className="w-3.5 h-3.5" /> Full Modal
                </button>
              </div>

              <NomadPassportCoin stamp={activeStamp} />

              {/* Stamp Metadata */}
              <div className="w-full space-y-2 text-xs font-mono pt-2 border-t border-slate-800">
                <div className="flex justify-between text-slate-400">
                  <span>Venue:</span>
                  <span className="text-slate-200 font-bold truncate max-w-[180px]">
                    {activeStamp.venueName || "Verified Hub"}
                  </span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Visit Date:</span>
                  <span className="text-slate-200">
                    {activeStamp.visitDate || new Date(activeStamp.issuedAt).toISOString().split("T")[0]}
                  </span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Stamp ID:</span>
                  <span className="text-cyan-300 font-bold">{activeStamp.stampId.slice(0, 20)}...</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Nullifier:</span>
                  <span className="text-slate-400">{activeStamp.nullifierHash.slice(0, 14)}...</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="w-full space-y-2">
                <button
                  type="button"
                  onClick={() => setPreviewModalStamp(activeStamp)}
                  className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-md shadow-cyan-600/30 flex items-center justify-center gap-1.5 transition"
                >
                  <Eye className="w-3.5 h-3.5" /> Preview & Download Badge
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleDownloadBadgeSvg(activeStamp)}
                    className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                  >
                    <Download className="w-3 h-3 text-cyan-400" /> Save SVG
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadBadgePng(activeStamp)}
                    className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                  >
                    <Download className="w-3 h-3 text-emerald-400" /> Save PNG
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-12 rounded-3xl bg-slate-900/40 border border-slate-800 text-center text-slate-400 text-xs">
              Select or mint a passport stamp to view details.
            </div>
          )}
        </div>
      </div>

      {/* Stamp Preview Modal with "Download Badge" option */}
      {previewModalStamp && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="stamp-modal-title"
          data-testid="stamp-preview-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
          onClick={() => setPreviewModalStamp(null)}
        >
          <div
            className="relative w-full max-w-lg rounded-3xl bg-slate-900 border border-slate-700/80 p-6 md:p-8 space-y-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              type="button"
              onClick={() => setPreviewModalStamp(null)}
              aria-label="Close modal"
              className="absolute top-5 right-5 p-2 rounded-full bg-slate-800 text-slate-400 hover:text-white transition"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Modal Header */}
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">
                Passport Stamp Preview
              </span>
              <h3 id="stamp-modal-title" className="text-xl font-bold text-white">
                {previewModalStamp.countryName
                  ? `${previewModalStamp.countryName} Country Stamp`
                  : previewModalStamp.tierTitle}
              </h3>
              <p className="text-xs text-slate-400">
                Venue insignia on the obverse, cryptographic attestation on the reverse.
              </p>
            </div>

            <NomadPassportCoin stamp={previewModalStamp} />

            {/* Badge Metadata Details */}
            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-950/60 p-4 rounded-2xl border border-slate-800 font-mono">
              <div className="space-y-0.5">
                <span className="text-slate-400 block text-[10px] flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-cyan-400" /> Venue Name
                </span>
                <strong className="text-slate-200 truncate block">
                  {previewModalStamp.venueName || "WorkSphere Verified Hub"}
                </strong>
              </div>
              <div className="space-y-0.5">
                <span className="text-slate-400 block text-[10px] flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-indigo-400" /> Visit Date
                </span>
                <strong className="text-slate-200 block">
                  {previewModalStamp.visitDate ||
                    new Date(previewModalStamp.issuedAt).toISOString().split("T")[0]}
                </strong>
              </div>
              <div className="space-y-0.5">
                <span className="text-slate-400 block text-[10px]">Stamp ID</span>
                <span className="text-cyan-400 block truncate">
                  {previewModalStamp.stampId.slice(0, 18)}...
                </span>
              </div>
              <div className="space-y-0.5">
                <span className="text-slate-400 block text-[10px]">Attestation</span>
                <span className="text-emerald-400 block flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> ZK Verified
                </span>
              </div>
            </div>

            {/* Modal Action Buttons: "Download Badge" option */}
            <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => handleDownloadBadgeSvg(previewModalStamp)}
                data-testid="download-badge-svg-btn"
                className="w-full sm:flex-1 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-lg shadow-cyan-600/30 flex items-center justify-center gap-2 transition"
              >
                <Download className="w-4 h-4" /> Download Badge (SVG)
              </button>
              <button
                type="button"
                onClick={() => handleDownloadBadgePng(previewModalStamp)}
                data-testid="download-badge-png-btn"
                className="w-full sm:flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-2 transition"
              >
                <Download className="w-4 h-4 text-emerald-400" /> Download Badge (PNG)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
