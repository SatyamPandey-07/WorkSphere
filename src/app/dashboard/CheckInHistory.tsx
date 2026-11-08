"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { MapPin, Wifi, Calendar, Download, Loader2 } from "lucide-react";

interface CheckInRecord {
  id: string;
  checkedInAt: string;
  expiresAt: string;
  active: boolean;
  venue: {
    id: string;
    name: string;
    address: string | null;
    category: string;
    wifiQuality: number | null;
    wifiSpeed: number | null;
  };
}

type WifiStatus = "Excellent" | "Good" | "Fair" | "Poor" | "Unknown";

function wifiStatus(venue: CheckInRecord["venue"]): WifiStatus {
  if (venue.wifiSpeed) {
    return venue.wifiSpeed >= 100
      ? "Excellent"
      : venue.wifiSpeed >= 30
        ? "Good"
        : venue.wifiSpeed >= 10
          ? "Fair"
          : "Poor";
  }
  if (venue.wifiQuality) {
    return venue.wifiQuality >= 5
      ? "Excellent"
      : venue.wifiQuality >= 4
        ? "Good"
        : venue.wifiQuality >= 3
          ? "Fair"
          : "Poor";
  }
  return "Unknown";
}

const getWifiBadgeStyle = (status: WifiStatus) => {
  switch (status) {
    case "Excellent":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30";
    case "Good":
      return "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400 border-blue-200 dark:border-blue-500/30";
    case "Fair":
      return "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400 border-amber-200 dark:border-amber-500/30";
    case "Poor":
      return "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400 border-red-200 dark:border-red-500/30";
    default:
      return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700";
  }
};

function formatWhen(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  if (date.toDateString() === today.toDateString()) return `Today, ${time}`;
  if (date.toDateString() === yesterday.toDateString())
    return `Yesterday, ${time}`;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

function downloadAsJson(checkIns: CheckInRecord[]) {
  const records = checkIns.map((c) => ({
    venue: c.venue.name,
    address: c.venue.address,
    checkedInAt: c.checkedInAt,
  }));
  const blob = new Blob([JSON.stringify(records, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "worksphere-check-ins.json";
  a.click();
  URL.revokeObjectURL(url);
}

export function CheckInHistory() {
  const [checkIns, setCheckIns] = useState<CheckInRecord[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/user/check-ins")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (!cancelled) setCheckIns(data.checkIns ?? []);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 flex flex-col max-h-[500px]">
      <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <MapPin className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Check-in history
          </h2>
        </div>
        {checkIns && checkIns.length > 0 && (
          <button
            type="button"
            onClick={() => downloadAsJson(checkIns)}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors"
            aria-label="Export check-in history (JSON)"
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </button>
        )}
      </div>

      <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
        {error ? (
          <p className="text-sm text-red-600">
            Couldn&apos;t load your check-ins.
          </p>
        ) : checkIns === null ? (
          <div className="flex justify-center py-8" role="status">
            <Loader2 className="w-6 h-6 animate-spin accent-text" />
          </div>
        ) : checkIns.length === 0 ? (
          <p className="text-sm text-zinc-500 text-center py-8">
            No check-ins yet. Check in from a venue page when you start working
            there to build your streak.
          </p>
        ) : (
          <div className="relative border-l-2 border-zinc-100 dark:border-zinc-800 ml-3 space-y-6">
            {checkIns.map((checkIn) => {
              const status = wifiStatus(checkIn.venue);
              return (
                <div key={checkIn.id} className="relative pl-6 group">
                  <div className="absolute w-4 h-4 rounded-full bg-white dark:bg-zinc-900 border-2 accent-border -left-[9px] top-1.5" />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/venues/${checkIn.venue.id}`}
                        className="text-base font-semibold text-zinc-900 dark:text-zinc-50 hover:text-[var(--primary-accent)] transition-colors truncate block"
                      >
                        {checkIn.venue.name}
                      </Link>
                      <div className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        <Calendar className="w-3.5 h-3.5 shrink-0" />
                        <span>{formatWhen(checkIn.checkedInAt)}</span>
                        {checkIn.active && (
                          <span className="ml-1 text-xs font-semibold text-green-600 dark:text-green-400">
                            · Here now
                          </span>
                        )}
                      </div>
                    </div>
                    {status !== "Unknown" && (
                      <div
                        className={`shrink-0 px-2.5 py-1 rounded-full border text-xs font-semibold flex items-center gap-1.5 ${getWifiBadgeStyle(status)}`}
                      >
                        <Wifi className="w-3 h-3" />
                        {status}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
