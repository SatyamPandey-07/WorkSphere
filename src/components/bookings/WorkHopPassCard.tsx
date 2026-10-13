"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Coffee,
  Building2,
  BookOpen,
  QrCode,
  Download,
  CheckCircle2,
  Clock,
  ArrowRight,
  Sparkles,
  ShieldCheck,
  Ticket,
  Copy,
  Check,
  Shield,
} from "lucide-react";
import { generateQRCodeSVG, downloadSVG } from "@/lib/qr/svgQr";
import { useToast } from "@/components/ui/Toast";
import type { WorkHopBundle } from "@/lib/bundles/workHopEngine";

interface WorkHopPassCardProps {
  initialBundle?: WorkHopBundle;
}

interface TiltState {
  rotateX: number;
  rotateY: number;
  shineX: number;
  shineY: number;
  isHovered: boolean;
}

export default function WorkHopPassCard({
  initialBundle,
}: WorkHopPassCardProps) {
  const defaultBundle: WorkHopBundle = {
    bundleId: "whop-782914-sprint",
    userId: "user_nomad_88",
    date: new Date().toISOString().split("T")[0],
    title: "San Francisco Nomad Tri-Hop Pass",
    tier: "NOMAD_PRO",
    totalPrice: 28.5,
    currency: "USD",
    discountPercentage: 25,
    status: "ACTIVE",
    qrToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummyWorkHopToken",
    createdAt: new Date().toISOString(),
    legs: [
      {
        legIndex: 1,
        venueId: "v-cafe-bluebottle",
        venueName: "Sightglass Artisan Coffee & Lab",
        venueCategory: "cafe",
        venueAddress: "270 7th St, SoMa, San Francisco",
        seatNumber: "Bar-Island-04",
        startTime: "09:00",
        endTime: "12:00",
        durationHours: 3,
        amenities: ["Pour-Over Bar", "High-Density Outlets", "120 Mbps WiFi"],
        allocatedRevenue: 8.55,
        status: "CHECKED_IN",
        checkedInAt: "09:04 AM",
      },
      {
        legIndex: 2,
        venueId: "v-cowork-werq",
        venueName: "Workshop Cafe & Quiet Pods",
        venueCategory: "coworking",
        venueAddress: "180 Montgomery St, Financial District",
        seatNumber: "PhoneBooth-02",
        startTime: "12:45",
        endTime: "16:00",
        durationHours: 3.25,
        amenities: ["Acoustic Phone Booth", "Dual 4K Monitor", "350 Mbps WiFi"],
        allocatedRevenue: 12.8,
        status: "PENDING",
      },
      {
        legIndex: 3,
        venueId: "v-cowork-canopy",
        venueName: "Canopy Collaborative Lounge",
        venueCategory: "coworking",
        venueAddress: "2196 Fillmore St, Pacific Heights",
        seatNumber: "Lounge-Desk-11",
        startTime: "16:30",
        endTime: "19:00",
        durationHours: 2.5,
        amenities: [
          "Networking Lounge",
          "Craft Kombucha on Tap",
          "Ergonomic Chairs",
        ],
        allocatedRevenue: 7.15,
        status: "PENDING",
      },
    ],
  };

  const { toast } = useToast();
  const [bundle, setBundle] = useState<WorkHopBundle>(
    initialBundle || defaultBundle,
  );
  const [activeLegIndex, setActiveLegIndex] = useState<number>(1);
  const [qrSvg, setQrSvg] = useState<string>("");
  const [verifying, setVerifying] = useState<boolean>(false);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);
  const [copiedPassCode, setCopiedPassCode] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const [tilt, setTilt] = useState<TiltState>({
    rotateX: 0,
    rotateY: 0,
    shineX: 50,
    shineY: 50,
    isHovered: false,
  });

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateX = Number((((y - centerY) / centerY) * -10).toFixed(2));
    const rotateY = Number((((x - centerX) / centerX) * 10).toFixed(2));
    const shineX = Number(((x / rect.width) * 100).toFixed(1));
    const shineY = Number(((y / rect.height) * 100).toFixed(1));
    setTilt({ rotateX, rotateY, shineX, shineY, isHovered: true });
  };

  const handlePointerLeave = () => {
    setTilt({
      rotateX: 0,
      rotateY: 0,
      shineX: 50,
      shineY: 50,
      isHovered: false,
    });
  };

  // Copy pass code with accessible fallback and feedback toast
  const handleCopyPassCode = async () => {
    const codeToCopy =
      (bundle as any).passCode ||
      (bundle as any).ticketCode ||
      bundle.bundleId ||
      bundle.qrToken;

    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        navigator.clipboard.writeText
      ) {
        await navigator.clipboard.writeText(codeToCopy);
      } else {
        throw new Error("Clipboard API unavailable");
      }
    } catch {
      // Accessible fallback using document.execCommand('copy')
      try {
        if (typeof document !== "undefined") {
          const textArea = document.createElement("textarea");
          textArea.value = codeToCopy;
          textArea.setAttribute("readonly", "");
          textArea.style.position = "absolute";
          textArea.style.left = "-9999px";
          textArea.style.top = "0";
          document.body.appendChild(textArea);
          textArea.select();
          textArea.setSelectionRange(0, 99999);
          document.execCommand("copy");
          document.body.removeChild(textArea);
        }
      } catch (err) {
        console.error("Fallback clipboard error:", err);
      }
    }

    setCopiedPassCode(true);
    setToastMessage("Pass code copied to clipboard!");
    toast("Pass code copied to clipboard!", "success");

    setTimeout(() => {
      setCopiedPassCode(false);
      setToastMessage(null);
    }, 3000);
  };

  // Generate SVG QR Code on mount or token change
  useEffect(() => {
    try {
      const qrPayload = JSON.stringify({
        type: "WORKHOP_DAY_PASS",
        bundleId: bundle.bundleId,
        date: bundle.date,
        token: bundle.qrToken,
      });
      const svg = generateQRCodeSVG(qrPayload, {
        size: 200,
        padding: 2,
        fgColor: "#0f172a",
        bgColor: "#ffffff",
        title: `WorkHop Pass ${bundle.bundleId}`,
      });
      setQrSvg(svg);
    } catch (e) {
      console.error("QR Generation error:", e);
    }
  }, [bundle]);

  const handleDownloadQR = () => {
    if (qrSvg) {
      downloadSVG(qrSvg, `WorkHop-Pass-${bundle.bundleId}.svg`);
    }
  };

  // Simulate scanning at venue door
  const handleSimulateCheckIn = async (legIndex: number) => {
    setVerifying(true);
    setVerifyMessage(null);
    try {
      await new Promise((resolve) => setTimeout(resolve, 600));
      setBundle((prev) => ({
        ...prev,
        legs: prev.legs.map((leg) =>
          leg.legIndex === legIndex
            ? {
                ...leg,
                status: "CHECKED_IN",
                checkedInAt: new Date().toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              }
            : leg,
        ),
      }));
      setVerifyMessage(
        `Checked into Leg #${legIndex} successfully! Door unlocked.`,
      );
      setTimeout(() => setVerifyMessage(null), 4000);
    } finally {
      setVerifying(false);
    }
  };

  const getCategoryIcon = (cat: string) => {
    switch (cat.toLowerCase()) {
      case "cafe":
        return <Coffee className="w-4 h-4 text-amber-400" />;
      case "library":
        return <BookOpen className="w-4 h-4 text-emerald-400" />;
      case "coworking":
      default:
        return <Building2 className="w-4 h-4 text-blue-400" />;
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* 3D Perspective Card Container with Holographic Flight Badge */}
      <div
        ref={cardRef}
        data-testid="holographic-flight-badge"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        style={{
          transform: tilt.isHovered
            ? `perspective(1000px) rotateX(${tilt.rotateX}deg) rotateY(${tilt.rotateY}deg) scale3d(1.01, 1.01, 1.01)`
            : "perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)",
          transition: tilt.isHovered
            ? "transform 0.08s ease-out"
            : "transform 0.4s ease-out",
          clipPath:
            "polygon(22px 0%, calc(100% - 22px) 0%, 100% 22px, 100% calc(100% - 22px), calc(100% - 22px) 100%, 22px 100%, 0% calc(100% - 22px), 0% 22px)",
        }}
        className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-950 to-emerald-950/80 border-2 border-emerald-500/40 p-6 md:p-8 shadow-2xl shadow-emerald-950/50 backdrop-blur-xl transition-all"
      >
        {/* Iridescent Emerald Holographic Foil Shine Layer */}
        <div
          data-testid="holographic-foil-shine"
          className="pointer-events-none absolute inset-0 z-10 transition-opacity duration-300"
          style={{
            opacity: tilt.isHovered ? 0.75 : 0.25,
            background: `radial-gradient(
              circle 380px at ${tilt.shineX}% ${tilt.shineY}%,
              rgba(52, 211, 153, 0.45) 0%,
              rgba(16, 185, 129, 0.28) 25%,
              rgba(6, 182, 212, 0.2) 45%,
              rgba(139, 92, 246, 0.15) 65%,
              transparent 85%
            )`,
            mixBlendMode: "screen",
          }}
        />

        {/* Angular metallic corner brackets */}
        <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-emerald-400 pointer-events-none" />
        <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-emerald-400 pointer-events-none" />
        <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-emerald-400 pointer-events-none" />
        <div className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-emerald-400 pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-3">
            {/* Sector 2814 Clearance Header & Badges */}
            <div className="flex flex-wrap items-center gap-3">
              <div
                data-testid="sector-clearance-header"
                className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 text-xs font-mono font-bold tracking-widest uppercase shadow-sm shadow-emerald-500/20"
              >
                <Shield className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>SECTOR 2814 CLEARANCE</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-1" />
              </div>

              <span
                title={`${bundle.tier} Day Pass`}
                className="px-3 py-1 rounded-md bg-slate-800/80 border border-slate-700 text-slate-300 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5"
              >
                <Ticket className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                <span className="truncate">{bundle.tier} FLIGHT PASS</span>
              </span>

              <span className="px-2.5 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-xs font-semibold whitespace-nowrap">
                {bundle.discountPercentage}% Bundle Savings
              </span>
            </div>

            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              {bundle.title}
            </h1>

            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-emerald-400" />
                Valid: <strong>{bundle.date}</strong>
              </span>

              <div
                className="flex items-center gap-1.5"
                data-testid="booking-reference-container"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="text-slate-400">Pass ID:</span>
                <code
                  data-testid="booking-reference"
                  className="font-mono text-emerald-300 font-bold bg-slate-950/90 px-2 py-0.5 rounded border border-emerald-500/30 text-xs tracking-wider select-all"
                >
                  {bundle.bundleId}
                </code>
              </div>

              <span className="flex items-center gap-1">
                Total:{" "}
                <strong className="text-white">
                  ${bundle.totalPrice} {bundle.currency}
                </strong>
              </span>
            </div>
          </div>

          {/* High-Contrast Isolated QR Pass Box */}
          <div
            data-testid="qr-pass-box"
            className="relative z-20 flex flex-col items-center gap-2 p-3 bg-white rounded-xl shadow-2xl border-2 border-emerald-500/40 shrink-0"
          >
            {qrSvg ? (
              <div
                data-testid="qr-svg-container"
                dangerouslySetInnerHTML={{ __html: qrSvg }}
                className="w-[150px] h-[150px] flex items-center justify-center bg-white"
              />
            ) : (
              <div className="w-[150px] h-[150px] bg-slate-100 flex items-center justify-center rounded-lg">
                <QrCode className="w-12 h-12 text-slate-400 animate-pulse" />
              </div>
            )}
            <button
              type="button"
              onClick={handleCopyPassCode}
              data-testid="copy-pass-code-btn"
              aria-label="Copy Pass Code"
              className="w-full text-center text-[11px] font-semibold text-slate-800 hover:text-emerald-700 flex items-center justify-center gap-1.5 transition py-1 px-2 rounded-lg hover:bg-slate-100"
            >
              {copiedPassCode ? (
                <Check
                  className="w-3.5 h-3.5 text-emerald-600"
                  data-testid="copy-checkmark-icon"
                />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>
                {copiedPassCode ? "Pass Code Copied!" : "Copy Pass Code"}
              </span>
            </button>
            <button
              type="button"
              onClick={handleDownloadQR}
              className="w-full text-center text-[11px] font-semibold text-slate-800 hover:text-emerald-700 flex items-center justify-center gap-1 transition py-1 px-2 rounded-lg hover:bg-slate-100"
            >
              <Download className="w-3 h-3" /> Save Pass SVG
            </button>
          </div>
        </div>

        {/* Barcode Telemetry Section */}
        <div
          data-testid="barcode-telemetry"
          className="relative z-10 w-full flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 mt-4 border-t border-emerald-500/30"
        >
          <div className="flex items-center gap-3">
            {/* Visual barcode lines */}
            <div
              aria-hidden="true"
              className="h-7 w-40 rounded bg-slate-950 border border-emerald-500/40 p-1 flex items-stretch gap-[2px] overflow-hidden"
            >
              {[
                3, 1, 2, 4, 1, 3, 2, 1, 4, 2, 1, 3, 2, 1, 4, 1, 2, 3, 1, 2, 4,
              ].map((w, i) => (
                <span
                  key={i}
                  style={{ width: `${w * 1.5}px` }}
                  className={
                    i % 2 === 0 ? "bg-emerald-400" : "bg-emerald-600/30"
                  }
                />
              ))}
            </div>
            <div className="text-[10px] font-mono text-emerald-400/90 tracking-wider">
              <span className="block font-bold">SEC-2814 // FLIGHT BADGE</span>
              <span className="text-slate-400">TELEMETRY: VERIFIED</span>
            </div>
          </div>

          <div className="text-[10px] font-mono text-right text-slate-400 flex flex-wrap gap-2 sm:gap-4">
            <span>FREQ: 1420.405 MHz</span>
            <span>AUTH: SHA-256</span>
            <span className="text-emerald-400 font-semibold">
              COORDS: 37.77°N 122.41°W
            </span>
          </div>
        </div>

        {verifyMessage && (
          <div className="relative z-10 mt-4 p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-medium flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{verifyMessage}</span>
          </div>
        )}
      </div>

      {/* Multi-Leg Itinerary Timeline */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400" /> Today's Multi-Hop
            Itinerary ({bundle.legs.length} Stops)
          </h2>
          <span className="text-xs text-slate-400">
            Scan QR at each partner entrance
          </span>
        </div>

        <div className="space-y-4">
          {bundle.legs.map((leg, index) => {
            const isCheckedIn = leg.status === "CHECKED_IN";
            const isSelected = activeLegIndex === leg.legIndex;

            return (
              <div key={leg.legIndex} className="space-y-3">
                <div
                  onClick={() => setActiveLegIndex(leg.legIndex)}
                  className={`p-5 rounded-2xl border transition-all cursor-pointer ${
                    isCheckedIn
                      ? "bg-slate-900/80 border-emerald-500/40 shadow-lg shadow-emerald-950/20"
                      : isSelected
                        ? "bg-slate-900/90 border-indigo-500 shadow-lg shadow-indigo-950/30"
                        : "bg-slate-900/50 border-slate-800 hover:border-slate-700"
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div
                        className={`flex flex-col items-center justify-center w-10 h-10 rounded-xl font-bold text-sm shrink-0 border ${
                          isCheckedIn
                            ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                            : "bg-indigo-500/20 border-indigo-500/40 text-indigo-300"
                        }`}
                      >
                        Hop {leg.legIndex}
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-bold text-white">
                            {leg.venueName}
                          </h3>
                          <span className="text-[11px] px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 flex items-center gap-1">
                            {getCategoryIcon(leg.venueCategory)}
                            <span className="capitalize">
                              {leg.venueCategory}
                            </span>
                          </span>
                        </div>
                        <p className="text-xs text-slate-400">
                          {leg.venueAddress}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right text-xs">
                        <span className="text-slate-400 block font-mono">
                          {leg.startTime} - {leg.endTime}
                        </span>
                        <span className="text-indigo-400 font-semibold">
                          Seat: {leg.seatNumber || "Hot Desk"}
                        </span>
                      </div>

                      {isCheckedIn ? (
                        <div className="px-3 py-1 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-xs font-semibold flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Checked In (
                          {leg.checkedInAt})
                        </div>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSimulateCheckIn(leg.legIndex);
                          }}
                          disabled={verifying}
                          className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition disabled:opacity-50"
                        >
                          Simulate Door Tap
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Amenities & Revenue attribution row */}
                  <div className="mt-3 pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap gap-1.5">
                      {leg.amenities.map((am, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded-md bg-slate-800/70 border border-slate-700/60 text-slate-300 text-[11px]"
                        >
                          {am}
                        </span>
                      ))}
                    </div>

                    <div className="text-slate-400 text-[11px]">
                      Partner Payout:{" "}
                      <strong className="text-slate-200">
                        ${leg.allocatedRevenue} USD
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Transition Line to next hop */}
                {index < bundle.legs.length - 1 && (
                  <div className="flex items-center gap-2 px-6 text-xs text-slate-500 font-medium">
                    <ArrowRight className="w-3.5 h-3.5 text-indigo-400" />
                    <span>
                      ~15-20 min transit / coffee break before Hop #{index + 2}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Pass Code Copied Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          data-testid="pass-code-toast"
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl bg-slate-900 border border-emerald-500/50 px-4 py-2.5 text-xs font-semibold text-emerald-400 shadow-2xl backdrop-blur-md animate-in fade-in"
        >
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
