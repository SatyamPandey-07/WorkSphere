"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Sparkles,
  X,
  Compass,
  Clock,
  CheckCircle2,
  AlertCircle,
  Info,
  RotateCcw,
  ExternalLink,
  Volume2,
  VolumeX,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";

export interface ConciergeNotification {
  id: string;
  title: string;
  message: string;
  type: "recommendation" | "insight" | "tip" | "alert";
  timestamp?: string;
  actionLabel?: string;
  actionUrl?: string;
  category?: string;
}

export interface AutonomousConciergeDashboardProps {
  notifications?: ConciergeNotification[];
  onDismissNotification?: (id: string) => void;
  onNotificationClick?: (notification: ConciergeNotification) => void;
  className?: string;
  title?: string;
  subtitle?: string;
  /** Real-time live decibel level from sensor or microphone telemetry */
  liveDecibelLevel?: number;
  /** Focus noise budget threshold in dB (default: 68 dB) */
  acousticThresholdDb?: number;
  /** Current user desk identifier (default: "Desk-Atrium-12") */
  currentDeskId?: string;
  /** Current user sector or zone name (default: "Glass Atrium") */
  currentZoneName?: string;
  /** Recommended quiet target zone for acoustic rerouting */
  targetQuietZoneName?: string;
  /** Callback fired when user engages tactical acoustic desk reroute */
  onEngageAcousticReroute?: (targetZoneName: string, targetDeskId: string) => void;
  /** Whether to render live acoustic telemetry controls & simulation trigger (default: true) */
  enableAcousticTelemetry?: boolean;
}

export const SESSION_STORAGE_DISMISSED_KEY =
  "worksphere_dismissed_concierge_notifications";

export const DEFAULT_CONCIERGE_NOTIFICATIONS: ConciergeNotification[] = [
  {
    id: "concierge-rec-1",
    title: "Quiet Workspace Recommendation",
    message:
      "Based on your focus pattern, Floor 3 Silent Lounge currently has 85% quiet rating and 4 open ergonomic desks.",
    type: "recommendation",
    timestamp: "Just now",
    actionLabel: "Reserve Spot",
    category: "Focus Zone",
  },
  {
    id: "concierge-rec-2",
    title: "Peak Noise Alert Avoidance",
    message:
      "Ground Floor Cafe is experiencing high ambient noise levels (72dB). We suggest moving to North Wing pods.",
    type: "alert",
    timestamp: "10m ago",
    actionLabel: "View Map",
    category: "Noise Monitor",
  },
  {
    id: "concierge-rec-3",
    title: "Optimal Break Timing",
    message:
      "You've been in high focus mode for 90 minutes. Taking a 10-minute stretch break will optimize energy levels.",
    type: "tip",
    timestamp: "25m ago",
    category: "Wellness",
  },
  {
    id: "concierge-rec-4",
    title: "Preferred Desk Availability",
    message:
      "Desk 14B in your favorite window zone just freed up for afternoon booking.",
    type: "insight",
    timestamp: "1h ago",
    actionLabel: "Quick Book",
    category: "Availability",
  },
];

