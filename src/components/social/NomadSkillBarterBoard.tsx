"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Users,
  Sparkles,
  ArrowRightLeft,
  Code2,
  Palette,
  Landmark,
  TrendingUp,
  Target,
  Globe,
  Clock,
  MapPin,
  CheckCircle2,
  Plus,
  RefreshCw,
  Send,
  Award,
  Coffee,
  Search,
  X,
  SlidersHorizontal,
  Filter,
} from "lucide-react";
import {
  calculateBarterHourBalance,
  type SkillListing,
  type SkillCategory,
  type BarterMatchResult,
} from "@/lib/social/skillBarterEngine";

// Helper to safely parse and auto-link URLs in user bio and skill description text
// Prevents XSS script injection while converting URLs into secure external links with target="_blank" and rel="noopener noreferrer"
export function renderSanitizedBioText(rawText: string | undefined | null): React.ReactNode {
  if (!rawText) return null;

  // URL matching regex supporting http, https, and www prefixes
  const urlRegex = /(https?:\/\/[^\s<>"'`]+|www\.[^\s<>"'`]+)/gi;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = urlRegex.exec(rawText)) !== null) {
    const matchIndex = match.index;
    const matchedUrl = match[0];

    // Push the text before the URL (React automatically escapes plain text strings against XSS)
    if (matchIndex > lastIndex) {
      parts.push(rawText.substring(lastIndex, matchIndex));
    }

    const href = matchedUrl.startsWith("http://") || matchedUrl.startsWith("https://")
      ? matchedUrl
      : `https://${matchedUrl}`;

    parts.push(
      <a
        key={`link-${matchIndex}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 break-all font-semibold"
        onClick={(e) => e.stopPropagation()}
      >
        {matchedUrl}
      </a>
    );

    lastIndex = matchIndex + matchedUrl.length;
  }

  // Push remaining text
  if (lastIndex < rawText.length) {
    parts.push(rawText.substring(lastIndex));
  }

  return parts;
}

interface NomadSkillBarterBoardProps {
  venueId?: string;
  venueName?: string;
}

export default function NomadSkillBarterBoard({
  venueId = "venue-sf-01",
  venueName = "Mission Focus Coworking & Cafe",
}: NomadSkillBarterBoardProps) {
  const [listings, setListings] = useState<SkillListing[]>([]);
  const [matches, setMatches] = useState<BarterMatchResult[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchScope, setSearchScope] = useState<"ALL" | "OFFERING" | "SEEKING">("ALL");
  const [loading, setLoading] = useState(true);
  const [showPostModal, setShowPostModal] = useState(false);
  const [matchSuccessMsg, setMatchSuccessMsg] = useState<string | null>(null);

  // TimeBank Barter Hours
  const [earnedMinutes, setEarnedMinutes] = useState(120);
  const [spentMinutes, setSpentMinutes] = useState(45);
  const hourBalance = calculateBarterHourBalance(earnedMinutes, spentMinutes);

  // Form states
  const [offeringSkill, setOfferingSkill] = useState("");
  const [offeringCategory, setOfferingCategory] = useState<SkillCategory>("CODE_DEV");
  const [seekingSkill, setSeekingSkill] = useState("");
  const [seekingCategory, setSeekingCategory] = useState<SkillCategory>("DESIGN_UI");
  const [duration, setDuration] = useState<15 | 30 | 45>(30);
  const [meetupSpot, setMeetupSpot] = useState("Lounge Coffee Table");
  const [posting, setPosting] = useState(false);


  const fetchListings = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/social/skill-exchange?venueId=${venueId}&category=${selectedCategory}`);
      const data = await res.json();
      if (data.success) {
        setListings(data.listings);
        setMatches(data.matches || []);
      }
    } catch (err) {
      console.error("Failed to load skill listings:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchListings();
  }, [selectedCategory, venueId]);

  const filteredListings = useMemo(() => {
    if (!searchQuery.trim()) return listings;
    const q = searchQuery.toLowerCase().trim();

    return listings.filter((item) => {
      if (searchScope === "OFFERING") {
        return (
          item.offeringSkill.toLowerCase().includes(q) ||
          item.offeringCategory.toLowerCase().includes(q)
        );
      }
      if (searchScope === "SEEKING") {
        return (
          item.seekingSkill.toLowerCase().includes(q) ||
          item.seekingCategory.toLowerCase().includes(q)
        );
      }

      return (
        item.offeringSkill.toLowerCase().includes(q) ||
        item.seekingSkill.toLowerCase().includes(q) ||
        item.userName.toLowerCase().includes(q) ||
        (item.userTitle && item.userTitle.toLowerCase().includes(q)) ||
        item.meetupSpot.toLowerCase().includes(q) ||
        item.offeringCategory.toLowerCase().includes(q) ||
        item.seekingCategory.toLowerCase().includes(q)
      );
    });
  }, [listings, searchQuery, searchScope]);

  const handleCreateListing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!offeringSkill || !seekingSkill) return;
    setPosting(true);
    try {
      const res = await fetch("/api/social/skill-exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venueId,
          venueName,
          offeringSkill,
          offeringCategory,
          seekingSkill,
          seekingCategory,
          durationMinutes: duration,
          meetupSpot,
        }),
      });
      const data = await res.json();
      if (data.success && data.listing) {
        setListings((prev) => [data.listing, ...prev]);
        setShowPostModal(false);
        setOfferingSkill("");
        setSeekingSkill("");
        setMatchSuccessMsg("Your Skill Barter was posted to the venue board!");
        setTimeout(() => setMatchSuccessMsg(null), 4000);
      }
    } catch (err) {
      console.error("Post listing failed:", err);
    } finally {
      setPosting(false);
    }
  };

  const handleProposeBarter = async (listing: SkillListing) => {
    try {
      const res = await fetch("/api/social/skill-exchange/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: listing.id,
          proposerName: "You",
          meetupTime: "In 15 Minutes",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSpentMinutes((prev) => prev + (listing.durationMinutes || 15));
        setMatchSuccessMsg(`Barter Proposal sent to ${listing.userName}! Meet at ${listing.meetupSpot}.`);
        setTimeout(() => setMatchSuccessMsg(null), 5000);
      }
    } catch (err) {
      console.error("Propose barter error:", err);
    }
  };

  const getCategoryIcon = (cat: SkillCategory) => {
    switch (cat) {
      case "CODE_DEV":
        return <Code2 className="w-3.5 h-3.5 text-cyan-400" />;
      case "DESIGN_UI":
        return <Palette className="w-3.5 h-3.5 text-pink-400" />;
      case "LEGAL_VISA":
        return <Landmark className="w-3.5 h-3.5 text-amber-400" />;
      case "GROWTH_MARKETING":
        return <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />;
      case "PRODUCT_PITCH":
        return <Target className="w-3.5 h-3.5 text-indigo-400" />;
      case "LANGUAGE_CULTURE":
      default:
        return <Globe className="w-3.5 h-3.5 text-blue-400" />;
    }
  };

  const popularKeywords = ["React", "Figma", "Visa", "Cold Email", "Tax", "Next.js", "Design System"];

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 border border-indigo-500/30 p-6 md:p-8 backdrop-blur-xl shadow-2xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-semibold uppercase tracking-wider">
                <ArrowRightLeft className="w-3.5 h-3.5" /> Peer Knowledge Exchange
              </div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-mono font-bold">
                <Clock className="w-3.5 h-3.5" /> {hourBalance.netBalanceHours.toFixed(1)}h Credit Balance
              </div>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              On-Site Nomad Skill Barter Board
            </h1>
            <p className="text-xs md:text-sm text-slate-300 max-w-2xl">
              Exchange 15-to-30 minute peer knowledge with nomads seated in your workspace. Trade code reviews for visa tips, UI critiques for growth marketing teardowns.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setShowPostModal(true)}
              className="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-bold shadow-lg shadow-cyan-600/30 flex items-center gap-2 transition"
            >
              <Plus className="w-4 h-4" /> Post a Skill Barter
            </button>
          </div>
        </div>

        {matchSuccessMsg && (
          <div className="mt-4 p-3.5 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-medium flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{matchSuccessMsg}</span>
          </div>
        )}
      </div>

      {/* Bidirectional Smart Matches Highlight */}
      {matches.length > 0 && (
        <div className="p-4 md:p-5 rounded-3xl bg-gradient-to-r from-indigo-900/40 to-cyan-900/30 border border-cyan-500/30 backdrop-blur-md space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-cyan-300 uppercase tracking-wider">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>Smart Bi-Directional Match Detected in this Space</span>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-white font-semibold">
                <span>{matches[0].listingA.userName}</span>
                <ArrowRightLeft className="w-3.5 h-3.5 text-cyan-400" />
                <span>{matches[0].listingB.userName}</span>
              </div>
              <p className="text-slate-300 text-[11px] leading-relaxed">{matches[0].reason}</p>
            </div>

            <button
              onClick={() => handleProposeBarter(matches[0].listingA)}
              className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-md transition shrink-0"
            >
              Connect at {matches[0].listingA.meetupSpot}
            </button>
          </div>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="p-4 rounded-3xl bg-slate-900/80 border border-slate-800 backdrop-blur-md space-y-3 shadow-lg">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Search Input Box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search skills, topics, visas, or coworkers (e.g. React, Figma, Tax, Alex)..."
              className="w-full bg-slate-950/90 border border-slate-700/80 hover:border-slate-600 focus:border-cyan-500 rounded-2xl pl-10 pr-10 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 transition shadow-inner"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1 rounded-full hover:bg-slate-800 transition"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Scope Filters */}
          <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-2xl border border-slate-800 shrink-0">
            {(
              [
                { id: "ALL", label: "All" },
                { id: "OFFERING", label: "Offering" },
                { id: "SEEKING", label: "Seeking" },
              ] as const
            ).map((scope) => (
              <button
                key={scope.id}
                onClick={() => setSearchScope(scope.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                  searchScope === scope.id
                    ? "bg-cyan-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {scope.label}
              </button>
            ))}
          </div>
        </div>

        {/* Popular Keyword Chips & Result Count */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/60 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-500 flex items-center gap-1 mr-1">
              <Filter className="w-3 h-3 text-cyan-400" /> Popular:
            </span>
            {popularKeywords.map((kw) => (
              <button
                key={kw}
                onClick={() => setSearchQuery(kw)}
                className={`px-2.5 py-0.5 rounded-lg text-[11px] font-medium border transition ${
                  searchQuery.toLowerCase() === kw.toLowerCase()
                    ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-300"
                    : "bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700"
                }`}
              >
                {kw}
              </button>
            ))}
          </div>

          <div className="text-[11px] text-slate-400 font-mono">
            Showing <strong className="text-white">{filteredListings.length}</strong> of{" "}
            <strong className="text-slate-300">{listings.length}</strong> barters
          </div>
        </div>
      </div>

      {/* Category Filter Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
        {[
          { id: "ALL", label: "All Skills" },
          { id: "CODE_DEV", label: "💻 Code & Dev" },
          { id: "DESIGN_UI", label: "🎨 UI/UX Design" },
          { id: "LEGAL_VISA", label: "🏛️ Visas & Tax" },
          { id: "GROWTH_MARKETING", label: "📈 Growth & GTM" },
          { id: "PRODUCT_PITCH", label: "🎯 Pitch & Product" },
          { id: "LANGUAGE_CULTURE", label: "🌍 Language" },
        ].map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={`px-3.5 py-1.5 rounded-xl font-semibold whitespace-nowrap transition ${
              selectedCategory === cat.id
                ? "bg-cyan-600 text-white shadow-md shadow-cyan-600/30"
                : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Listings Grid */}
      {loading ? (
        <div className="p-12 rounded-3xl bg-slate-900/40 border border-slate-800 flex flex-col items-center justify-center gap-3 text-slate-400">
          <RefreshCw className="w-6 h-6 animate-spin text-cyan-400" />
          <p className="text-sm">Finding skill barter offerings from coworkers on-site...</p>
        </div>
      ) : filteredListings.length === 0 ? (
        <div className="p-12 rounded-3xl bg-slate-900/40 border border-slate-800 text-center space-y-3 text-slate-400 text-xs">
          <Coffee className="w-8 h-8 mx-auto text-slate-600" />
          <p className="text-sm font-semibold text-slate-300">
            {searchQuery
              ? `No skills found matching "${searchQuery}"`
              : "No active barter requests in this category"}
          </p>
          <p>
            {searchQuery
              ? "Try adjusting your search terms or clearing filters."
              : "Be the first to post a 15-minute knowledge trade in this workspace!"}
          </p>
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery("");
                setSelectedCategory("ALL");
              }}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-semibold transition"
            >
              Clear Search & Reset Filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {filteredListings.map((item) => (
            <div
              key={item.id}
              className="p-5 rounded-3xl bg-slate-900/80 border border-slate-800 hover:border-cyan-500/40 transition-all duration-200 backdrop-blur-md space-y-4 shadow-lg flex flex-col justify-between"
            >
              <div className="space-y-3">
                {/* User Header */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      {item.userName}
                    </h3>
                    <p className="text-xs text-slate-400 line-clamp-1">{renderSanitizedBioText(item.userTitle)}</p>
                  </div>

                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold shrink-0">
                    {item.reputationScore}% Rep Score
                  </span>
                </div>

                {/* Offering vs Seeking Trade Box */}
                <div className="space-y-2 pt-1 text-xs">
                  {/* Offering */}
                  <div className="p-2.5 rounded-2xl bg-slate-950/70 border border-slate-800/80 space-y-1">
                    <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1">
                      {getCategoryIcon(item.offeringCategory)} Offering Expertise
                    </span>
                    <p className="text-slate-200 font-medium">{renderSanitizedBioText(item.offeringSkill)}</p>
                  </div>

                  {/* Seeking */}
                  <div className="p-2.5 rounded-2xl bg-slate-950/70 border border-slate-800/80 space-y-1">
                    <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1">
                      {getCategoryIcon(item.seekingCategory)} Seeking Knowledge
                    </span>
                    <p className="text-slate-300">{renderSanitizedBioText(item.seekingSkill)}</p>
                  </div>
                </div>
              </div>

              {/* Action & Meetup Footer */}
              <div className="pt-3 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="space-y-0.5 text-slate-400 text-[11px] font-mono">
                  <div className="flex items-center gap-1 text-slate-300">
                    <Clock className="w-3 h-3 text-cyan-400" />
                    <span>{item.durationMinutes} Mins Session</span>
                  </div>
                  <div className="flex items-center gap-1 text-slate-400">
                    <MapPin className="w-3 h-3 text-indigo-400" />
                    <span>{item.meetupSpot}</span>
                  </div>
                </div>

                <button
                  onClick={() => handleProposeBarter(item)}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-bold shadow-md shadow-cyan-600/20 transition flex items-center justify-center gap-1.5 shrink-0"
                >
                  <Send className="w-3 h-3" /> Propose Quick Barter
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Post Barter Modal */}
      {showPostModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-3xl bg-slate-900 border border-slate-700 p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-cyan-400" /> Post a Skill Barter
              </h3>
              <button
                onClick={() => setShowPostModal(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateListing} className="space-y-4 text-xs">
              {/* Offering Section */}
              <div className="space-y-2">
                <label className="text-slate-300 font-semibold block">What skill are you offering?</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <select
                    value={offeringCategory}
                    onChange={(e) => setOfferingCategory(e.target.value as SkillCategory)}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                  >
                    <option value="CODE_DEV">💻 Code & Dev</option>
                    <option value="DESIGN_UI">🎨 UI/UX Design</option>
                    <option value="LEGAL_VISA">🏛️ Visas & Tax</option>
                    <option value="GROWTH_MARKETING">📈 Growth</option>
                    <option value="PRODUCT_PITCH">🎯 Pitch</option>
                    <option value="LANGUAGE_CULTURE">🌍 Language</option>
                  </select>
                  <input
                    type="text"
                    required
                    value={offeringSkill}
                    onChange={(e) => setOfferingSkill(e.target.value)}
                    placeholder="e.g. Next.js performance / Python"
                    className="sm:col-span-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              {/* Seeking Section */}
              <div className="space-y-2">
                <label className="text-slate-300 font-semibold block">What skill are you seeking?</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <select
                    value={seekingCategory}
                    onChange={(e) => setSeekingCategory(e.target.value as SkillCategory)}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                  >
                    <option value="DESIGN_UI">🎨 UI/UX Design</option>
                    <option value="CODE_DEV">💻 Code & Dev</option>
                    <option value="LEGAL_VISA">🏛️ Visas & Tax</option>
                    <option value="GROWTH_MARKETING">📈 Growth</option>
                    <option value="PRODUCT_PITCH">🎯 Pitch</option>
                    <option value="LANGUAGE_CULTURE">🌍 Language</option>
                  </select>
                  <input
                    type="text"
                    required
                    value={seekingSkill}
                    onChange={(e) => setSeekingSkill(e.target.value)}
                    placeholder="e.g. Spanish practice / Figma UI"
                    className="sm:col-span-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              {/* Duration & Meetup Spot */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block text-[11px] mb-1">Duration</label>
                  <select
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value) as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                  >
                    <option value={15}>15 Minutes (Quick Sync)</option>
                    <option value={30}>30 Minutes (Deep Dive)</option>
                    <option value={45}>45 Minutes (Full Review)</option>
                  </select>
                </div>

                <div>
                  <label className="text-slate-400 block text-[11px] mb-1">On-Site Meetup Spot</label>
                  <input
                    type="text"
                    value={meetupSpot}
                    onChange={(e) => setMeetupSpot(e.target.value)}
                    placeholder="e.g. Lounge Table 4"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowPostModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={posting}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-bold shadow-lg shadow-cyan-600/30 transition disabled:opacity-50"
                >
                  {posting ? "Publishing..." : "Post Barter"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
