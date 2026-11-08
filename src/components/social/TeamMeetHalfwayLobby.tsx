"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Users,
  MapPin,
  Compass,
  Navigation,
  Train,
  Car,
  Bike,
  Footprints,
  Wifi,
  Zap,
  CheckCircle2,
  Share2,
  ThumbsUp,
  CreditCard,
  Sparkles,
  RefreshCw,
  Plus,
  Trash2,
} from "lucide-react";
import usePartySocket from "@/hooks/usePartySocketReconnect";
import type {
  TeamMemberLocation,
  RankedVenueRecommendation,
} from "@/core/routing/MeetHalfwayOptimizer";

interface TeamMeetHalfwayLobbyProps {
  initialLobbyId?: string;
}

export default function TeamMeetHalfwayLobby({
  initialLobbyId = "team-sprint-lobby",
}: TeamMeetHalfwayLobbyProps) {
  const [lobbyId] = useState(initialLobbyId);
  const [members, setMembers] = useState<TeamMemberLocation[]>([
    {
      id: "mem-1",
      name: "Alex (Engineering)",
      latitude: 37.7749,
      longitude: -122.4194,
      transitMode: "transit",
    },
    {
      id: "mem-2",
      name: "Sam (Design)",
      latitude: 37.7833,
      longitude: -122.4167,
      transitMode: "bicycling",
    },
    {
      id: "mem-3",
      name: "Jordan (Product)",
      latitude: 37.7608,
      longitude: -122.435,
      transitMode: "driving",
    },
  ]);

  const [category, setCategory] = useState<string>("all");
  const [minWifiSpeed, setMinWifiSpeed] = useState<number>(50);
  const [hasOutlets, setHasOutlets] = useState<boolean>(true);
  const [minSeats, setMinSeats] = useState<number>(3);
  const [transitPreference, setTransitPreference] = useState<"transit" | "walking" | "balanced">("transit");

  const [loading, setLoading] = useState(false);
  const [centroid, setCentroid] = useState<{ latitude: number; longitude: number } | null>(null);
  const [recommendations, setRecommendations] = useState<RankedVenueRecommendation[]>([]);
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [copiedLink, setCopiedLink] = useState(false);
  const [activeTab, setActiveTab] = useState<"ranked" | "members">("ranked");

  // PartySocket real-time sync for group planning lobby
  const partyHost =
    process.env.NEXT_PUBLIC_PARTYKIT_HOST ||
    (typeof window !== "undefined" ? window.location.host : "localhost:1999");

  const socket = usePartySocket({
    host: partyHost,
    room: `meet-halfway-${lobbyId}`,
    onMessage(event) {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "lobby_vote_update") {
          setVotes((prev) => ({
            ...prev,
            [data.venueId]: (prev[data.venueId] || 0) + 1,
          }));
        } else if (data.type === "lobby_members_sync" && Array.isArray(data.members)) {
          setMembers(data.members);
        } else if (data.type === "lobby_transit_preference_sync" && data.transitPreference) {
          setTransitPreference(data.transitPreference);
        }
      } catch (err) {
        console.error("PartySocket parse error:", err);
      }
    },
  });

  // Calculate Meet Halfway Recommendations
  const fetchMeetHalfway = useCallback(async () => {
    if (members.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch("/api/routing/meet-halfway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          members,
          category,
          minWifiSpeed,
          minSeats,
          hasOutlets,
          transitPreference,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setCentroid(data.centroid);
        setRecommendations(data.recommendations);
      }
    } catch (err) {
      console.error("Failed to compute meet halfway:", err);
    } finally {
      setLoading(false);
    }
  }, [members, category, minWifiSpeed, minSeats, hasOutlets, transitPreference]);

  useEffect(() => {
    fetchMeetHalfway();
  }, [fetchMeetHalfway]);

  // Real-time vote handler
  const handleVote = (venueId: string) => {
    setVotes((prev) => ({
      ...prev,
      [venueId]: (prev[venueId] || 0) + 1,
    }));
    socket?.send(
      JSON.stringify({
        type: "lobby_vote_update",
        venueId,
        lobbyId,
      })
    );
  };

  // Add team member
  const handleAddMember = () => {
    const newId = `mem-${Date.now().toString().slice(-4)}`;
    const updated = [
      ...members,
      {
        id: newId,
        name: `Colleague #${members.length + 1}`,
        latitude: centroid?.latitude ? centroid.latitude + 0.005 : 37.77,
        longitude: centroid?.longitude ? centroid.longitude + 0.005 : -122.42,
        transitMode: "transit" as const,
      },
    ];
    setMembers(updated);
    setMinSeats(updated.length);
    socket?.send(
      JSON.stringify({
        type: "lobby_members_sync",
        members: updated,
        lobbyId,
      })
    );
  };

  // Remove team member
  const handleRemoveMember = (id: string) => {
    const updated = members.filter((m) => m.id !== id);
    setMembers(updated);
    setMinSeats(Math.max(1, updated.length));
    socket?.send(
      JSON.stringify({
        type: "lobby_members_sync",
        members: updated,
        lobbyId,
      })
    );
  };

  // Update member transit mode or name
  const handleUpdateMember = (
    id: string,
    field: "name" | "transitMode" | "latitude" | "longitude",
    val: any
  ) => {
    const updated = members.map((m) => (m.id === id ? { ...m, [field]: val } : m));
    setMembers(updated);
    socket?.send(
      JSON.stringify({
        type: "lobby_members_sync",
        members: updated,
        lobbyId,
      })
    );
  };

  // Copy lobby invite link
  const handleCopyInvite = () => {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }
  };

  const getTransitIcon = (mode?: string) => {
    switch (mode) {
      case "driving":
        return <Car className="w-3.5 h-3.5 text-blue-400" />;
      case "bicycling":
        return <Bike className="w-3.5 h-3.5 text-green-400" />;
      case "walking":
        return <Footprints className="w-3.5 h-3.5 text-yellow-400" />;
      case "transit":
      default:
        return <Train className="w-3.5 h-3.5 text-purple-400" />;
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-900/60 via-indigo-900/40 to-slate-900/80 border border-blue-500/20 p-6 md:p-8 backdrop-blur-xl shadow-2xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-semibold uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5" /> Team Coworking Optimizer
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">
              Meet Halfway Geo-Clustering & Group Booking
            </h1>
            <p className="text-sm text-slate-300 max-w-2xl">
              Equitably balances team commute times using Fermat-Weber geometric medians, verifies contiguous desk seating, and enables real-time group voting with split payment checkout.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleCopyInvite}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-white text-sm font-medium border border-slate-700 transition shadow-sm"
            >
              <Share2 className="w-4 h-4 text-blue-400" />
              {copiedLink ? "Invite Copied!" : "Share Lobby"}
            </button>
            <button
              onClick={fetchMeetHalfway}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold shadow-lg shadow-blue-600/20 transition disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              Recalculate
            </button>
          </div>
        </div>

        {/* Live Lobby Pill & Centroid Status */}
        <div className="mt-6 flex flex-wrap items-center gap-4 pt-4 border-t border-slate-800 text-xs text-slate-400">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span>Lobby: <strong className="text-white">{lobbyId}</strong></span>
          </div>
          <div className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-blue-400" />
            <span>{members.length} Active Participants</span>
          </div>
          {centroid && (
            <div className="flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5 text-indigo-400" />
              <span>
                Midpoint Centroid: {centroid.latitude.toFixed(4)}, {centroid.longitude.toFixed(4)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Main Grid: Controls & Tabs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Team Members & Filters (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 md:p-5 space-y-4 backdrop-blur-md">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-400" /> Team Coordinates ({members.length})
              </h2>
              <button
                onClick={handleAddMember}
                className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add Member
              </button>
            </div>

            {/* Members List */}
            <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1">
              {members.map((member, index) => (
                <div
                  key={member.id}
                  className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 space-y-2 hover:border-slate-600 transition"
                >
                  <div className="flex items-center justify-between">
                    <input
                      type="text"
                      value={member.name}
                      onChange={(e) => handleUpdateMember(member.id, "name", e.target.value)}
                      className="text-xs font-semibold text-white bg-transparent border-b border-transparent hover:border-slate-600 focus:border-blue-500 focus:outline-none w-3/4"
                    />
                    {members.length > 1 && (
                      <button
                        onClick={() => handleRemoveMember(member.id)}
                        className="text-slate-400 hover:text-red-400 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-slate-500 block text-[10px]">Transit Mode</span>
                      <select
                        value={member.transitMode || "transit"}
                        onChange={(e) =>
                          handleUpdateMember(member.id, "transitMode", e.target.value as any)
                        }
                        className="w-full mt-0.5 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-slate-200 text-xs focus:outline-none"
                      >
                        <option value="transit">🚆 Transit</option>
                        <option value="driving">🚗 Driving</option>
                        <option value="bicycling">🚲 Bicycling</option>
                        <option value="walking">🚶 Walking</option>
                      </select>
                    </div>

                    <div>
                      <span className="text-slate-500 block text-[10px]">Location (Lat/Lng)</span>
                      <div className="flex items-center gap-1 mt-0.5 text-slate-300 text-[11px] font-mono">
                        <MapPin className="w-3 h-3 text-blue-400 shrink-0" />
                        <span>
                          {member.latitude.toFixed(2)}, {member.longitude.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Transit Preference Toggle (Public Transit vs Walking) */}
            <div className="pt-3 border-t border-slate-800 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-semibold flex items-center gap-1.5">
                  <Compass className="w-3.5 h-3.5 text-blue-400" /> Commute Preference
                </span>
                <span className="text-[10px] text-slate-500 font-mono">Team Priority</span>
              </div>

              <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setTransitPreference("transit");
                    socket?.send(
                      JSON.stringify({
                        type: "lobby_transit_preference_sync",
                        transitPreference: "transit",
                        lobbyId,
                      })
                    );
                  }}
                  className={`py-1.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition ${
                    transitPreference === "transit"
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Train className="w-3.5 h-3.5" /> Transit
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setTransitPreference("walking");
                    socket?.send(
                      JSON.stringify({
                        type: "lobby_transit_preference_sync",
                        transitPreference: "walking",
                        lobbyId,
                      })
                    );
                  }}
                  className={`py-1.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition ${
                    transitPreference === "walking"
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Footprints className="w-3.5 h-3.5" /> Walking
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setTransitPreference("balanced");
                    socket?.send(
                      JSON.stringify({
                        type: "lobby_transit_preference_sync",
                        transitPreference: "balanced",
                        lobbyId,
                      })
                    );
                  }}
                  className={`py-1.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition ${
                    transitPreference === "balanced"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" /> Balanced
                </button>
              </div>
            </div>

            {/* Filter Criteria */}
            <div className="pt-3 border-t border-slate-800 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Required Contiguous Seats</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={minSeats}
                  onChange={(e) => setMinSeats(Number(e.target.value))}
                  className="w-16 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-center text-white"
                />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">Min WiFi Speed (Mbps)</span>
                <input
                  type="number"
                  min={0}
                  step={25}
                  value={minWifiSpeed}
                  onChange={(e) => setMinWifiSpeed(Number(e.target.value))}
                  className="w-16 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-center text-white"
                />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">Venue Category</span>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-slate-200 text-xs"
                >
                  <option value="all">All Categories</option>
                  <option value="coworking">Coworking Space</option>
                  <option value="cafe">Cafe / Coffee Shop</option>
                  <option value="library">Quiet Library</option>
                </select>
              </div>

              <label className="flex items-center justify-between cursor-pointer pt-1">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-yellow-400" /> Power Outlets Required
                </span>
                <input
                  type="checkbox"
                  checked={hasOutlets}
                  onChange={(e) => setHasOutlets(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-950 text-blue-600 focus:ring-blue-500"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Right Column: Ranked Recommendations & Voting (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Navigation className="w-5 h-5 text-indigo-400" />
              <h2 className="text-base font-bold text-white">Optimal Team Venues</h2>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                {recommendations.length} Matches
              </span>
            </div>
          </div>

          {loading ? (
            <div className="p-12 rounded-2xl bg-slate-900/40 border border-slate-800 flex flex-col items-center justify-center gap-3 text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin text-blue-400" />
              <p className="text-sm">Calculating geometric median & evaluating travel matrices...</p>
            </div>
          ) : recommendations.length === 0 ? (
            <div className="p-12 rounded-2xl bg-slate-900/40 border border-slate-800 text-center space-y-3">
              <MapPin className="w-8 h-8 text-slate-600 mx-auto" />
              <p className="text-sm font-medium text-slate-300">No venues matched all group criteria</p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Try reducing required seats or expanding the search radius to discover more spots.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {recommendations.map((rec, index) => {
                const venue = rec.venue;
                const venueVotes = votes[venue.id] || 0;

                return (
                  <div
                    key={venue.id}
                    className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800 hover:border-blue-500/40 transition duration-200 backdrop-blur-md space-y-4 shadow-lg"
                  >
                    {/* Top Row: Rank, Title, Fairness Badge & Votes */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-start gap-3">
                        <div className="flex flex-col items-center justify-center w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400 font-bold text-sm shrink-0">
                          #{index + 1}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-bold text-white">{venue.name}</h3>
                            <span className="text-[11px] px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 capitalize">
                              {venue.category}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 line-clamp-1">{venue.address || "Central District"}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Fairness Badge */}
                        <div
                          className={`text-xs px-2.5 py-1 rounded-lg border font-semibold flex items-center gap-1.5 ${
                            rec.fairnessScore >= 80
                              ? "bg-green-500/10 border-green-500/30 text-green-400"
                              : rec.fairnessScore >= 60
                              ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
                              : "bg-orange-500/10 border-orange-500/30 text-orange-400"
                          }`}
                        >
                          <Sparkles className="w-3 h-3" />
                          <span>{rec.fairnessScore}% Fair Commute</span>
                        </div>

                        {/* Live Team Vote Button */}
                        <button
                          onClick={() => handleVote(venue.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 hover:bg-blue-600/30 border border-slate-700 hover:border-blue-500/40 text-slate-200 text-xs font-semibold transition"
                        >
                          <ThumbsUp className="w-3.5 h-3.5 text-blue-400" />
                          <span>{venueVotes}</span>
                        </button>
                      </div>
                    </div>

                    {/* Middle Row: Metrics Pills */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs">
                      <div className="p-2.5 rounded-xl bg-slate-800/40 border border-slate-800/80">
                        <span className="text-slate-400 text-[10px] block">Avg Team Commute</span>
                        <strong className="text-white font-semibold">
                          ~{rec.averageDurationMinutes} mins
                        </strong>
                      </div>

                      <div className="p-2.5 rounded-xl bg-slate-800/40 border border-slate-800/80">
                        <span className="text-slate-400 text-[10px] block">Max Commute</span>
                        <strong className="text-slate-300 font-semibold">
                          {rec.maxDurationMinutes} mins
                        </strong>
                      </div>

                      <div className="p-2.5 rounded-xl bg-slate-800/40 border border-slate-800/80">
                        <span className="text-slate-400 text-[10px] block">Available Seats</span>
                        <strong className="text-emerald-400 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> {rec.availableCapacity} Desks
                        </strong>
                      </div>

                      <div className="p-2.5 rounded-xl bg-slate-800/40 border border-slate-800/80">
                        <span className="text-slate-400 text-[10px] block">WiFi Speed</span>
                        <strong className="text-blue-400 font-semibold flex items-center gap-1">
                          <Wifi className="w-3 h-3" /> {venue.wifiSpeed || 75} Mbps
                        </strong>
                      </div>
                    </div>

                    {/* Member Breakdown Badges */}
                    <div className="space-y-1.5 pt-1">
                      <span className="text-[11px] font-semibold text-slate-400">
                        Individual Travel Breakdown:
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {rec.memberEstimates.map((est) => (
                          <div
                            key={est.memberId}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700 text-xs text-slate-300"
                          >
                            {getTransitIcon(est.transitMode)}
                            <span className="font-medium text-white">{est.memberName}:</span>
                            <span className="text-slate-300">{est.durationMinutes} min</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Action Bar */}
                    <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
                      <div className="text-xs text-slate-400">
                        Composite Score: <strong className="text-indigo-400 font-mono">{rec.compositeRankScore}/100</strong>
                      </div>

                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        <a
                          href={`/venues/${venue.id}`}
                          className="w-1/2 sm:w-auto text-center px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
                        >
                          View Floorplan
                        </a>
                        <a
                          href={`/reserve?venueId=${venue.id}&guests=${members.length}`}
                          className="w-1/2 sm:w-auto text-center px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-md shadow-blue-600/20 transition flex items-center justify-center gap-1.5"
                        >
                          <CreditCard className="w-3.5 h-3.5" /> Book Group Desks
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
