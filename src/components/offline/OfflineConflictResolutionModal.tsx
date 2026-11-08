"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  X,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  ShieldCheck,
  Globe,
  Edit3,
  Lock,
} from "lucide-react";
import { useOfflineConflicts } from "@/hooks/useOfflineConflicts";
import {
  offlineConflictService,
  type ConflictedQueueItem,
} from "@/lib/offline/conflictService";

export const CONFLICT_RESOLUTION_LOCK = "worksphere_conflict_resolution";

export interface LockResolutionOptions {
  itemId?: string;
  checkAlreadyResolved?: () => Promise<boolean>;
  maxRetries?: number;
  lockName?: string;
}

export interface LockResolutionResult<T> {
  success: boolean;
  result?: T;
  alreadyResolved: boolean;
  error?: string;
}

/**
 * Executes conflict resolution within an exclusive Web Lock across browser tabs.
 * If Web Locks API is not available or encounters transaction collisions,
 * executes safe transaction retry backoff.
 */
export async function withConflictResolutionLock<T>(
  callback: () => Promise<T>,
  options: LockResolutionOptions = {},
): Promise<LockResolutionResult<T>> {
  const lockName = options.lockName || CONFLICT_RESOLUTION_LOCK;
  const maxRetries = options.maxRetries ?? 3;

  const hasLocksApi =
    typeof navigator !== "undefined" &&
    "locks" in navigator &&
    typeof navigator.locks?.request === "function";

  if (hasLocksApi) {
    return new Promise<LockResolutionResult<T>>((resolve) => {
      navigator.locks
        .request(lockName, { mode: "exclusive" }, async () => {
          try {
            // Check if already resolved by another tab before committing
            if (options.checkAlreadyResolved) {
              const alreadyDone = await options.checkAlreadyResolved();
              if (alreadyDone) {
                resolve({ success: true, alreadyResolved: true });
                return;
              }
            }

            const result = await callback();
            resolve({ success: true, result, alreadyResolved: false });
          } catch (err: any) {
            resolve({
              success: false,
              alreadyResolved: false,
              error: err?.message || "Lock resolution execution error",
            });
          }
        })
        .catch((err: any) => {
          resolve({
            success: false,
            alreadyResolved: false,
            error: err?.message || "Web Lock request error",
          });
        });
    });
  }

  // Fallback for browsers without Web Locks API: Safe transaction retry backoff
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (options.checkAlreadyResolved) {
        const alreadyDone = await options.checkAlreadyResolved();
        if (alreadyDone) {
          return { success: true, alreadyResolved: true };
        }
      }

      const result = await callback();
      return { success: true, result, alreadyResolved: false };
    } catch (err: any) {
      const isAbortError =
        err?.name === "AbortError" ||
        err?.message?.includes("aborted") ||
        err?.message?.includes("transaction");

      if (isAbortError && attempt < maxRetries) {
        // Exponential backoff with jitter (50ms, 100ms, 200ms...)
        const backoffMs = Math.min(
          500,
          50 * Math.pow(2, attempt) + Math.random() * 30,
        );
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }

      return {
        success: false,
        alreadyResolved: false,
        error: err?.message || "Transaction error during conflict resolution",
      };
    }
  }

  return {
    success: false,
    alreadyResolved: false,
    error: "Exceeded maximum retry attempts without acquiring lock",
  };
}