export function AutonomousConciergeDashboard({
  notifications: customNotifications,
  onDismissNotification,
  onNotificationClick,
  className = "",
  title = "Autonomous Concierge",
  subtitle = "AI-driven real-time recommendations & workspace insights tailored for you.",
  liveDecibelLevel,
  acousticThresholdDb = 68,
  currentDeskId = "Desk-Atrium-12",
  currentZoneName = "Sector-02 // Glass Atrium",
  targetQuietZoneName = "Sector-03 // Acoustic Library",
  onEngageAcousticReroute,
  enableAcousticTelemetry = true,
}: AutonomousConciergeDashboardProps) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());
  const [fadingOutIds, setFadingOutIds] = useState<Set<string>>(() => new Set());

  // Real-time acoustic telemetry and simulated spike trigger
  const [simulatedDb, setSimulatedDb] = useState<number | null>(null);
  const currentDb = simulatedDb !== null ? simulatedDb : (liveDecibelLevel ?? 52);
  const isAcousticTurbulence = currentDb > acousticThresholdDb;

  // Active reroute confirmation status
  const [rerouteConfirmation, setRerouteConfirmation] = useState<{
    applied: boolean;
    deskId: string;
    zoneName: string;
    timestamp: string;
  } | null>(null);

  const acousticNotificationId = "dynamic-acoustic-reroute-trigger";

  const handleEngageReroute = useCallback(() => {
    const targetDesk = "Desk-Quiet-3B";
    if (onEngageAcousticReroute) {
      onEngageAcousticReroute(targetQuietZoneName, targetDesk);
    }
    setRerouteConfirmation({
      applied: true,
      deskId: targetDesk,
      zoneName: targetQuietZoneName,
      timestamp: "Just now",
    });
  }, [onEngageAcousticReroute, targetQuietZoneName]);

  const toggleSimulateSpike = useCallback(() => {
    setSimulatedDb((prev) => (prev === 78 ? 44 : 78));
  }, []);

  // Dynamic acoustic reroute notification generated when noise exceeds focus threshold
  const dynamicAcousticNotification: ConciergeNotification | null = useMemo(() => {
    if (!isAcousticTurbulence || rerouteConfirmation?.applied) return null;
    return {
      id: acousticNotificationId,
      title: "Acoustic Noise Spike Detected // Tactical Reroute Available",
      message: `Ambient noise at your active desk ${currentDeskId} (${currentDb} dB) exceeds your focus threshold (${acousticThresholdDb} dB). Quiet Pod 3B (38 dB) in ${targetQuietZoneName} is open with zero transfer fee.`,
      type: "alert",
      timestamp: "Live telemetry",
      actionLabel: "Engage Tactical Reroute",
      category: "Acoustic Auto-Reroute",
    };
  }, [
    isAcousticTurbulence,
    rerouteConfirmation,
    currentDb,
    acousticThresholdDb,
    currentDeskId,
    targetQuietZoneName,
  ]);

  const allNotifications = useMemo(() => {
    const base = customNotifications || DEFAULT_CONCIERGE_NOTIFICATIONS;
    if (dynamicAcousticNotification && !dismissedIds.has(acousticNotificationId)) {
      return [dynamicAcousticNotification, ...base];
    }
    return base;
  }, [customNotifications, dynamicAcousticNotification, dismissedIds]);

  // Load dismissed notification IDs from session state
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const stored = sessionStorage.getItem(SESSION_STORAGE_DISMISSED_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setDismissedIds(new Set(parsed));
        }
      }
    } catch (err) {
      console.warn("[AutonomousConciergeDashboard] Error reading sessionStorage:", err);
    }
  }, []);

  // Save dismissed notification IDs to session state
  const saveDismissedIdsToSession = useCallback((updatedSet: Set<string>) => {
    if (typeof window === "undefined") return;
    try {
      const arr = Array.from(updatedSet);
      sessionStorage.setItem(SESSION_STORAGE_DISMISSED_KEY, JSON.stringify(arr));
    } catch (err) {
      console.warn("[AutonomousConciergeDashboard] Error writing sessionStorage:", err);
    }
  }, []);

  // Smooth dismiss handler
  const handleDismiss = useCallback(
    (id: string, e?: React.MouseEvent) => {
      if (e) {
        e.stopPropagation();
      }

      // Step 1: Trigger smooth fade out transition
      setFadingOutIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });

      // Step 2: After transition completes, mark as dismissed and update session storage
      setTimeout(() => {
        setDismissedIds((prev) => {
          const next = new Set(prev);
          next.add(id);
          saveDismissedIdsToSession(next);
          return next;
        });

        setFadingOutIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });

        if (onDismissNotification) {
          onDismissNotification(id);
        }
      }, 300); // 300ms matching CSS transition duration
    },
    [saveDismissedIdsToSession, onDismissNotification]
  );

  // Reset all dismissed notifications for testing or user action
  const handleResetDismissed = useCallback(() => {
    setDismissedIds(new Set());
    setFadingOutIds(new Set());
    if (typeof window !== "undefined") {
      try {
        sessionStorage.removeItem(SESSION_STORAGE_DISMISSED_KEY);
      } catch (err) {
        console.warn("[AutonomousConciergeDashboard] Error clearing sessionStorage:", err);
      }
    }
  }, []);

  const activeNotifications = allNotifications.filter(
    (n) => !dismissedIds.has(n.id)
  );

  const getTypeIcon = (type: ConciergeNotification["type"]) => {
    switch (type) {
      case "recommendation":
        return <Sparkles className="w-4 h-4 text-emerald-500 shrink-0" />;
      case "alert":
        return <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />;
      case "tip":
        return <Info className="w-4 h-4 text-blue-500 shrink-0" />;
      case "insight":
        return <Compass className="w-4 h-4 text-indigo-500 shrink-0" />;
      default:
        return <Sparkles className="w-4 h-4 text-emerald-500 shrink-0" />;
    }
  };

  const getTypeBadgeStyle = (type: ConciergeNotification["type"]) => {
    switch (type) {
      case "recommendation":
        return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
      case "alert":
        return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
      case "tip":
        return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";
      case "insight":
        return "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20";
      default:
        return "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/20";
    }
  };

  return (
    <div
      data-testid="autonomous-concierge-dashboard"
      className={`rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md p-5 sm:p-6 shadow-xl ${className}`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 pb-4 border-b border-zinc-100 dark:border-zinc-800/80">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <span>{title}</span>
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                Live AI
              </span>
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {subtitle}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Live Acoustic Telemetry Badge & Control */}
          {enableAcousticTelemetry && (
            <div className="flex items-center gap-2">
              <div
                data-testid="live-acoustic-telemetry"
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono font-semibold border transition-all ${
                  isAcousticTurbulence
                    ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30 animate-pulse shadow-sm"
                    : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                }`}
                title={`Live acoustic monitor: ${currentDb} dB (focus threshold: ${acousticThresholdDb} dB)`}
              >
                {isAcousticTurbulence ? (
                  <VolumeX className="w-3.5 h-3.5 text-red-500 shrink-0" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                )}
                <span>{currentDb} dB</span>
                <span className="text-[10px] text-zinc-400">/ max {acousticThresholdDb}</span>
                {isAcousticTurbulence && (
                  <span className="text-[9px] font-black uppercase tracking-wider px-1 py-0.5 rounded bg-red-500 text-white ml-0.5">
                    SPIKE
                  </span>
                )}
              </div>

              <button
                type="button"
                data-testid="simulate-acoustic-spike-btn"
                onClick={toggleSimulateSpike}
                className="px-2.5 py-1.5 rounded-xl text-[11px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                title="Toggle simulated acoustic noise spike for testing"
              >
                {isAcousticTurbulence ? "Normalize dB (44)" : "Simulate Spike (78dB)"}
              </button>
            </div>
          )}

          {dismissedIds.size > 0 && (
            <button
              type="button"
              onClick={handleResetDismissed}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 bg-zinc-100 dark:bg-zinc-800/60 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
              title="Restore hidden notifications"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Dismissed ({dismissedIds.size})</span>
            </button>
          )}
        </div>
      </div>

      {/* Reroute Success Banner */}
      {rerouteConfirmation?.applied && (
        <div
          data-testid="acoustic-reroute-success-banner"
          className="mb-4 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs flex items-center justify-between gap-3 animate-in fade-in"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>
              <strong>Tactical Reroute Engaged:</strong> Migrated from {currentZoneName} to <strong>{rerouteConfirmation.zoneName}</strong> ({rerouteConfirmation.deskId}). Zero cancellation fees applied.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setRerouteConfirmation(null)}
            className="text-emerald-600 dark:text-emerald-400 hover:underline text-[11px] font-semibold shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Notifications Container */}
      <div
        data-testid="concierge-notifications-container"
        className="space-y-3"
      >
        {activeNotifications.length === 0 ? (
          <div
            data-testid="no-concierge-notifications"
            className="py-10 text-center rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30 p-6"
          >
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
            <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              All caught up!
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-sm mx-auto">
              You have reviewed or dismissed all active concierge suggestions.
              New recommendations will appear automatically.
            </p>
            {dismissedIds.size > 0 && (
              <button
                type="button"
                onClick={handleResetDismissed}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Show {dismissedIds.size} dismissed notifications</span>
              </button>
            )}
          </div>
        ) : (
          activeNotifications.map((n) => {
            const isFading = fadingOutIds.has(n.id);
            const isAcousticRerouteCard = n.id === acousticNotificationId;

            return (
              <div
                key={n.id}
                data-testid={`concierge-notification-${n.id}`}
                className={`group relative rounded-xl border p-4 transition-all duration-300 ease-in-out hover:shadow-md ${
                  isAcousticRerouteCard
                    ? "border-amber-400/80 bg-amber-500/10 dark:bg-amber-950/20 shadow-amber-500/10"
                    : "border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/70 dark:bg-zinc-800/40 hover:border-zinc-300 dark:hover:border-zinc-700"
                } ${
                  isFading
                    ? "opacity-0 scale-95 translate-y-1 pointer-events-none"
                    : "opacity-100 scale-100 translate-y-0"
                }`}
                onClick={() => {
                  if (onNotificationClick && !isFading) {
                    onNotificationClick(n);
                  }
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="mt-0.5 p-1.5 rounded-lg bg-white dark:bg-zinc-900 shadow-sm border border-zinc-200/60 dark:border-zinc-800">
                      {isAcousticRerouteCard ? (
                        <VolumeX className="w-4 h-4 text-red-500 shrink-0" />
                      ) : (
                        getTypeIcon(n.type)
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${
                            isAcousticRerouteCard
                              ? "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30"
                              : getTypeBadgeStyle(n.type)
                          }`}
                        >
                          {n.category || n.type}
                        </span>
                        {n.timestamp && (
                          <span className="text-[11px] text-zinc-400 dark:text-zinc-500 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {n.timestamp}
                          </span>
                        )}
                      </div>

                      <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                        {n.title}
                      </h4>

                      <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-1 leading-relaxed">
                        {n.message}
                      </p>

                      {n.actionLabel && (
                        <div className="mt-2.5">
                          {isAcousticRerouteCard ? (
                            <button
                              type="button"
                              data-testid="engage-acoustic-reroute-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEngageReroute();
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" />
                              <span>{n.actionLabel}</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (n.actionUrl && typeof window !== "undefined") {
                                  window.location.href = n.actionUrl;
                                } else if (onNotificationClick) {
                                  onNotificationClick(n);
                                }
                              }}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline"
                            >
                              <span>{n.actionLabel}</span>
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Dismiss / Close Icon Button */}
                  <button
                    type="button"
                    aria-label={`Dismiss ${n.title}`}
                    data-testid={`dismiss-button-${n.id}`}
                    onClick={(e) => handleDismiss(n.id, e)}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 transition-all shrink-0 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default AutonomousConciergeDashboard;
