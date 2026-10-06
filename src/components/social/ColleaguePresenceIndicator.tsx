"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Users,
  Sparkles,
  MapPin,
  Clock,
  CheckCircle2,
  X,
  ExternalLink,
  ChevronRight,
  UserPlus,
  Send,
} from "lucide-react";
import { useColleaguePresence } from "@/hooks/useColleaguePresence";

export interface ColleaguePresenceIndicatorProps {
  venueId: string;
  venueName?: string;
  className?: string;
  compact?: boolean;
}

export function ColleaguePresenceIndicator({
  venueId,
  venueName = "Workspace",
  className = "",
  compact = false,
}: ColleaguePresenceIndicatorProps) {
  const {
    activeCount,
    colleagues,
    isSelfPresent,
    isLoading,
    publishPresence,
    leaveVenue,
  } = useColleaguePresence(venueId);

  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [sharingNote, setSharingNote] = useState("");
  const [isSharing, setIsSharing] = useState(false);

  if (isLoading && activeCount === 0) {
    return null;
  }

  const handleShareStatus = async () => {
    setIsSharing(true);
    await publishPresence(sharingNote || "Coworking with teammates!");
    setIsSharing(false);
    setSharingNote("");
  };

  if (compact) {
    if (activeCount === 0) return null;
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsPopoverOpen(true)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all cursor-pointer ${className}`}
        title={`${activeCount} colleague${activeCount !== 1 ? "s" : ""} working here now`}
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <Users className="w-3.5 h-3.5" />
        <span>{activeCount} here</span>
      </div>
    );
  }

  return (
    <>
      <div
        className={`rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 p-4 shadow-sm transition-all ${className}`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Avatar stack and title */}
          <div className="flex items-center gap-3">
            {activeCount > 0 ? (
              <div className="flex -space-x-2 overflow-hidden">
                {colleagues.slice(0, 4).map((c, i) => (
                  <div
                    key={c.userId || i}
                    className="inline-block h-8 w-8 rounded-full ring-2 ring-white dark:ring-zinc-900 bg-gradient-to-tr from-violet-600 to-indigo-500 text-white flex items-center justify-center text-xs font-bold uppercase shadow-sm"
                    title={c.name}
                  >
                    {c.imageUrl ? (
                      <img
                        src={c.imageUrl}
                        alt={c.name}
                        className="h-full w-full rounded-full object-cover"
                      />
                    ) : (
                      c.name.slice(0, 2)
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                <Users className="w-4 h-4" />
              </div>
            )}

            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-1.5">
                  {activeCount > 0 ? (
                    <>
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                      </span>
                      <span>
                        {activeCount} {activeCount === 1 ? "Teammate" : "Teammates"} Working Here
                      </span>
                    </>
                  ) : (
                    "No Teammates Checked In"
                  )}
                </h4>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {activeCount > 0
                  ? "Cowork together or grab an adjacent desk"
                  : "Be the first to check in and invite colleagues"}
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 self-end sm:self-center">
            {activeCount > 0 ? (
              <button
                type="button"
                onClick={() => setIsPopoverOpen(true)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold transition-colors cursor-pointer"
              >
                <span>View Presence ({activeCount})</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIsPopoverOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-medium transition-colors cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Share Status</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Popover / Presence Details Modal */}
      {isPopoverOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-200"
        >
          <div className="w-full max-w-md rounded-3xl bg-zinc-950 border border-zinc-800 text-zinc-100 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Users className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Teammate Presence
                  </h3>
                  <p className="text-xs text-zinc-400 truncate max-w-[200px]">
                    {venueName}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsPopoverOpen(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Colleague List */}
            <div className="flex-1 overflow-auto p-6 space-y-4">
              {activeCount > 0 ? (
                <div className="space-y-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    Currently Checked In ({colleagues.length})
                  </span>

                  {colleagues.map((c) => (
                    <div
                      key={c.userId}
                      className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3.5 flex items-start justify-between gap-3 shadow-sm"
                    >
                      <div className="flex items-start gap-3">
                        <div className="h-10 w-10 shrink-0 rounded-full bg-gradient-to-tr from-violet-600 to-indigo-500 text-white flex items-center justify-center text-sm font-bold uppercase overflow-hidden shadow">
                          {c.imageUrl ? (
                            <img
                              src={c.imageUrl}
                              alt={c.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            c.name.slice(0, 2)
                          )}
                        </div>

                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-white">
                              {c.name}
                            </span>
                            {c.seatNumber && (
                              <span className="px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[10px] font-mono font-semibold">
                                Seat {c.seatNumber}
                              </span>
                            )}
                          </div>
                          {c.statusNote && (
                            <p className="text-xs text-zinc-300 italic">
                              "{c.statusNote}"
                            </p>
                          )}
                          {c.until && (
                            <p className="text-[10px] text-zinc-500 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              Working until{" "}
                              {new Date(c.until).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </p>
                          )}
                        </div>
                      </div>

                      <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400 shrink-0 shadow-[0_0_10px_rgba(52,211,153,.8)] mt-1.5" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-6 text-center text-zinc-500 text-xs">
                  No active teammate presence reported at this venue.
                </div>
              )}

              {/* Share My Status Section */}
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
                <span className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                  {isSelfPresent ? "Your Status is Live" : "Broadcast Your Presence"}
                </span>

                {isSelfPresent ? (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Visible to teammates
                    </span>
                    <button
                      type="button"
                      onClick={() => leaveVenue()}
                      className="px-3 py-1 rounded-lg border border-zinc-700 bg-zinc-800 text-xs text-zinc-300 hover:bg-zinc-700"
                    >
                      Leave Venue
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <input
                      type="text"
                      maxLength={120}
                      value={sharingNote}
                      onChange={(e) => setSharingNote(e.target.value)}
                      placeholder="What are you focusing on today?"
                      className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={handleShareStatus}
                      disabled={isSharing}
                      className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{isSharing ? "Broadcasting..." : "Share My Work Status"}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Footer CTA */}
            <div className="p-4 border-t border-zinc-800 bg-zinc-900/50 flex gap-2">
              <Link
                href={`/reserve/${venueId}`}
                className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-500 hover:from-violet-500 hover:to-indigo-400 text-white text-xs font-bold shadow-md transition-all"
              >
                <span>Reserve Adjacent Desk</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
