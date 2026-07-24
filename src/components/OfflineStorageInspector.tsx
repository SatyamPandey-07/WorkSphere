"use client";

import { useState } from "react";
import {
  X,
  Database,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

export interface SyncLogItem {
  id?: number | string;
  type?: string;
  action?: string;
  venueId?: string;
  timestamp?: number | string | null;
  retryCount?: number;
  status?: string;
  data?: Record<string, unknown>;
}

export function formatSyncTimestamp(
  timestamp: number | string | null | undefined,
): string {
  if (timestamp === null || timestamp === undefined || timestamp === "") {
    return "N/A";
  }

  if (typeof timestamp === "number" && isNaN(timestamp)) {
    return "N/A";
  }

  let numericTs: number;

  if (typeof timestamp === "string") {
    // Check if string is numeric epoch
    const parsedNumber = Number(timestamp);
    if (!isNaN(parsedNumber)) {
      numericTs = parsedNumber;
    } else {
      const parsedDate = new Date(timestamp);
      if (isNaN(parsedDate.getTime())) {
        return "Invalid Date";
      }
      return parsedDate.toLocaleString();
    }
  } else {
    numericTs = timestamp;
  }

  const date = new Date(numericTs);
  if (isNaN(date.getTime())) {
    return "Invalid Date";
  }

  return date.toLocaleString();
}

interface OfflineStorageInspectorProps {
  isOpen: boolean;
  onClose: () => void;
  logs?: SyncLogItem[];
  onClearLogs?: () => void;
  onRefresh?: () => void;
}

export function OfflineStorageInspector({
  isOpen,
  onClose,
  logs = [],
  onClearLogs,
  onRefresh,
}: OfflineStorageInspectorProps) {
  const [filter, setFilter] = useState<string>("all");
  const [isRefreshing, setIsRefreshing] = useState(false);

  if (!isOpen) return null;

  const handleRefresh = async () => {
    if (onRefresh) {
      setIsRefreshing(true);
      await Promise.resolve(onRefresh());
      setIsRefreshing(false);
    }
  };

  const filteredLogs = logs.filter((log) => {
    if (filter === "all") return true;
    const logType = (log.type || log.action || "").toLowerCase();
    return logType.includes(filter.toLowerCase());
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-3xl rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-100 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-orange-500/10 text-orange-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                Offline Storage Inspector
              </h2>
              <p className="text-xs text-zinc-400">
                View and manage queued offline sync operations
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar & Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-zinc-800 bg-zinc-900/50">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 font-medium">Filter:</span>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-orange-500"
            >
              <option value="all">All Operations</option>
              <option value="favorite">Favorites</option>
              <option value="crdt">CRDT Sync</option>
              <option value="rate">Ratings</option>
              <option value="conversation">Conversations</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            {onRefresh && (
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition-colors disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`}
                />
                Refresh
              </button>
            )}

            {onClearLogs && (
              <button
                onClick={onClearLogs}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear Log
              </button>
            )}
          </div>
        </div>

        {/* Table Content */}
        <div className="flex-1 overflow-auto p-6">
          {filteredLogs.length === 0 ? (
            <div className="py-12 text-center text-zinc-500">
              <Database className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm font-medium">
                No offline sync log entries found
              </p>
              <p className="text-xs text-zinc-600 mt-1">
                Pending offline actions will appear here when performed offline.
              </p>
            </div>
          ) : (
            <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950/40">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-900/80 text-zinc-400 font-medium border-b border-zinc-800 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-4 py-3">Operation</th>
                    <th className="px-4 py-3">Target ID</th>
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3 text-right">Retries</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                  {filteredLogs.map((item, idx) => {
                    const logType = item.type || item.action || "sync";
                    const formattedTime = formatSyncTimestamp(item.timestamp);
                    const isInvalid =
                      formattedTime === "Invalid Date" ||
                      formattedTime === "N/A";

                    return (
                      <tr
                        key={item.id ?? idx}
                        className="hover:bg-zinc-800/40 transition-colors"
                      >
                        <td className="px-4 py-3 font-mono font-medium text-orange-400">
                          {logType}
                        </td>
                        <td className="px-4 py-3 font-mono text-zinc-400 max-w-[150px] truncate">
                          {item.venueId || String(item.id ?? "N/A")}
                        </td>
                        <td className="px-4 py-3 font-medium">
                          <span
                            className={
                              isInvalid
                                ? "text-red-400 bg-red-500/10 px-2 py-0.5 rounded text-[11px]"
                                : "text-zinc-200"
                            }
                          >
                            {formattedTime}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${
                              (item.retryCount ?? 0) > 0
                                ? "bg-amber-500/10 text-amber-400"
                                : "bg-green-500/10 text-green-400"
                            }`}
                          >
                            {(item.retryCount ?? 0) > 0 ? (
                              <AlertCircle className="w-3 h-3" />
                            ) : (
                              <CheckCircle2 className="w-3 h-3" />
                            )}
                            {item.retryCount ?? 0}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-zinc-800 bg-zinc-950/50 text-xs text-zinc-500">
          <span>Total Operations: {filteredLogs.length}</span>
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

export default OfflineStorageInspector;
