"use client";

import React from "react";
import {
  Car,
  CircleDollarSign,
  Bike,
  Shield,
  Wifi,
  Zap,
  VolumeX,
  Calendar,
  Printer,
  BarChart3,
  Trophy,
  BadgeCheck,
} from "lucide-react";
import type { Venue } from "../ChatMessages";
import { AmenityVoteBreakdownModal } from "../AmenityVoteBreakdownModal";
import type {
  AmenityKey,
  VoteMetricState,
  AmenityLeaderboardEntry,
} from "./useVenueAmenityVotes";

export interface VenueAmenityVotingProps {
  venue: Venue;
  voteMetrics: Record<string, VoteMetricState>;
  submitAmenityVote: (amenityKey: AmenityKey, isUpvote: boolean) => void;
  showVoteBreakdown: boolean;
  setShowVoteBreakdown: (show: boolean) => void;
  showLeaderboard: boolean;
  setShowLeaderboard: (show: boolean) => void;
  leaderboard: AmenityLeaderboardEntry[];
  isLibrary: boolean;
  className?: string;
  testId?: string;
}

export function VenueAmenityVoting({
  venue,
  voteMetrics,
  submitAmenityVote,
  showVoteBreakdown,
  setShowVoteBreakdown,
  showLeaderboard,
  setShowLeaderboard,
  leaderboard = [],
  isLibrary,
  className = "",
  testId = "venue-amenity-voting",
}: VenueAmenityVotingProps) {
  const metrics = voteMetrics || {};

  return (
    <div data-testid={testId} className={className}>
      {/* Parking and Transportation Amenity Tags */}
      <div className="flex flex-wrap gap-2 mb-4">
        {/* Free Street Parking Tag */}
        {!metrics.freeStreetParking?.hidden && (
          <div
            data-testid="amenity-tag-freeStreetParking"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
              (metrics.freeStreetParking?.confidenceScore ?? 100) < 60
                ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                : "border-white/10 bg-black/20 text-zinc-300"
            }`}
          >
            <Car className="w-3.5 h-3.5 text-blue-400" />
            <span className="font-medium font-mono text-[11px]">
              Street Parking ({metrics.freeStreetParking?.confidenceScore ?? 100}%)
            </span>

            <div className="ml-1 flex items-center border-l border-white/20 pl-1.5 gap-1 text-[10px]">
              <button
                type="button"
                data-testid="vote-up-freeStreetParking"
                aria-label="Upvote street parking"
                aria-pressed={metrics.freeStreetParking?.userVote === true}
                onClick={() => submitAmenityVote("freeStreetParking", true)}
                className={`transition-colors ${
                  metrics.freeStreetParking?.userVote === true
                    ? "text-green-400 font-bold"
                    : "hover:text-green-400"
                }`}
              >
                👍
              </button>
              <button
                type="button"
                data-testid="vote-down-freeStreetParking"
                aria-label="Downvote street parking"
                aria-pressed={metrics.freeStreetParking?.userVote === false}
                onClick={() => submitAmenityVote("freeStreetParking", false)}
                className={`transition-colors ${
                  metrics.freeStreetParking?.userVote === false
                    ? "text-red-400 font-bold"
                    : "hover:text-red-400"
                }`}
              >
                👎
              </button>
            </div>
          </div>
        )}

        {/* Paid Garage Tag */}
        {!metrics.paidGarage?.hidden && (
          <div
            data-testid="amenity-tag-paidGarage"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
              (metrics.paidGarage?.confidenceScore ?? 100) < 60
                ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                : "border-white/10 bg-black/20 text-zinc-300"
            }`}
          >
            <CircleDollarSign className="w-3.5 h-3.5 text-emerald-500" />
            <span className="font-medium font-mono text-[11px]">
              Paid Garage ({metrics.paidGarage?.confidenceScore ?? 100}%)
            </span>

            <div className="ml-1 flex items-center border-l border-white/20 pl-1.5 gap-1 text-[10px]">
              <button
                type="button"
                data-testid="vote-up-paidGarage"
                aria-label="Upvote paid garage"
                aria-pressed={metrics.paidGarage?.userVote === true}
                onClick={() => submitAmenityVote("paidGarage", true)}
                className={`transition-colors ${
                  metrics.paidGarage?.userVote === true
                    ? "text-green-400 font-bold"
                    : "hover:text-green-400"
                }`}
              >
                👍
              </button>
              <button
                type="button"
                data-testid="vote-down-paidGarage"
                aria-label="Downvote paid garage"
                aria-pressed={metrics.paidGarage?.userVote === false}
                onClick={() => submitAmenityVote("paidGarage", false)}
                className={`transition-colors ${
                  metrics.paidGarage?.userVote === false
                    ? "text-red-400 font-bold"
                    : "hover:text-red-400"
                }`}
              >
                👎
              </button>
            </div>
          </div>
        )}

        {/* Bicycle Rack Tag */}
        {!metrics.bicycleRack?.hidden && (
          <div
            data-testid="amenity-tag-bicycleRack"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
              (metrics.bicycleRack?.confidenceScore ?? 100) < 60
                ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                : "border-white/10 bg-black/20 text-zinc-300"
            }`}
          >
            <Bike className="w-3.5 h-3.5 text-orange-400" />
            <span className="font-medium font-mono text-[11px]">
              Bicycle Rack ({metrics.bicycleRack?.confidenceScore ?? 100}%)
            </span>

            <div className="ml-1 flex items-center border-l border-white/20 pl-1.5 gap-1 text-[10px]">
              <button
                type="button"
                data-testid="vote-up-bicycleRack"
                aria-label="Upvote bicycle rack"
                aria-pressed={metrics.bicycleRack?.userVote === true}
                onClick={() => submitAmenityVote("bicycleRack", true)}
                className={`transition-colors ${
                  metrics.bicycleRack?.userVote === true
                    ? "text-green-400 font-bold"
                    : "hover:text-green-400"
                }`}
              >
                👍
              </button>
              <button
                type="button"
                data-testid="vote-down-bicycleRack"
                aria-label="Downvote bicycle rack"
                aria-pressed={metrics.bicycleRack?.userVote === false}
                onClick={() => submitAmenityVote("bicycleRack", false)}
                className={`transition-colors ${
                  metrics.bicycleRack?.userVote === false
                    ? "text-red-400 font-bold"
                    : "hover:text-red-400"
                }`}
              >
                👎
              </button>
            </div>
          </div>
        )}

        {/* Secure Motorcycle Parking Tag */}
        {!metrics.secureMotorcycleParking?.hidden && (
          <div
            data-testid="amenity-tag-secureMotorcycleParking"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
              (metrics.secureMotorcycleParking?.confidenceScore ?? 100) < 60
                ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                : "border-white/10 bg-black/20 text-zinc-300"
            }`}
          >
            <Shield className="w-3.5 h-3.5 text-zinc-400" />
            <span className="font-medium font-mono text-[11px]">
              Moto Parking ({metrics.secureMotorcycleParking?.confidenceScore ?? 100}%)
            </span>

            <div className="ml-1 flex items-center border-l border-white/20 pl-1.5 gap-1 text-[10px]">
              <button
                type="button"
                data-testid="vote-up-secureMotorcycleParking"
                aria-label="Upvote motorcycle parking"
                aria-pressed={metrics.secureMotorcycleParking?.userVote === true}
                onClick={() => submitAmenityVote("secureMotorcycleParking", true)}
                className={`transition-colors ${
                  metrics.secureMotorcycleParking?.userVote === true
                    ? "text-green-400 font-bold"
                    : "hover:text-green-400"
                }`}
              >
                👍
              </button>
              <button
                type="button"
                data-testid="vote-down-secureMotorcycleParking"
                aria-label="Downvote motorcycle parking"
                aria-pressed={metrics.secureMotorcycleParking?.userVote === false}
                onClick={() => submitAmenityVote("secureMotorcycleParking", false)}
                className={`transition-colors ${
                  metrics.secureMotorcycleParking?.userVote === false
                    ? "text-red-400 font-bold"
                    : "hover:text-red-400"
                }`}
              >
                👎
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Interactive Amenity Verification Tag Tracking Row */}
      <div className="flex flex-col gap-2 mt-6 border-t border-white/10 pt-4">
        <span className="text-[10px] font-bold text-zinc-400 tracking-wider uppercase">
          Verify Amenities:
        </span>

        <div className="flex flex-wrap gap-2">
          {/* WiFi Tag Check Node */}
          {!metrics.wifi?.hidden && (
            <div
              data-testid="amenity-tag-wifi"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                (metrics.wifi?.confidenceScore ?? 100) < 60
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                  : "border-white/10 bg-black/20 text-zinc-300"
              }`}
            >
              <Wifi className="w-3.5 h-3.5 text-blue-400" />
              <span className="font-medium font-mono text-[11px]">
                WiFi ({metrics.wifi?.confidenceScore ?? 100}%)
              </span>

              <div className="ml-1 flex items-center border-l border-white/20 pl-1.5 gap-1 text-[10px]">
                <button
                  type="button"
                  data-testid="vote-up-wifi"
                  aria-label="Upvote wifi"
                  aria-pressed={metrics.wifi?.userVote === true}
                  onClick={() => submitAmenityVote("wifi", true)}
                  className={`transition-colors ${
                    metrics.wifi?.userVote === true
                      ? "text-green-400 font-bold"
                      : "hover:text-green-400"
                  }`}
                >
                  👍
                </button>
                <button
                  type="button"
                  data-testid="vote-down-wifi"
                  aria-label="Downvote wifi"
                  aria-pressed={metrics.wifi?.userVote === false}
                  onClick={() => submitAmenityVote("wifi", false)}
                  className={`transition-colors ${
                    metrics.wifi?.userVote === false
                      ? "text-red-400 font-bold"
                      : "hover:text-red-400"
                  }`}
                >
                  👎
                </button>
              </div>
            </div>
          )}

          {/* Outlets Tag Check Node */}
          {venue?.hasOutlets && !metrics.outlets?.hidden && (
            <div
              data-testid="amenity-tag-outlets"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                (metrics.outlets?.confidenceScore ?? 100) < 60
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                  : "border-white/10 bg-black/20 text-zinc-300"
              }`}
            >
              <Zap className="w-3.5 h-3.5 text-yellow-400" />
              <span className="font-medium font-mono text-[11px]">
                Outlets ({metrics.outlets?.confidenceScore ?? 100}%)
              </span>

              <div className="ml-1 flex items-center border-l border-white/20 pl-1.5 gap-1 text-[10px]">
                <button
                  type="button"
                  data-testid="vote-up-outlets"
                  aria-label="Upvote outlets"
                  aria-pressed={metrics.outlets?.userVote === true}
                  onClick={() => submitAmenityVote("outlets", true)}
                  className={`transition-colors ${
                    metrics.outlets?.userVote === true
                      ? "text-green-400 font-bold"
                      : "hover:text-green-400"
                  }`}
                >
                  👍
                </button>
                <button
                  type="button"
                  data-testid="vote-down-outlets"
                  aria-label="Downvote outlets"
                  aria-pressed={metrics.outlets?.userVote === false}
                  onClick={() => submitAmenityVote("outlets", false)}
                  className={`transition-colors ${
                    metrics.outlets?.userVote === false
                      ? "text-red-400 font-bold"
                      : "hover:text-red-400"
                  }`}
                >
                  👎
                </button>
              </div>
            </div>
          )}

          {/* Strict Silent Rooms Tag */}
          {isLibrary && !metrics.silentRoom?.hidden && (
            <div
              data-testid="amenity-tag-silentRoom"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                (metrics.silentRoom?.confidenceScore ?? 100) < 60
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                  : "border-white/10 bg-black/20 text-zinc-300"
              }`}
            >
              <VolumeX className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-medium font-mono text-[11px]">
                Silent Room ({metrics.silentRoom?.confidenceScore ?? 100}%)
              </span>

              <div className="ml-1 flex items-center border-l border-white/20 pl-1.5 gap-1 text-[10px]">
                <button
                  type="button"
                  data-testid="vote-up-silentRoom"
                  aria-label="Upvote silent room"
                  aria-pressed={metrics.silentRoom?.userVote === true}
                  onClick={() => submitAmenityVote("silentRoom", true)}
                  className={`transition-colors ${
                    metrics.silentRoom?.userVote === true
                      ? "text-green-400 font-bold"
                      : "hover:text-green-400"
                  }`}
                >
                  👍
                </button>
                <button
                  type="button"
                  data-testid="vote-down-silentRoom"
                  aria-label="Downvote silent room"
                  aria-pressed={metrics.silentRoom?.userVote === false}
                  onClick={() => submitAmenityVote("silentRoom", false)}
                  className={`transition-colors ${
                    metrics.silentRoom?.userVote === false
                      ? "text-red-400 font-bold"
                      : "hover:text-red-400"
                  }`}
                >
                  👎
                </button>
              </div>
            </div>
          )}

          {/* Bookable Study Tables Tag */}
          {isLibrary && !metrics.studyTable?.hidden && (
            <div
              data-testid="amenity-tag-studyTable"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                (metrics.studyTable?.confidenceScore ?? 100) < 60
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                  : "border-white/10 bg-black/20 text-zinc-300"
              }`}
            >
              <Calendar className="w-3.5 h-3.5 text-indigo-400" />
              <span className="font-medium font-mono text-[11px]">
                Study Tables ({metrics.studyTable?.confidenceScore ?? 100}%)
              </span>

              <div className="ml-1 flex items-center border-l border-white/20 pl-1.5 gap-1 text-[10px]">
                <button
                  type="button"
                  data-testid="vote-up-studyTable"
                  aria-label="Upvote study tables"
                  aria-pressed={metrics.studyTable?.userVote === true}
                  onClick={() => submitAmenityVote("studyTable", true)}
                  className={`transition-colors ${
                    metrics.studyTable?.userVote === true
                      ? "text-green-400 font-bold"
                      : "hover:text-green-400"
                  }`}
                >
                  👍
                </button>
                <button
                  type="button"
                  data-testid="vote-down-studyTable"
                  aria-label="Downvote study tables"
                  aria-pressed={metrics.studyTable?.userVote === false}
                  onClick={() => submitAmenityVote("studyTable", false)}
                  className={`transition-colors ${
                    metrics.studyTable?.userVote === false
                      ? "text-red-400 font-bold"
                      : "hover:text-red-400"
                  }`}
                >
                  👎
                </button>
              </div>
            </div>
          )}

          {/* Scanners/Printers Tag */}
          {isLibrary && !metrics.scanner?.hidden && (
            <div
              data-testid="amenity-tag-scanner"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                (metrics.scanner?.confidenceScore ?? 100) < 60
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                  : "border-white/10 bg-black/20 text-zinc-300"
              }`}
            >
              <Printer className="w-3.5 h-3.5 text-cyan-400" />
              <span className="font-medium font-mono text-[11px]">
                Scanners/Printers ({metrics.scanner?.confidenceScore ?? 100}%)
              </span>

              <div className="ml-1 flex items-center border-l border-white/20 pl-1.5 gap-1 text-[10px]">
                <button
                  type="button"
                  data-testid="vote-up-scanner"
                  aria-label="Upvote scanners and printers"
                  aria-pressed={metrics.scanner?.userVote === true}
                  onClick={() => submitAmenityVote("scanner", true)}
                  className={`transition-colors ${
                    metrics.scanner?.userVote === true
                      ? "text-green-400 font-bold"
                      : "hover:text-green-400"
                  }`}
                >
                  👍
                </button>
                <button
                  type="button"
                  data-testid="vote-down-scanner"
                  aria-label="Downvote scanners and printers"
                  aria-pressed={metrics.scanner?.userVote === false}
                  onClick={() => submitAmenityVote("scanner", false)}
                  className={`transition-colors ${
                    metrics.scanner?.userVote === false
                      ? "text-red-400 font-bold"
                      : "hover:text-red-400"
                  }`}
                >
                  👎
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Breakdown and Leaderboard Trigger Buttons */}
      <div className="flex gap-2 pt-4 mt-2 border-t border-white/10">
        <button
          type="button"
          data-testid="vote-breakdown-btn"
          onClick={() => setShowVoteBreakdown(true)}
          className="flex-1 flex items-center justify-center gap-1.5 bg-black/30 hover:bg-black/50 border border-white/10 text-zinc-300 hover:text-white font-bold text-[10px] uppercase tracking-widest py-2.5 px-3 rounded-xl transition-all active:scale-[0.98]"
        >
          <BarChart3 className="w-3.5 h-3.5" />
          Vote Breakdown
        </button>
        <button
          type="button"
          data-testid="leaderboard-toggle-btn"
          aria-expanded={showLeaderboard}
          onClick={() => setShowLeaderboard(!showLeaderboard)}
          className="flex-1 flex items-center justify-center gap-1.5 bg-black/30 hover:bg-black/50 border border-white/10 text-zinc-300 hover:text-white font-bold text-[10px] uppercase tracking-widest py-2.5 px-3 rounded-xl transition-all active:scale-[0.98]"
        >
          <Trophy className="w-3.5 h-3.5" />
          Leaderboard
        </button>
      </div>

      {/* Leaderboard Drawer */}
      {showLeaderboard && (
        <div
          data-testid="leaderboard-drawer"
          className="bg-black/30 border border-white/10 rounded-xl p-4 mt-2 space-y-2"
        >
          <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-400 flex items-center gap-1.5">
            <Trophy className="w-3 h-3 text-amber-400" />
            Top Voters
          </h4>
          {leaderboard && leaderboard.length > 0 ? (
            <div data-testid="leaderboard-list" className="space-y-1.5">
              {leaderboard.map((entry, idx) => (
                <div
                  key={entry.userId}
                  data-testid={`leaderboard-entry-${entry.userId}`}
                  className="flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-4 text-center text-[10px] font-mono text-zinc-500">
                      {idx + 1}.
                    </span>
                    <span className="font-medium text-zinc-300">
                      {entry.name || "Anonymous"}
                    </span>
                    {entry.accurateVotes >= 10 && (
                      <BadgeCheck
                        data-testid={`leaderboard-badge-${entry.userId}`}
                        className="w-3 h-3 text-amber-400"
                      />
                    )}
                  </div>
                  <span className="font-mono text-zinc-500 text-[10px]">
                    {entry.totalVotes} vote{entry.totalVotes !== 1 ? "s" : ""}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p
              data-testid="leaderboard-empty"
              className="text-xs text-zinc-500 py-1"
            >
              No community votes recorded yet.
            </p>
          )}
        </div>
      )}

      {/* Amenity Vote Breakdown Modal */}
      <AmenityVoteBreakdownModal
        metrics={metrics}
        isOpen={showVoteBreakdown}
        onClose={() => setShowVoteBreakdown(false)}
      />
    </div>
  );
}

export default VenueAmenityVoting;
