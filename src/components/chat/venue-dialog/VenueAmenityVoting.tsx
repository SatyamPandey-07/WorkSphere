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
}

export function VenueAmenityVoting({
  venue,
  voteMetrics,
  submitAmenityVote,
  showVoteBreakdown,
  setShowVoteBreakdown,
  showLeaderboard,
  setShowLeaderboard,
  leaderboard,
  isLibrary,
}: VenueAmenityVotingProps) {
  return (
    <>
      {/* Parking and Transportation Amenity Tags */}
      <div className="flex flex-wrap gap-2 mb-4">
        {/* Free Street Parking Tag */}
        {!voteMetrics.freeStreetParking?.hidden && (
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
              (voteMetrics.freeStreetParking?.confidenceScore ?? 100) < 60
                ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                : "border-white/10 bg-black/20 text-zinc-300"
            }`}
          >
            <Car className="w-3.5 h-3.5 text-blue-400" />
            <span className="font-medium font-mono text-[11px]">
              Street Parking ({voteMetrics.freeStreetParking?.confidenceScore}%)
            </span>

            <div className="ml-1 flex items-center border-l border-white/20 pl-1.5 gap-1 text-[10px]">
              <button
                onClick={() => submitAmenityVote("freeStreetParking", true)}
                className={`transition-colors ${voteMetrics.freeStreetParking?.userVote === true ? "text-green-400" : "hover:text-green-400"}`}
              >
                👍
              </button>
              <button
                onClick={() => submitAmenityVote("freeStreetParking", false)}
                className={`transition-colors ${voteMetrics.freeStreetParking?.userVote === false ? "text-red-400" : "hover:text-red-400"}`}
              >
                👎
              </button>
            </div>
          </div>
        )}

        {/* Paid Garage Tag */}
        {!voteMetrics.paidGarage?.hidden && (
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
              (voteMetrics.paidGarage?.confidenceScore ?? 100) < 60
                ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                : "border-white/10 bg-black/20 text-zinc-300"
            }`}
          >
            <CircleDollarSign className="w-3.5 h-3.5 text-emerald-500" />
            <span className="font-medium font-mono text-[11px]">
              Paid Garage ({voteMetrics.paidGarage?.confidenceScore}%)
            </span>

            <div className="ml-1 flex items-center border-l border-white/20 pl-1.5 gap-1 text-[10px]">
              <button
                onClick={() => submitAmenityVote("paidGarage", true)}
                className={`transition-colors ${voteMetrics.paidGarage?.userVote === true ? "text-green-400" : "hover:text-green-400"}`}
              >
                👍
              </button>
              <button
                onClick={() => submitAmenityVote("paidGarage", false)}
                className={`transition-colors ${voteMetrics.paidGarage?.userVote === false ? "text-red-400" : "hover:text-red-400"}`}
              >
                👎
              </button>
            </div>
          </div>
        )}

        {/* Bicycle Rack Tag */}
        {!voteMetrics.bicycleRack?.hidden && (
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
              (voteMetrics.bicycleRack?.confidenceScore ?? 100) < 60
                ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                : "border-white/10 bg-black/20 text-zinc-300"
            }`}
          >
            <Bike className="w-3.5 h-3.5 text-orange-400" />
            <span className="font-medium font-mono text-[11px]">
              Bicycle Rack ({voteMetrics.bicycleRack?.confidenceScore}%)
            </span>

            <div className="ml-1 flex items-center border-l border-white/20 pl-1.5 gap-1 text-[10px]">
              <button
                onClick={() => submitAmenityVote("bicycleRack", true)}
                className={`transition-colors ${voteMetrics.bicycleRack?.userVote === true ? "text-green-400" : "hover:text-green-400"}`}
              >
                👍
              </button>
              <button
                onClick={() => submitAmenityVote("bicycleRack", false)}
                className={`transition-colors ${voteMetrics.bicycleRack?.userVote === false ? "text-red-400" : "hover:text-red-400"}`}
              >
                👎
              </button>
            </div>
          </div>
        )}

        {/* Secure Motorcycle Parking Tag */}
        {!voteMetrics.secureMotorcycleParking?.hidden && (
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
              (voteMetrics.secureMotorcycleParking?.confidenceScore ?? 100) < 60
                ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                : "border-white/10 bg-black/20 text-zinc-300"
            }`}
          >
            <Shield className="w-3.5 h-3.5 text-zinc-400" />
            <span className="font-medium font-mono text-[11px]">
              Moto Parking ({voteMetrics.secureMotorcycleParking?.confidenceScore}%)
            </span>

            <div className="ml-1 flex items-center border-l border-white/20 pl-1.5 gap-1 text-[10px]">
              <button
                onClick={() => submitAmenityVote("secureMotorcycleParking", true)}
                className={`transition-colors ${voteMetrics.secureMotorcycleParking?.userVote === true ? "text-green-400" : "hover:text-green-400"}`}
              >
                👍
              </button>
              <button
                onClick={() => submitAmenityVote("secureMotorcycleParking", false)}
                className={`transition-colors ${voteMetrics.secureMotorcycleParking?.userVote === false ? "text-red-400" : "hover:text-red-400"}`}
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
          {!voteMetrics.wifi?.hidden && (
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                (voteMetrics.wifi?.confidenceScore ?? 100) < 60
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                  : "border-white/10 bg-black/20 text-zinc-300"
              }`}
            >
              <Wifi className="w-3.5 h-3.5 text-blue-400" />
              <span className="font-medium font-mono text-[11px]">
                WiFi ({voteMetrics.wifi?.confidenceScore}%)
              </span>

              <div className="ml-1 flex items-center border-l border-white/20 pl-1.5 gap-1 text-[10px]">
                <button
                  onClick={() => submitAmenityVote("wifi", true)}
                  className={`transition-colors ${voteMetrics.wifi?.userVote === true ? "text-green-400" : "hover:text-green-400"}`}
                >
                  👍
                </button>
                <button
                  onClick={() => submitAmenityVote("wifi", false)}
                  className={`transition-colors ${voteMetrics.wifi?.userVote === false ? "text-red-400" : "hover:text-red-400"}`}
                >
                  👎
                </button>
              </div>
            </div>
          )}

          {/* Outlets Tag Check Node */}
          {venue.hasOutlets && !voteMetrics.outlets?.hidden && (
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                (voteMetrics.outlets?.confidenceScore ?? 100) < 60
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                  : "border-white/10 bg-black/20 text-zinc-300"
              }`}
            >
              <Zap className="w-3.5 h-3.5 text-yellow-400" />
              <span className="font-medium font-mono text-[11px]">
                Outlets ({voteMetrics.outlets?.confidenceScore}%)
              </span>

              <div className="ml-1 flex items-center border-l border-white/20 pl-1.5 gap-1 text-[10px]">
                <button
                  onClick={() => submitAmenityVote("outlets", true)}
                  className={`transition-colors ${voteMetrics.outlets?.userVote === true ? "text-green-400" : "hover:text-green-400"}`}
                >
                  👍
                </button>
                <button
                  onClick={() => submitAmenityVote("outlets", false)}
                  className={`transition-colors ${voteMetrics.outlets?.userVote === false ? "text-red-400" : "hover:text-red-400"}`}
                >
                  👎
                </button>
              </div>
            </div>
          )}

          {/* Strict Silent Rooms Tag */}
          {isLibrary && !voteMetrics.silentRoom?.hidden && (
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                (voteMetrics.silentRoom?.confidenceScore ?? 100) < 60
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                  : "border-white/10 bg-black/20 text-zinc-300"
              }`}
            >
              <VolumeX className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-medium font-mono text-[11px]">
                Silent Room ({voteMetrics.silentRoom?.confidenceScore}%)
              </span>

              <div className="ml-1 flex items-center border-l border-white/20 pl-1.5 gap-1 text-[10px]">
                <button
                  onClick={() => submitAmenityVote("silentRoom", true)}
                  className={`transition-colors ${voteMetrics.silentRoom?.userVote === true ? "text-green-400" : "hover:text-green-400"}`}
                >
                  👍
                </button>
                <button
                  onClick={() => submitAmenityVote("silentRoom", false)}
                  className={`transition-colors ${voteMetrics.silentRoom?.userVote === false ? "text-red-400" : "hover:text-red-400"}`}
                >
                  👎
                </button>
              </div>
            </div>
          )}

          {/* Bookable Study Tables Tag */}
          {isLibrary && !voteMetrics.studyTable?.hidden && (
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                (voteMetrics.studyTable?.confidenceScore ?? 100) < 60
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                  : "border-white/10 bg-black/20 text-zinc-300"
              }`}
            >
              <Calendar className="w-3.5 h-3.5 text-indigo-400" />
              <span className="font-medium font-mono text-[11px]">
                Study Tables ({voteMetrics.studyTable?.confidenceScore}%)
              </span>

              <div className="ml-1 flex items-center border-l border-white/20 pl-1.5 gap-1 text-[10px]">
                <button
                  onClick={() => submitAmenityVote("studyTable", true)}
                  className={`transition-colors ${voteMetrics.studyTable?.userVote === true ? "text-green-400" : "hover:text-green-400"}`}
                >
                  👍
                </button>
                <button
                  onClick={() => submitAmenityVote("studyTable", false)}
                  className={`transition-colors ${voteMetrics.studyTable?.userVote === false ? "text-red-400" : "hover:text-red-400"}`}
                >
                  👎
                </button>
              </div>
            </div>
          )}

          {/* Scanners/Printers Tag */}
          {isLibrary && !voteMetrics.scanner?.hidden && (
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                (voteMetrics.scanner?.confidenceScore ?? 100) < 60
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                  : "border-white/10 bg-black/20 text-zinc-300"
              }`}
            >
              <Printer className="w-3.5 h-3.5 text-cyan-400" />
              <span className="font-medium font-mono text-[11px]">
                Scanners/Printers ({voteMetrics.scanner?.confidenceScore}%)
              </span>

              <div className="ml-1 flex items-center border-l border-white/20 pl-1.5 gap-1 text-[10px]">
                <button
                  onClick={() => submitAmenityVote("scanner", true)}
                  className={`transition-colors ${voteMetrics.scanner?.userVote === true ? "text-green-400" : "hover:text-green-400"}`}
                >
                  👍
                </button>
                <button
                  onClick={() => submitAmenityVote("scanner", false)}
                  className={`transition-colors ${voteMetrics.scanner?.userVote === false ? "text-red-400" : "hover:text-red-400"}`}
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
          onClick={() => setShowVoteBreakdown(true)}
          className="flex-1 flex items-center justify-center gap-1.5 bg-black/30 hover:bg-black/50 border border-white/10 text-zinc-300 hover:text-white font-bold text-[10px] uppercase tracking-widest py-2.5 px-3 rounded-xl transition-all active:scale-[0.98]"
        >
          <BarChart3 className="w-3.5 h-3.5" />
          Vote Breakdown
        </button>
        <button
          onClick={() => setShowLeaderboard(!showLeaderboard)}
          className="flex-1 flex items-center justify-center gap-1.5 bg-black/30 hover:bg-black/50 border border-white/10 text-zinc-300 hover:text-white font-bold text-[10px] uppercase tracking-widest py-2.5 px-3 rounded-xl transition-all active:scale-[0.98]"
        >
          <Trophy className="w-3.5 h-3.5" />
          Leaderboard
        </button>
      </div>

      {/* Leaderboard Drawer */}
      {showLeaderboard && leaderboard.length > 0 && (
        <div className="bg-black/30 border border-white/10 rounded-xl p-4 mt-2 space-y-2">
          <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-400 flex items-center gap-1.5">
            <Trophy className="w-3 h-3 text-amber-400" />
            Top Voters
          </h4>
          <div className="space-y-1.5">
            {leaderboard.map((entry, idx) => (
              <div
                key={entry.userId}
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
                    <BadgeCheck className="w-3 h-3 text-amber-400" />
                  )}
                </div>
                <span className="font-mono text-zinc-500 text-[10px]">
                  {entry.totalVotes} vote{entry.totalVotes !== 1 ? "s" : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Amenity Vote Breakdown Modal */}
      <AmenityVoteBreakdownModal
        metrics={voteMetrics}
        isOpen={showVoteBreakdown}
        onClose={() => setShowVoteBreakdown(false)}
      />
    </>
  );
}

export default VenueAmenityVoting;
