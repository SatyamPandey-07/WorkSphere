"use client";

import { useEffect, useState } from "react";
import { useUser as useClerkUser } from "@clerk/nextjs";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import {
  MapPin,
  Star,
  Heart,
  Zap,
  ArrowUpRight,
  ShieldCheck,
  RefreshCw,
  Calendar,
  ArrowLeft,
  Download,
  Mail,
  User as UserIcon,
  History,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
// Mock useUser for local development bypass if dummy keys are used
const useUser = () => {
  const isDummy =
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ===
    "pk_test_ZXhhbXBsZS5hY2NvdW50cy5kZXYk";
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const clerkUser = !isDummy ? useClerkUser() : null;

  if (isDummy) {
    return {
      isLoaded: true,
      isSignedIn: true,
      user: {
        firstName: "Nomad",
        lastName: "Scout",
        imageUrl: undefined as string | undefined,
        emailAddresses: [{ emailAddress: "nomad.scout@worksphere.dev" }],
      },
    };
  }
  return clerkUser || { isLoaded: false, isSignedIn: false, user: null };
};

interface Badge {
  id: string;
  name: string;
  description: string;
  earned: boolean;
  progress: number;
  target: number;
  icon: string;
}

interface UserAnalytics {
  profile: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    joinedAt: string;
  };
  summary: {
    totalResidencies: number;
    totalFavorites: number;
    totalRatings: number;
    totalConversations: number;
  };
  history: {
    bookings: any[];
    favorites: any[];
    ratings: any[];
  };
  gamification: {
    level: number;
    xp: number;
    xpInCurrentLevel: number;
    xpForNextLevel: number;
    progressPercent: number;
    xpBreakdown: {
      reviewsXp: number;
      venuesXp: number;
      speedtestsXp: number;
    };
    stats: {
      reviewsCount: number;
      venuesAddedCount: number;
      speedtestsCount: number;
      uniqueCafesBooked: number;
      nightOwlReviewsCount: number;
    };
    badges: Badge[];
  };
}