export interface OfflineConflictResolutionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function OfflineConflictResolutionModal({
  isOpen,
  onClose,
}: OfflineConflictResolutionModalProps) {
  const {
    conflicts,
    conflictCount,
    isLoading,
    resolveItem,
    bulkResolve,
    refresh,
  } = useOfflineConflicts();

  const [selectedDomain, setSelectedDomain] = useState<string>("all");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editJson, setEditJson] = useState<string>("");
  const [editError, setEditError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [isBulkResolving, setIsBulkResolving] = useState<boolean>(false);
  const [resolutionNotice, setResolutionNotice] = useState<string | null>(null);

  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

  // Subscribe to cross-tab conflict resolution messages
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof BroadcastChannel === "undefined"
    ) {
      return;
    }

    try {
      const channel = new BroadcastChannel("worksphere_offline_conflicts");
      broadcastChannelRef.current = channel;

      channel.onmessage = async (event) => {
        if (
          event.data?.type === "CONFLICT_RESOLVED" ||
          event.data?.type === "ALL_CONFLICTS_RESOLVED"
        ) {
          setResolutionNotice(
            "Conflict state updated by another browser tab. Refreshing...",
          );
          await refresh();
        }
      };

      return () => {
        channel.close();
        broadcastChannelRef.current = null;
      };
    } catch {
      // BroadcastChannel unsupported fallback
    }
  }, [refresh]);

  if (!isOpen) return null;

  const domains = Array.from(
    new Set(["all", ...conflicts.map((c) => c.domain)]),
  );

  const filteredConflicts = conflicts.filter((item) => {
    if (selectedDomain === "all") return true;
    return item.domain === selectedDomain;
  });

  const handleStartEdit = (item: ConflictedQueueItem) => {
    setEditingItemId(item.id);
    setEditJson(JSON.stringify(item.clientPayload, null, 2));
    setEditError(null);
  };

  const handleSaveCustomMerge = async (item: ConflictedQueueItem) => {
    try {
      const parsed = JSON.parse(editJson);
      setResolvingId(item.id);
      setResolutionNotice(null);

      const lockResult = await withConflictResolutionLock(
        async () => {
          return await resolveItem(item, "CUSTOM_MERGE", parsed);
        },
        {
          itemId: item.id,
          checkAlreadyResolved: async () => {
            const current = await offlineConflictService.getConflictedItems();
            return !current.some((c) => c.id === item.id);
          },
        },
      );

      if (lockResult.alreadyResolved) {
        setResolutionNotice(
          `Conflict for "${item.title}" was already resolved in another tab.`,
        );
        setEditingItemId(null);
        setEditJson("");
        await refresh();
      } else if (lockResult.success) {
        setEditingItemId(null);
        setEditJson("");
        broadcastChannelRef.current?.postMessage({
          type: "CONFLICT_RESOLVED",
          itemId: item.id,
        });
      } else if (lockResult.error) {
        setEditError(lockResult.error);
      }
    } catch (e: any) {
      setEditError(e.message || "Invalid JSON payload syntax");
    } finally {
      setResolvingId(null);
    }
  };

  const handleResolve = async (
    item: ConflictedQueueItem,
    strategy: "CLIENT_WINS" | "SERVER_WINS",
  ) => {
    setResolvingId(item.id);
    setResolutionNotice(null);

    try {
      const lockResult = await withConflictResolutionLock(
        async () => {
          return await resolveItem(item, strategy);
        },
        {
          itemId: item.id,
          checkAlreadyResolved: async () => {
            const current = await offlineConflictService.getConflictedItems();
            return !current.some((c) => c.id === item.id);
          },
        },
      );

      if (lockResult.alreadyResolved) {
        setResolutionNotice(
          `Conflict for "${item.title}" was already resolved in another tab.`,
        );
        await refresh();
      } else if (!lockResult.success && lockResult.error) {
        setResolutionNotice(`Resolution error: ${lockResult.error}`);
      } else {
        broadcastChannelRef.current?.postMessage({
          type: "CONFLICT_RESOLVED",
          itemId: item.id,
        });
      }
    } finally {
      setResolvingId(null);
    }
  };

  const handleBulkResolve = async (strategy: "CLIENT_WINS" | "SERVER_WINS") => {
    if (conflicts.length === 0) return;
    setIsBulkResolving(true);
    setResolutionNotice(null);

    try {
      const lockResult = await withConflictResolutionLock(
        async () => {
          await bulkResolve(strategy);
        },
        {
          checkAlreadyResolved: async () => {
            const current = await offlineConflictService.getConflictedItems();
            return current.length === 0;
          },
        },
      );

      if (lockResult.alreadyResolved) {
        setResolutionNotice(
          "All offline conflicts were already resolved in another tab.",
        );
        await refresh();
      } else {
        broadcastChannelRef.current?.postMessage({
          type: "ALL_CONFLICTS_RESOLVED",
        });
      }
    } finally {
      setIsBulkResolving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-resolution-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-200"
    >
      <div className="w-full max-w-4xl rounded-2xl bg-zinc-950 border border-zinc-800 text-zinc-100 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/80 bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2
                  id="conflict-resolution-title"
                  className="text-base font-semibold text-white"
                >
                  Offline Conflict Resolution
                </h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-300">
                  {conflictCount}{" "}
                  {conflictCount === 1 ? "Conflict" : "Conflicts"}
                </span>
                <span
                  data-testid="web-lock-indicator"
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-mono font-semibold text-emerald-400 border border-emerald-500/20"
                >
                  <Lock className="w-2.5 h-2.5 text-emerald-400" />
                  Web Lock Active
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Reconcile local IndexedDB drafts with server modifications
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => refresh()}
              disabled={isLoading || isBulkResolving}
              className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition-colors disabled:opacity-50"
              title="Refresh conflict status"
            >
              <RefreshCw
                className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`}
              />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition-colors"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Inter-Tab Notice Banner */}
        {resolutionNotice && (
          <div
            data-testid="conflict-resolution-notice"
            className="mx-6 mt-4 flex items-center justify-between gap-3 rounded-xl bg-blue-500/10 border border-blue-500/20 px-4 py-3 text-xs text-blue-300 animate-in fade-in"
          >
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-blue-400 shrink-0" />
              <span>{resolutionNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setResolutionNotice(null)}
              className="text-blue-400 hover:text-blue-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Toolbar & Filter Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-zinc-800/60 bg-zinc-900/30">
          <div className="flex items-center gap-1.5 overflow-x-auto py-1">
            {domains.map((dom) => (
              <button
                key={dom}
                onClick={() => setSelectedDomain(dom)}
                className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition-all ${
                  selectedDomain === dom
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
                }`}
              >
                {dom}
              </button>
            ))}
          </div>

          {filteredConflicts.length > 1 && (
            <div className="flex items-center gap-2">
              <button
                data-testid="bulk-client-wins-btn"
                onClick={() => handleBulkResolve("CLIENT_WINS")}
                disabled={isLoading || isBulkResolving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Keep All Local
              </button>
              <button
                data-testid="bulk-server-wins-btn"
                onClick={() => handleBulkResolve("SERVER_WINS")}
                disabled={isLoading || isBulkResolving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                <Globe className="w-3.5 h-3.5" />
                Accept All Server
              </button>
            </div>
          )}
        </div>

        {/* Conflict Items List */}
        <div className="flex-1 overflow-auto p-6 space-y-4">
          {filteredConflicts.length === 0 ? (
            <div className="py-16 text-center text-zinc-500 flex flex-col items-center justify-center">
              <div className="h-12 w-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mb-3">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-semibold text-zinc-200">
                No Unresolved Conflicts
              </h3>
              <p className="text-xs text-zinc-400 mt-1 max-w-sm">
                All queued offline actions in IndexedDB are clean and
                synchronized with the cloud.
              </p>
            </div>
          ) : (
            filteredConflicts.map((item) => {
              const isEditing = editingItemId === item.id;
              const isResolving = resolvingId === item.id;

              return (
                <div
                  key={item.id}
                  data-testid={`conflict-item-${item.id}`}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 shadow-md space-y-4 hover:border-zinc-700 transition-colors"
                >
                  {/* Card Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/60 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-mono font-semibold text-amber-400 border border-amber-500/20 uppercase">
                        {item.domain}
                      </span>
                      <h4 className="text-sm font-semibold text-white">
                        {item.title}
                      </h4>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                      <span>Retries: {item.retryCount}</span>
                      <span>·</span>
                      <span>
                        {new Date(item.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>

                  {item.lastError && (
                    <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-xs text-rose-300">
                      Reason: {item.lastError}
                    </div>
                  )}

                  {/* Side-by-side Diff or JSON Editor */}
                  {isEditing ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-zinc-400">
                        <span>Edit Client Payload (JSON):</span>
                        {editError && (
                          <span className="text-rose-400">{editError}</span>
                        )}
                      </div>
                      <textarea
                        data-testid={`edit-json-textarea-${item.id}`}
                        value={editJson}
                        onChange={(e) => {
                          setEditJson(e.target.value);
                          setEditError(null);
                        }}
                        rows={6}
                        className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 font-mono text-xs text-emerald-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setEditingItemId(null)}
                          className="px-3 py-1.5 rounded-lg border border-zinc-700 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
                        >
                          Cancel
                        </button>
                        <button
                          data-testid="save-custom-merge-btn"
                          onClick={() => handleSaveCustomMerge(item)}
                          disabled={isResolving}
                          className="px-3 py-1.5 rounded-lg bg-amber-500 text-xs font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
                        >
                          {isResolving
                            ? "Locking & Saving..."
                            : "Save & Resolve"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Left: Local Draft */}
                      <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-3.5 space-y-2">
                        <div className="flex items-center justify-between text-xs font-semibold text-emerald-400">
                          <span className="flex items-center gap-1.5">
                            <ShieldCheck className="w-3.5 h-3.5" /> Local
                            Offline Draft
                          </span>
                          <span className="text-[10px] text-zinc-400 font-mono font-normal">
                            IndexedDB
                          </span>
                        </div>
                        <div className="text-xs space-y-1 font-mono text-zinc-300 bg-black/40 rounded-lg p-2.5 overflow-x-auto max-h-36">
                          {Object.entries(item.clientPayload).map(([k, v]) => (
                            <div key={k} className="flex justify-between gap-2">
                              <span className="text-zinc-500">{k}:</span>
                              <span className="text-emerald-300 truncate max-w-[200px]">
                                {typeof v === "object"
                                  ? JSON.stringify(v)
                                  : String(v)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Right: Remote Server State */}
                      <div className="rounded-xl border border-blue-500/20 bg-blue-950/10 p-3.5 space-y-2">
                        <div className="flex items-center justify-between text-xs font-semibold text-blue-400">
                          <span className="flex items-center gap-1.5">
                            <Globe className="w-3.5 h-3.5" /> Remote Server
                            State
                          </span>
                          <span className="text-[10px] text-zinc-400 font-mono font-normal">
                            Cloud
                          </span>
                        </div>
                        <div className="text-xs space-y-1 font-mono text-zinc-300 bg-black/40 rounded-lg p-2.5 overflow-x-auto max-h-36">
                          {item.serverState ? (
                            Object.entries(item.serverState).map(([k, v]) => (
                              <div
                                key={k}
                                className="flex justify-between gap-2"
                              >
                                <span className="text-zinc-500">{k}:</span>
                                <span className="text-blue-300 truncate max-w-[200px]">
                                  {typeof v === "object"
                                    ? JSON.stringify(v)
                                    : String(v)}
                                </span>
                              </div>
                            ))
                          ) : (
                            <span className="text-zinc-500 italic">
                              Server state unavailable (e.g. dead-letter
                              mutation error)
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Actions Bar */}
                  {!isEditing && (
                    <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                      <button
                        type="button"
                        data-testid={`edit-payload-btn-${item.id}`}
                        onClick={() => handleStartEdit(item)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        Edit Payload
                      </button>

                      <button
                        type="button"
                        data-testid={`accept-server-btn-${item.id}`}
                        onClick={() => handleResolve(item, "SERVER_WINS")}
                        disabled={isResolving}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors disabled:opacity-50"
                      >
                        <Globe className="w-3.5 h-3.5 text-blue-400" />
                        Accept Server
                      </button>

                      <button
                        type="button"
                        data-testid={`keep-local-btn-${item.id}`}
                        onClick={() => handleResolve(item, "CLIENT_WINS")}
                        disabled={isResolving}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors disabled:opacity-50"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Keep Local (Client Wins)
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-zinc-800/80 bg-zinc-900/50 text-xs text-zinc-400">
          <span>Total IndexedDB conflicts: {conflictCount}</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
