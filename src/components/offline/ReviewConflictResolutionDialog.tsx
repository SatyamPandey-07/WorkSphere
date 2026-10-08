"use client";

import React, { useState, useMemo } from "react";
import {
  GitMerge,
  AlertTriangle,
  Check,
  X,
  Server,
  Smartphone,
  Layers,
  ArrowRight,
  Sparkles,
  Wifi,
  Volume2,
  Zap,
  MessageSquare,
  Activity,
  Calendar,
} from "lucide-react";
import type {
  ConflictResolutionStrategy,
  QueuedReviewItem,
} from "@/workers/reviewConflictSync.worker";

export interface ReviewConflictResolutionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  conflictItem: {
    id: string;
    venueId: string;
    venueName?: string;
    conflictDetails?: {
      conflictType?: string;
      serverReview?: Record<string, unknown>;
      message?: string;
    };
    localReview?: QueuedReviewItem;
  } | null;
  onResolve: (
    id: string,
    resolution: ConflictResolutionStrategy,
    customData?: QueuedReviewItem["data"],
  ) => Promise<void> | void;
  isResolving?: boolean;
}

type MergeMode = "KEEP_LOCAL" | "USE_REMOTE" | "THREE_WAY_MERGE" | "CUSTOM";

export function ReviewConflictResolutionDialog({
  isOpen,
  onClose,
  conflictItem,
  onResolve,
  isResolving = false,
}: ReviewConflictResolutionDialogProps) {
  const [mergeMode, setMergeMode] = useState<MergeMode>("THREE_WAY_MERGE");
  const [customFields, setCustomFields] = useState<Record<string, "local" | "remote">>({});
  const [customComment, setCustomComment] = useState<string>("");

  const localData = conflictItem?.localReview?.data || ({} as QueuedReviewItem["data"]);
  const serverData = (conflictItem?.conflictDetails?.serverReview || {}) as Record<string, unknown>;

  // Initialize custom fields when dialog opens
  React.useEffect(() => {
    if (conflictItem) {
      setMergeMode("THREE_WAY_MERGE");
      setCustomFields({
        wifiQuality: "local",
        noiseLevel: "local",
        hasOutlets: "local",
        avgDecibels: "local",
        downloadSpeed: "local",
        comment: "local",
      });

      const localComment = localData.comment || "";
      const remoteComment = (serverData.comment as string) || "";
      if (localComment && remoteComment && localComment !== remoteComment) {
        setCustomComment(`${localComment}\n\n[Remote note]: ${remoteComment}`);
      } else {
        setCustomComment(localComment || remoteComment);
      }
    }
  }, [conflictItem]);

  const diffFields = useMemo(() => {
    const fields = [
      {
        key: "wifiQuality",
        label: "WiFi Quality",
        icon: Wifi,
        localVal: localData.wifiQuality !== undefined ? `${localData.wifiQuality}/5 Stars` : "Not rated",
        serverVal: serverData.wifiQuality !== undefined ? `${serverData.wifiQuality}/5 Stars` : "Not rated",
        isDiff: localData.wifiQuality !== serverData.wifiQuality && serverData.wifiQuality !== undefined,
      },
      {
        key: "noiseLevel",
        label: "Noise Level",
        icon: Volume2,
        localVal: localData.noiseLevel || "Not specified",
        serverVal: (serverData.noiseLevel as string) || "Not specified",
        isDiff: localData.noiseLevel !== serverData.noiseLevel && serverData.noiseLevel !== undefined,
      },
      {
        key: "hasOutlets",
        label: "Power Outlets Available",
        icon: Zap,
        localVal: localData.hasOutlets ? "Yes" : "No",
        serverVal: serverData.hasOutlets ? "Yes" : serverData.hasOutlets === false ? "No" : "Not specified",
        isDiff: localData.hasOutlets !== serverData.hasOutlets && serverData.hasOutlets !== undefined,
      },
      {
        key: "downloadSpeed",
        label: "Download Speed",
        icon: Activity,
        localVal: localData.downloadSpeed ? `${localData.downloadSpeed} Mbps` : "N/A",
        serverVal: serverData.downloadSpeed ? `${serverData.downloadSpeed} Mbps` : "N/A",
        isDiff: localData.downloadSpeed !== serverData.downloadSpeed && serverData.downloadSpeed !== undefined,
      },
      {
        key: "comment",
        label: "Review Notes & Feedback",
        icon: MessageSquare,
        localVal: localData.comment || "No comment provided",
        serverVal: (serverData.comment as string) || "No comment provided",
        isDiff: Boolean(localData.comment && serverData.comment && localData.comment !== serverData.comment),
      },
    ];

    return fields;
  }, [localData, serverData]);

  if (!isOpen || !conflictItem) return null;

  const handleApplyResolution = async () => {
    if (mergeMode === "KEEP_LOCAL") {
      await onResolve(conflictItem.id, "KEEP_LOCAL");
    } else if (mergeMode === "USE_REMOTE") {
      await onResolve(conflictItem.id, "USE_REMOTE");
    } else if (mergeMode === "THREE_WAY_MERGE") {
      await onResolve(conflictItem.id, "THREE_WAY_MERGE");
    } else {
      // CUSTOM MERGE
      const mergedData: QueuedReviewItem["data"] = {
        wifiQuality:
          customFields.wifiQuality === "remote" && serverData.wifiQuality !== undefined
            ? Number(serverData.wifiQuality)
            : localData.wifiQuality || 5,
        hasOutlets:
          customFields.hasOutlets === "remote" && serverData.hasOutlets !== undefined
            ? Boolean(serverData.hasOutlets)
            : Boolean(localData.hasOutlets),
        noiseLevel:
          customFields.noiseLevel === "remote" && serverData.noiseLevel
            ? (serverData.noiseLevel as any)
            : localData.noiseLevel || "moderate",
        downloadSpeed:
          customFields.downloadSpeed === "remote" && serverData.downloadSpeed !== undefined
            ? Number(serverData.downloadSpeed)
            : localData.downloadSpeed,
        comment: customComment,
      };

      await onResolve(conflictItem.id, "CUSTOM_MERGE" as ConflictResolutionStrategy, mergedData);
    }
    onClose();
  };

  const conflictCount = diffFields.filter((f) => f.isDiff).length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-conflict-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-200"
    >
      <div className="w-full max-w-4xl rounded-2xl bg-zinc-950 border border-zinc-800 text-zinc-100 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/80 bg-zinc-900/60">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <GitMerge className="w-5 h-5" />
            </div>
            <div>
              <h2 id="review-conflict-title" className="text-lg font-bold text-zinc-100">
                Three-Way Review Merge Conflict
              </h2>
              <p className="text-xs text-zinc-400">
                {conflictItem.venueName || "Venue Review"} • {conflictCount} conflicting {conflictCount === 1 ? "field" : "fields"} detected
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            aria-label="Close conflict resolution"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Resolution Mode Selector */}
        <div className="px-6 py-3 bg-zinc-900/40 border-b border-zinc-800/60 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMergeMode("THREE_WAY_MERGE")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              mergeMode === "THREE_WAY_MERGE"
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                : "bg-zinc-800/60 text-zinc-400 border border-zinc-700/50 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            Smart 3-Way Merge
          </button>
          <button
            type="button"
            onClick={() => setMergeMode("KEEP_LOCAL")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              mergeMode === "KEEP_LOCAL"
                ? "bg-blue-500/20 text-blue-300 border border-blue-500/40 shadow-sm"
                : "bg-zinc-800/60 text-zinc-400 border border-zinc-700/50 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
          >
            <Smartphone className="w-3.5 h-3.5 text-blue-400" />
            Keep My Local Draft
          </button>
          <button
            type="button"
            onClick={() => setMergeMode("USE_REMOTE")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              mergeMode === "USE_REMOTE"
                ? "bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm"
                : "bg-zinc-800/60 text-zinc-400 border border-zinc-700/50 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
          >
            <Server className="w-3.5 h-3.5 text-purple-400" />
            Accept Server Version
          </button>
          <button
            type="button"
            onClick={() => setMergeMode("CUSTOM")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              mergeMode === "CUSTOM"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
                : "bg-zinc-800/60 text-zinc-400 border border-zinc-700/50 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-emerald-400" />
            Field-by-Field Custom Pick
          </button>
        </div>

        {/* Diff Comparison Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-2">
            <div className="p-3 rounded-xl bg-blue-950/20 border border-blue-800/30">
              <div className="flex items-center gap-2 text-xs font-bold text-blue-400 mb-1">
                <Smartphone className="w-4 h-4" />
                <span>Your Local Offline Edit (IndexedDB)</span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Created on this device while offline or before the remote update.
              </p>
            </div>
            <div className="p-3 rounded-xl bg-purple-950/20 border border-purple-800/30">
              <div className="flex items-center gap-2 text-xs font-bold text-purple-400 mb-1">
                <Server className="w-4 h-4" />
                <span>Remote Server Version (PostgreSQL)</span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Updated on the server by another device or session concurrently.
              </p>
            </div>
          </div>

          {/* Diff Fields List */}
          <div className="space-y-3">
            {diffFields.map((field) => {
              const Icon = field.icon;
              const isCustom = mergeMode === "CUSTOM";
              const selectedSource = customFields[field.key] || "local";

              return (
                <div
                  key={field.key}
                  className={`p-4 rounded-xl border transition-all ${
                    field.isDiff
                      ? "bg-amber-950/10 border-amber-500/30"
                      : "bg-zinc-900/30 border-zinc-800/50"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4 text-zinc-400" />
                      <span className="text-xs font-semibold text-zinc-200">
                        {field.label}
                      </span>
                    </div>
                    {field.isDiff ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        Conflict
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <Check className="w-2.5 h-2.5" />
                        Matches
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Local side */}
                    <div
                      onClick={() =>
                        isCustom &&
                        setCustomFields((prev) => ({ ...prev, [field.key]: "local" }))
                      }
                      className={`p-3 rounded-lg border text-xs transition-all ${
                        isCustom
                          ? selectedSource === "local"
                            ? "border-blue-500 bg-blue-950/40 text-blue-100 cursor-pointer shadow-sm"
                            : "border-zinc-800 bg-zinc-900/40 text-zinc-400 cursor-pointer hover:border-zinc-700"
                          : mergeMode === "KEEP_LOCAL" || (mergeMode === "THREE_WAY_MERGE" && !field.isDiff)
                            ? "border-blue-500/40 bg-blue-950/20 text-zinc-200"
                            : "border-zinc-800/60 bg-zinc-900/30 text-zinc-400"
                      }`}
                    >
                      <div className="text-[10px] font-bold text-blue-400/80 uppercase tracking-wider mb-1">
                        Local Value
                      </div>
                      <div className="font-medium break-words">{field.localVal}</div>
                    </div>

                    {/* Remote side */}
                    <div
                      onClick={() =>
                        isCustom &&
                        setCustomFields((prev) => ({ ...prev, [field.key]: "remote" }))
                      }
                      className={`p-3 rounded-lg border text-xs transition-all ${
                        isCustom
                          ? selectedSource === "remote"
                            ? "border-purple-500 bg-purple-950/40 text-purple-100 cursor-pointer shadow-sm"
                            : "border-zinc-800 bg-zinc-900/40 text-zinc-400 cursor-pointer hover:border-zinc-700"
                          : mergeMode === "USE_REMOTE" || (mergeMode === "THREE_WAY_MERGE" && field.isDiff)
                            ? "border-purple-500/40 bg-purple-950/20 text-zinc-200"
                            : "border-zinc-800/60 bg-zinc-900/30 text-zinc-400"
                      }`}
                    >
                      <div className="text-[10px] font-bold text-purple-400/80 uppercase tracking-wider mb-1">
                        Server Value
                      </div>
                      <div className="font-medium break-words">{field.serverVal}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Custom Merge Comment Editor */}
          {mergeMode === "CUSTOM" && (
            <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-950/10">
              <label className="block text-xs font-semibold text-emerald-300 mb-2">
                Custom Merged Review Comment (Editable)
              </label>
              <textarea
                value={customComment}
                onChange={(e) => setCustomComment(e.target.value)}
                rows={3}
                className="w-full rounded-lg bg-zinc-900/80 border border-zinc-700 p-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
                placeholder="Compose your resolved review comment..."
              />
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800/80 bg-zinc-900/60">
          <p className="text-xs text-zinc-400 hidden sm:block">
            Resolution will sync to server and update IndexedDB cache.
          </p>
          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={isResolving}
              className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApplyResolution}
              disabled={isResolving}
              className="px-5 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-zinc-950 transition-all shadow-lg shadow-amber-500/20 disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              {isResolving ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
                  Resolving...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Apply Resolution
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ReviewConflictResolutionDialog;