export default function AnalyticsDashboard() {
  const { user: clerkUser } = useUser();
  const [data, setData] = useState<UserAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const fetchUserStats = async () => {
    setLoading(true);
    try {
      if (
        process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ===
        "pk_test_ZXhhbXBsZS5hY2NvdW50cy5kZXYk"
      ) {
        const mockData: UserAnalytics = {
          profile: {
            id: "user_2test_dummy_id_12345",
            email: "nomad.scout@worksphere.dev",
            firstName: "Nomad",
            lastName: "Scout",
            joinedAt: new Date().toISOString(),
          },
          summary: {
            totalResidencies: 8,
            totalFavorites: 4,
            totalRatings: 5,
            totalConversations: 12,
          },
          history: {
            bookings: [
              {
                id: "booking_1",
                confirmationId: "WS-LEDGER-992A",
                date: "2026-07-10",
                time: "14:00 - 18:00",
                status: "CONFIRMED",
                venue: {
                  name: "Cyber Cafe Oasis",
                  category: "cafe",
                  address: "128 Neon Blvd, Sector 7",
                  latitude: 37.7749,
                  longitude: -122.4194,
                },
              },
              {
                id: "booking_2",
                confirmationId: "WS-LEDGER-881B",
                date: "2026-07-09",
                time: "09:00 - 17:00",
                status: "CONFIRMED",
                venue: {
                  name: "Prism Coworking",
                  category: "coworking",
                  address: "456 Spectrum Way",
                  latitude: 37.7858,
                  longitude: -122.4008,
                },
              },
            ],
            favorites: [
              {
                id: "fav_1",
                venue: {
                  name: "Cyber Cafe Oasis",
                  category: "cafe",
                },
              },
              {
                id: "fav_2",
                venue: {
                  name: "The Grid Library",
                  category: "library",
                },
              },
            ],
            ratings: [
              {
                id: "rating_1",
                venue: {
                  name: "Cyber Cafe Oasis",
                },
                comment: "Great gigabit connection!",
                wifiQuality: 5,
                hasOutlets: true,
                noiseLevel: "quiet",
                createdAt: new Date().toISOString(),
              },
            ],
          },
          gamification: {
            level: 3,
            xp: 350,
            xpInCurrentLevel: 50,
            xpForNextLevel: 300,
            progressPercent: 17,
            xpBreakdown: {
              reviewsXp: 150,
              venuesXp: 100,
              speedtestsXp: 100,
            },
            stats: {
              reviewsCount: 3,
              venuesAddedCount: 1,
              speedtestsCount: 2,
              uniqueCafesBooked: 2,
              nightOwlReviewsCount: 1,
            },
            badges: [
              {
                id: "wifi_scout",
                name: "WiFi Scout",
                description: "Verified 3+ venue speedtests.",
                earned: false,
                progress: 2,
                target: 3,
                icon: "wifi",
              },
              {
                id: "cafe_nomad",
                name: "Cafe Nomad",
                description: "Checked in/booked at 5 different cafes.",
                earned: false,
                progress: 2,
                target: 5,
                icon: "cafe",
              },
              {
                id: "night_owl",
                name: "Night Owl",
                description: "Left reviews at venues after 9 PM.",
                earned: true,
                progress: 1,
                target: 1,
                icon: "moon",
              },
            ],
          },
        };
        setData(mockData);
        setLoading(false);
        return;
      }

      const res = await fetch("/api/analytics");
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadReceipt = async (booking: {
    id: string;
    confirmationId: string;
    date: string;
    time: string;
    status: string;
    venue: { name: string; category: string; address?: string };
  }) => {
    setDownloadingId(booking.id);
    try {
      // Generate PDF entirely in the browser - blob: URLs bypass Service Worker completely!
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([595, 842]); // A4
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const { width, height } = page.getSize();
      let y = height - 50;

      const safe = (t: string | undefined | null) =>
        (t || "").replace(/[^\x20-\x7E]/g, "?");
      const text = (t: string, opts: object) => {
        try {
          page.drawText(t, opts);
        } catch {
          /* skip */
        }
      };

      // Header bar
      page.drawRectangle({
        x: 0,
        y: height - 10,
        width,
        height: 10,
        color: rgb(0.23, 0.51, 0.96),
      });
      y -= 60;
      text("WORKSPHERE CONFIRMATION", {
        x: 150,
        y,
        size: 24,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      y -= 15;
      text("SECURE NEURAL TRANSACTION RECEIPT", {
        x: 180,
        y,
        size: 8,
        font,
        color: rgb(0.5, 0.5, 0.5),
      });
      y -= 50;

      // Details
      text("BOOKING DETAILS:", {
        x: 50,
        y,
        size: 12,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      y -= 15;
      text("-".repeat(50), { x: 50, y, size: 10, font, color: rgb(0, 0, 0) });
      y -= 20;
      text(`REFERENCE ID: ${safe(booking.confirmationId)}`, {
        x: 50,
        y,
        size: 10,
        font,
        color: rgb(0, 0, 0),
      });
      y -= 18;
      text(`VENUE: ${safe(booking.venue.name)}`, {
        x: 50,
        y,
        size: 10,
        font,
        color: rgb(0, 0, 0),
      });
      y -= 18;
      text(`CATEGORY: ${safe(booking.venue.category?.toUpperCase())}`, {
        x: 50,
        y,
        size: 10,
        font,
        color: rgb(0, 0, 0),
      });
      y -= 18;
      text(`ADDRESS: ${safe(booking.venue.address || "Verified Workspace")}`, {
        x: 50,
        y,
        size: 10,
        font,
        color: rgb(0, 0, 0),
      });
      y -= 18;
      text(`SCHEDULE: ${safe(booking.date)} @ ${safe(booking.time)}`, {
        x: 50,
        y,
        size: 10,
        font,
        color: rgb(0, 0, 0),
      });
      y -= 18;
      text(`STATUS: ${safe(booking.status)}`, {
        x: 50,
        y,
        size: 10,
        font,
        color: rgb(0, 0, 0),
      });
      y -= 40;

      text("SECURITY PROTOCOL:", {
        x: 50,
        y,
        size: 12,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      y -= 18;
      text("ZERO-FEE ACCESS PROTOCOL ACTIVE", {
        x: 50,
        y,
        size: 10,
        font,
        color: rgb(0, 0, 0),
      });
      y -= 18;
      text("ENCRYPTED VIA WORKSPHERE L3", {
        x: 50,
        y,
        size: 10,
        font,
        color: rgb(0, 0, 0),
      });
      y -= 80;
      text(
        "Thank you for choosing WorkSphere. Your workspace is ready for you.",
        { x: 80, y, size: 8, font, color: rgb(0.4, 0.4, 0.4) },
      );

      const pdfBytes = await pdfDoc.save();
      // blob: URLs are NEVER intercepted by Service Workers
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], {
        type: "application/pdf",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `WorkSphere_Receipt_${booking.confirmationId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[PDF Client Error]:", err);
      alert("Failed to generate receipt. Please try again.");
    } finally {
      setDownloadingId(null);
    }
  };

  const handleViewVenue = (venue: {
    name: string;
    latitude?: number;
    longitude?: number;
    category: string;
  }) => {
    // Check if venue has coordinates
    if (!venue.latitude || !venue.longitude) {
      alert("Venue location not available");
      return;
    }

    // Navigate to AI dashboard with venue coordinates in URL
    const params = new URLSearchParams({
      venue: venue.name,
      lat: venue.latitude.toString(),
      lng: venue.longitude.toString(),
      category: venue.category,
    });
    window.open(`/ai?${params.toString()}`, "_blank");
  };

  useEffect(() => {
    fetchUserStats();
  }, []);

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-white dark:bg-zinc-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-12 h-12 text-blue-600 animate-spin" />
          <div className="text-center">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
              Decrypting Neural Identity...
            </p>
            <p className="text-[8px] font-bold text-zinc-400 mt-2 uppercase tracking-widest animate-pulse">
              Syncing Cloud Ledger
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (data && (data as any).error) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 font-sans flex items-center justify-center p-6">
        <div className="bg-red-500/10 border border-red-500/25 p-8 rounded-[2rem] max-w-md w-full text-center shadow-2xl">
          <h2 className="text-lg font-black text-red-500 uppercase tracking-wider mb-2">
            Neural Link Error
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-6 font-bold leading-relaxed">
            {(data as any).error}
          </p>
          <button
            onClick={fetchUserStats}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-blue-500/20"
          >
            Retry Handshake
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 font-sans selection:bg-blue-500 selection:text-white">
      <div className="max-w-7xl mx-auto p-6 md:p-12 space-y-12">
        {/* Navigation & User Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
          <div className="space-y-4">
            <Link
              href="/ai"
              className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-blue-600 transition-colors group"
            >
              <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-1 transition-transform" />
              Back to Core Hub
            </Link>
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-[2rem] bg-gradient-to-br from-blue-600 to-indigo-700 p-0.5 shadow-2xl shadow-blue-500/20">
                <div className="w-full h-full rounded-[1.9rem] bg-white dark:bg-zinc-900 flex items-center justify-center overflow-hidden">
                  {clerkUser?.imageUrl ? (
                    <Image
                      src={clerkUser.imageUrl}
                      alt="Profile"
                      className="w-full h-full object-cover"
                      width={80}
                      height={80}
                      unoptimized
                    />
                  ) : (
                    <UserIcon className="w-8 h-8 text-zinc-400" />
                  )}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-2 py-0.5 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 text-[8px] font-black uppercase tracking-[0.2em] rounded">
                    VERIFIED MEMBER
                  </span>
                  {data?.gamification && (
                    <span className="px-2 py-0.5 bg-blue-600 text-white text-[8px] font-black uppercase tracking-[0.2em] rounded">
                      LVL {data?.gamification?.level}
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-[8px] font-black text-blue-500 uppercase tracking-widest">
                    <ShieldCheck className="w-3 h-3" />
                    Neural Link Active
                  </span>
                </div>
                <h1 className="text-4xl font-black uppercase tracking-tighter leading-none">
                  {data?.profile?.firstName || "Neural"}{" "}
                  <span className="text-blue-600">
                    {data?.profile?.lastName || "Profile"}
                  </span>
                </h1>
                <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest mt-2 flex items-center gap-2">
                  <Mail className="w-3 h-3" /> {data?.profile?.email}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchUserStats}
              className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl hover:bg-zinc-50 transition-all active:scale-95 shadow-sm"
            >
              <RefreshCw
                className={`w-5 h-5 ${loading ? "animate-spin" : ""}`}
              />
            </button>
            <div className="h-10 w-px bg-zinc-200 dark:bg-zinc-800 mx-2" />
            <div className="text-right hidden lg:block">
              <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest leading-none mb-1">
                Total Residencies
              </p>
              <p className="text-2xl font-black text-zinc-900 dark:text-zinc-50 leading-none">
                {data?.summary?.totalResidencies || 0}
              </p>
            </div>
          </div>
        </div>

        {/* Summary Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            {
              label: "Bookings",
              value: data?.summary?.totalResidencies,
              icon: Calendar,
              color: "text-blue-500",
              bg: "bg-blue-500/10",
            },
            {
              label: "Favorites",
              value: data?.summary?.totalFavorites,
              icon: Heart,
              color: "text-red-500",
              bg: "bg-red-500/10",
            },
            {
              label: "Ratings",
              value: data?.summary?.totalRatings,
              icon: Star,
              color: "text-orange-500",
              bg: "bg-orange-500/10",
            },
            {
              label: "Sessions",
              value: data?.summary?.totalConversations,
              icon: History,
              color: "text-purple-500",
              bg: "bg-purple-500/10",
            },
          ].map((stat, i) => (
            <div
              key={i}
              className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-8 rounded-[2.5rem] shadow-sm group hover:border-blue-500/30 transition-all hover:shadow-2xl hover:shadow-blue-500/5"
            >
              <div
                className={`p-4 w-max rounded-2xl ${stat.bg} mb-6 group-hover:scale-110 transition-transform`}
              >
                <stat.icon className={`w-8 h-8 ${stat.color}`} />
              </div>
              <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">
                {stat.label}
              </div>
              <div className="text-4xl font-black leading-none">
                {stat.value || 0}
              </div>
            </div>
          ))}
        </div>

        {/* Level Progress Card */}
        {data?.gamification && (
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-8 rounded-[2.5rem] shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-6">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <span className="px-3 py-1 bg-blue-500/10 text-blue-500 text-[9px] font-black uppercase tracking-wider rounded-full">
                    Rank Progress
                  </span>
                  <span className="text-[10px] text-zinc-400 font-mono">
                    XP: {data?.gamification?.xp} /{" "}
                    {(data?.gamification?.xp || 0) -
                      (data?.gamification?.xpInCurrentLevel || 0) +
                      (data?.gamification?.xpForNextLevel || 0)}
                  </span>
                </div>
                <h2 className="text-3xl font-black uppercase tracking-tighter">
                  Level {data?.gamification?.level}{" "}
                  <span className="text-blue-600">Workspace Scout</span>
                </h2>
              </div>
              <div className="text-left md:text-right">
                <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest mb-1">
                  XP Breakdown
                </p>
                <div className="flex flex-wrap gap-4 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  <span>
                    Reviews: {data?.gamification?.xpBreakdown?.reviewsXp} XP
                  </span>
                  <span>
                    Venues: {data?.gamification?.xpBreakdown?.venuesXp} XP
                  </span>
                  <span>
                    Speedtests: {data?.gamification?.xpBreakdown?.speedtestsXp}{" "}
                    XP
                  </span>
                </div>
              </div>
            </div>

            <div className="relative w-full h-4 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden p-0.5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 shadow-[0_0_12px_rgba(37,99,235,0.5)] transition-all duration-1000 ease-out"
                style={{
                  width: `${data?.gamification?.progressPercent || 0}%`,
                }}
              />
            </div>
            <div className="flex justify-between items-center mt-3 text-[10px] font-black uppercase tracking-widest text-zinc-400">
              <span>LVL {data?.gamification?.level}</span>
              <span>
                {(data?.gamification?.xpForNextLevel || 0) -
                  (data?.gamification?.xpInCurrentLevel || 0)}{" "}
                XP to Level {(data?.gamification?.level || 0) + 1}
              </span>
              <span>LVL {(data?.gamification?.level || 0) + 1}</span>
            </div>
          </div>
        )}

        {/* Dual Column Layout: History & Profile */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          {/* Recent Bookings (Main Column) */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-black uppercase tracking-tighter flex items-center gap-3">
                <History className="w-6 h-6 text-blue-600" />
                Residency Ledger
              </h2>
              <button className="text-[9px] font-black uppercase tracking-widest text-blue-600 hover:bg-blue-600 hover:text-white px-3 py-1 rounded transition-colors">
                View Full Chain
              </button>
            </div>

            <div className="grid gap-4">
              {data?.history?.bookings?.map((booking, i) => (
                <div
                  key={i}
                  className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-[2rem] p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 hover:shadow-xl hover:shadow-zinc-900/5 transition-all group"
                >
                  <div className="flex items-center gap-5">
                    <div className="w-16 h-16 rounded-[1.25rem] bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center border border-zinc-100 dark:border-zinc-700">
                      <MapPin className="w-6 h-6 text-zinc-300 group-hover:text-blue-500 transition-colors" />
                    </div>
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="text-base font-black uppercase tracking-tight">
                          {booking.venue.name}
                        </h3>
                        <span
                          className={`text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wider ${
                            booking.status === "CONFIRMED"
                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                              : booking.status === "PENDING"
                                ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                                : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          }`}
                        >
                          {booking.status}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 font-bold mb-1">
                        {booking.venue.category}
                      </p>
                      <p className="text-[10px] text-zinc-400 font-mono">
                        ID: {booking.confirmationId}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className="text-sm font-black uppercase tracking-tight leading-none mb-1">
                        {booking.date}
                      </p>
                      <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest">
                        {booking.time}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDownloadReceipt(booking)}
                        disabled={downloadingId === booking.id}
                        className="p-4 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 rounded-2xl hover:scale-110 transition-transform shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                        title="Download Receipt"
                      >
                        {downloadingId === booking.id ? (
                          <RefreshCw className="w-5 h-5 animate-spin" />
                        ) : (
                          <Download className="w-5 h-5" />
                        )}
                      </button>
                      <button
                        onClick={() => handleViewVenue(booking.venue)}
                        className="p-4 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 rounded-2xl hover:scale-110 transition-transform shadow-lg"
                        title="View on Map"
                      >
                        <ExternalLink className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {(!data?.history?.bookings ||
                data.history.bookings.length === 0) && (
                <div className="py-20 bg-white dark:bg-zinc-900/50 rounded-[2.5rem] border border-dashed border-zinc-200 dark:border-zinc-800 flex flex-col items-center justify-center text-center px-12">
                  <Zap className="w-12 h-12 text-zinc-200 mb-4" />
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
                    No Signal History Recorded
                  </p>
                  <p className="text-xs text-zinc-500 font-bold mt-2 leading-relaxed">
                    Book a workspace node to begin populating your personal
                    neural ledger.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Personal Nodes & Favorites (Side Panel) */}
          <div className="space-y-8">
            <div>
              <h2 className="text-xs font-black uppercase tracking-widest text-zinc-400 mb-6 flex items-center gap-2">
                <Heart className="w-4 h-4 text-red-500" />
                High-Signal Nodes
              </h2>
              <div className="space-y-3">
                {data?.history?.favorites?.map((fav, i) => (
                  <div
                    key={i}
                    className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 p-4 rounded-2xl flex items-center gap-3 hover:border-red-500/30 transition-all"
                  >
                    <div className="w-10 h-10 rounded-xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center text-zinc-300">
                      <Zap className="w-5 h-5" />
                    </div>
                    <div>
                      <h5 className="text-[11px] font-black uppercase tracking-tight truncate max-w-[140px]">
                        {fav.venue.name}
                      </h5>
                      <p className="text-[8px] font-black text-zinc-400 uppercase tracking-widest">
                        {fav.venue.category}
                      </p>
                    </div>
                    <ArrowUpRight className="w-4 h-4 text-zinc-300 ml-auto" />
                  </div>
                ))}
                {(!data?.history?.favorites ||
                  data.history.favorites.length === 0) && (
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest py-4 border-2 border-dashed border-zinc-100 dark:border-zinc-800 rounded-2xl text-center">
                    No favorites logged
                  </p>
                )}
              </div>
            </div>

            {/* Nomad Achievements Widget */}
            {data?.gamification && (
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-8 rounded-[2.5rem] shadow-sm space-y-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-blue-500" />
                    Nomad Achievements
                  </h3>
                  <span className="text-[10px] font-mono text-zinc-400">
                    {data?.gamification?.badges?.filter((b) => b.earned)
                      .length || 0}{" "}
                    / {data?.gamification?.badges?.length || 0} Earned
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  {data?.gamification?.badges?.map((badge) => (
                    <div
                      key={badge.id}
                      className="group relative flex flex-col items-center"
                    >
                      {/* Badge Icon container */}
                      <div
                        className={`relative w-16 h-16 rounded-2xl flex items-center justify-center p-0.5 transition-all duration-300 group-hover:scale-105 ${
                          badge.earned
                            ? "bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 shadow-lg shadow-indigo-500/20"
                            : "bg-zinc-100 dark:bg-zinc-800 grayscale opacity-40 group-hover:opacity-60 border border-zinc-200 dark:border-zinc-700"
                        }`}
                      >
                        <div className="w-full h-full rounded-[14px] bg-white dark:bg-zinc-955 flex items-center justify-center">
                          {/* Render SVG Badge */}
                          {badge.icon === "wifi" && (
                            <svg
                              className="w-8 h-8 text-blue-500"
                              viewBox="0 0 24 24"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <path
                                d="M12 20H12.01M8.5 16.5C9.5 15.5 10.75 15 12 15C13.25 15 14.5 15.5 15.5 16.5M5 13C7 11 9.5 10 12 10C14.5 10 17 11 19 13M1.5 9.5C4.5 6.5 8.25 5 12 5C15.75 5 19.5 6.5 22.5 9.5"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                          {badge.icon === "cafe" && (
                            <svg
                              className="w-8 h-8 text-emerald-500"
                              viewBox="0 0 24 24"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <path
                                d="M17 8H19C20.1046 8 21 8.89543 21 10V12C21 13.1046 20.1046 14 19 14H17M3 8H17V14C17 17.3137 14.3137 20 11 20H9C5.68629 20 3 17.3137 3 14V8Z"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <path
                                d="M6 2V5M10 2V5M14 2V5"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                          {badge.icon === "moon" && (
                            <svg
                              className="w-8 h-8 text-purple-500"
                              viewBox="0 0 24 24"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <path
                                d="M12 3C10.8251 4.17493 10.1762 5.76045 10.1762 7.41727C10.1762 9.07409 10.8251 10.6596 12 11.8345C10.2223 11.954 8.46823 11.3644 7.15949 10.2078C5.85074 9.05121 5.09341 7.42398 5.07019 5.71536C5.04698 4.00673 5.76001 2.36199 7.03714 1.1766C4.84656 2.01254 3.06456 3.65484 2.03666 5.78523C1.00876 7.91563 0.814324 10.3601 1.491 12.6457C2.16768 14.9312 3.6631 16.8778 5.68725 18.1077C7.7114 19.3377 10.1066 19.7523 12.41 19.2711C14.7134 18.79 16.7454 17.4514 18.1132 15.5146C19.481 13.5779 20.076 11.2037 19.7828 8.85236C19.4897 6.50106 18.3308 4.3648 16.5305 2.85764C14.7302 1.35048 12.4287 0.591079 10.072 0.725998C10.7485 1.40879 11.4552 2.16239 12 3Z"
                                fill="currentColor"
                              />
                            </svg>
                          )}
                        </div>
                      </div>

                      <span className="text-[8px] font-black uppercase tracking-tight mt-1.5 text-center text-zinc-700 dark:text-zinc-350">
                        {badge.name}
                      </span>

                      {/* Tooltip with details */}
                      <div className="absolute bottom-20 scale-95 opacity-0 pointer-events-none z-30 w-44 rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-[10px] text-white shadow-2xl origin-bottom transition-all duration-150 ease-out group-hover:scale-100 group-hover:opacity-100 group-hover:delay-100">
                        <div className="font-black uppercase tracking-wider text-[9px] mb-1 flex items-center justify-between">
                          <span>{badge.name}</span>
                          <span
                            className={`text-[7px] px-1.5 py-0.5 rounded font-mono ${
                              badge.earned
                                ? "bg-green-500/20 text-green-400"
                                : "bg-zinc-800 text-zinc-400"
                            }`}
                          >
                            {badge.earned ? "UNLOCKED" : "LOCKED"}
                          </span>
                        </div>
                        <p className="text-zinc-400 font-bold leading-snug mb-2">
                          {badge.description}
                        </p>
                        <div className="w-full bg-zinc-800 rounded-full h-1">
                          <div
                            className={`h-full rounded-full ${badge.earned ? "bg-green-400" : "bg-blue-500"}`}
                            style={{
                              width: `${(badge.progress / badge.target) * 100}%`,
                            }}
                          />
                        </div>
                        <div className="flex justify-between items-center mt-1 text-[7px] font-mono text-zinc-500">
                          <span>Progress</span>
                          <span>
                            {badge.progress} / {badge.target}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="p-8 bg-zinc-900 dark:bg-blue-600 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-10 opacity-10 group-hover:scale-125 transition-transform duration-1000">
                <RefreshCw className="w-40 h-40" />
              </div>
              <h3 className="text-xl font-black uppercase tracking-tighter mb-4 relative">
                Neural Sync
              </h3>
              <p className="text-[10px] font-bold text-white/60 leading-relaxed relative uppercase tracking-widest">
                Your profile is synchronized with the global WorkSphere node
                network. Every interaction creates a permanent signal in your
                encrypted ledger.
              </p>
              <div className="mt-8 flex items-center gap-4 relative">
                <div className="text-center">
                  <p className="text-2xl font-black leading-none">
                    {data?.summary?.totalConversations || 0}
                  </p>
                  <p className="text-[8px] font-black uppercase tracking-widest text-white/40">
                    Sessions
                  </p>
                </div>
                <div className="w-px h-8 bg-white/20" />
                <div className="text-center">
                  <p className="text-2xl font-black leading-none">
                    {data?.summary?.totalRatings || 0}
                  </p>
                  <p className="text-[8px] font-black uppercase tracking-widest text-white/40">
                    Feedback
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
