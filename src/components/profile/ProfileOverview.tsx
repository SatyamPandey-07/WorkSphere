"use client";

import React from "react";
import { WingmanBadge, calculateFlightRank } from "./WingmanBadge";
import { MapPin, Calendar, Clock, Award, Users } from "lucide-react";

export interface ProfileOverviewProps {
  user?: {
    name?: string;
    username?: string;
    avatarUrl?: string;
    location?: string;
    joinedDate?: string;
  };
  stats?: {
    coWorkingHours?: number;
    sharedSessionsCount?: number;
    visitedVenuesCount?: number;
    checkInStreakDays?: number;
  };
  className?: string;
}

export function ProfileOverview({
  user = {
    name: "Alex Nomad",
    username: "alexnomad",
    location: "Global Remote",
    joinedDate: "Member since Jan 2024",
  },
  stats = {
    coWorkingHours: 65,
    sharedSessionsCount: 14,
    visitedVenuesCount: 12,
    checkInStreakDays: 8,
  },
  className = "",
}: ProfileOverviewProps) {
  const coWorkingHours = stats.coWorkingHours ?? 0;
  const sharedSessionsCount = stats.sharedSessionsCount ?? 0;
  const currentRank = calculateFlightRank(coWorkingHours);

  return (
    <div
      data-testid="profile-overview-card"
      className={`rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/70 ${className}`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* User identification */}
        <div className="flex items-center gap-4">
          <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-sky-600 text-xl font-bold text-white shadow-inner">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.name || "User avatar"}
                className="h-full w-full rounded-2xl object-cover"
              />
            ) : (
              (user.name || "UN").slice(0, 2).toUpperCase()
            )}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
                {user.name}
              </h2>
              {user.username && (
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  @{user.username}
                </span>
              )}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
              {user.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {user.location}
                </span>
              )}
              {user.joinedDate && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {user.joinedDate}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Flight Wingman Badge */}
        <div className="flex items-center">
          <WingmanBadge
            coWorkingHours={coWorkingHours}
            sharedSessionsCount={sharedSessionsCount}
            size="md"
          />
        </div>
      </div>

      {/* Collaborative and Activity Metrics */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-zinc-150 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <Clock className="h-3.5 w-3.5 text-sky-500" />
            <span>Co-working</span>
          </div>
          <p className="mt-1 text-base font-bold text-zinc-900 dark:text-zinc-50">
            {coWorkingHours} hrs
          </p>
        </div>

        <div className="rounded-xl border border-zinc-150 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <Users className="h-3.5 w-3.5 text-indigo-500" />
            <span>Shared Sessions</span>
          </div>
          <p className="mt-1 text-base font-bold text-zinc-900 dark:text-zinc-50">
            {sharedSessionsCount}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-150 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <Award className="h-3.5 w-3.5 text-emerald-500" />
            <span>Wingman Level</span>
          </div>
          <p className="mt-1 text-sm font-bold text-zinc-900 dark:text-zinc-50">
            {currentRank.tier}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-150 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <MapPin className="h-3.5 w-3.5 text-amber-500" />
            <span>Venues Visited</span>
          </div>
          <p className="mt-1 text-base font-bold text-zinc-900 dark:text-zinc-50">
            {stats.visitedVenuesCount ?? 0}
          </p>
        </div>
      </div>
    </div>
  );
}

export default ProfileOverview;
