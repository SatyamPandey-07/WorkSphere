"use client";

import React, { useState, useMemo } from "react";
import {
  HardDrive,
  Archive,
  Trash2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Download,
  Filter,
  Search,
  Layers,
  Database,
  Calendar,
  ChevronRight,
  X,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import type {
  VenuePartitionDetails,
  VenuePartitionSummary,
  BulkPartitionOperationResult,
} from "@/lib/adminPartitionService";

interface BulkVenuePartitionManagerProps {
  initialData?: VenuePartitionSummary | null;
  onRefresh?: () => Promise<void>;
}

export function BulkVenuePartitionManager({
  initialData,
  onRefresh,
}: BulkVenuePartitionManagerProps) {
  const [selectedPartitions, setSelectedPartitions] = useState<Set<string>>(
    new Set(),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [parentFilter, setParentFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [isProcessing, setIsProcessing] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");
  const [operationFeedback, setOperationFeedback] = useState<{
    type: "success" | "error";
    message: string;
    details?: string[];
  } | null>(null);

  const partitions = initialData?.partitions ?? [];

  // Filter partitions based on search, parent table, and status
  const filteredPartitions = useMemo(() => {
    return partitions.filter((p) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = p.name.toLowerCase().includes(q);
        const matchesPeriod = (p.formattedPeriod || "").toLowerCase().includes(q);
        const matchesParent = p.parentTable.toLowerCase().includes(q);
        if (!matchesName && !matchesPeriod && !matchesParent) return false;
      }

      // Parent filter
      if (parentFilter !== "ALL" && p.parentTable !== parentFilter) {
        return false;
      }

      // Status filter
      if (statusFilter === "ACTIVE" && p.isArchived) return false;
      if (statusFilter === "ARCHIVED" && !p.isArchived) return false;
      if (statusFilter === "EXPIRED" && !p.isExpired) return false;
      if (statusFilter === "COLD" && !p.isNearColdStorage) return false;

      return true;
    });
  }, [partitions, searchQuery, parentFilter, statusFilter]);

  // Distinct parent tables for filter dropdown
  const parentTables = useMemo(() => {
    const set = new Set<string>();
    partitions.forEach((p) => set.add(p.parentTable));
    return Array.from(set).sort();
  }, [partitions]);

  // Selected partition items
  const selectedItems = useMemo(() => {
    return partitions.filter((p) => selectedPartitions.has(p.name));
  }, [partitions, selectedPartitions]);

  const selectedTotalBytes = useMemo(() => {
    return selectedItems.reduce((acc, p) => acc + p.tableSizeBytes, 0);
  }, [selectedItems]);

  const selectedTotalRows = useMemo(() => {
    return selectedItems.reduce((acc, p) => acc + p.rowCount, 0);
  }, [selectedItems]);

  // Selection toggles
  const handleToggleSelect = (name: string) => {
    setSelectedPartitions((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const handleSelectAllVisible = () => {
    setSelectedPartitions((prev) => {
      const next = new Set(prev);
      filteredPartitions.forEach((p) => next.add(p.name));
      return next;
    });
  };

  const handleSelectExpired = () => {
    const next = new Set<string>();
    partitions.forEach((p) => {
      if (p.isExpired && !p.isArchived) next.add(p.name);
    });
    setSelectedPartitions(next);
  };

  const handleSelectCold = () => {
    const next = new Set<string>();
    partitions.forEach((p) => {
      if (p.isNearColdStorage) next.add(p.name);
    });
    setSelectedPartitions(next);
  };

  const handleClearSelection = () => {
    setSelectedPartitions(new Set());
  };

  // Bulk Archive Action
  const handleBulkArchive = async () => {
    if (selectedPartitions.size === 0) return;
    setIsProcessing(true);
    setOperationFeedback(null);

    try {
      const res = await fetch("/api/admin/system/partitions/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partitions: Array.from(selectedPartitions) }),
      });

      const data: BulkPartitionOperationResult = await res.json();
      if (!res.ok) {
        throw new Error((data as any).error || "Failed to archive partitions");
      }

      setOperationFeedback({
        type: "success",
        message: `Successfully archived ${data.processed.length} partition(s). Freed active catalog: ${data.freedSizePretty}.`,
        details: data.failed.map((f) => `${f.name}: ${f.error}`),
      });

      setSelectedPartitions(new Set());
      setShowArchiveModal(false);
      await onRefresh?.();
    } catch (err: any) {
      setOperationFeedback({
        type: "error",
        message: err.message || "Archive operation failed",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Bulk Delete Action
  const handleBulkDelete = async () => {
    if (selectedPartitions.size === 0) return;
    if (deleteConfirmInput !== "DELETE") return;

    setIsProcessing(true);
    setOperationFeedback(null);

    try {
      const res = await fetch("/api/admin/system/partitions/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partitions: Array.from(selectedPartitions) }),
      });

      const data: BulkPartitionOperationResult = await res.json();
      if (!res.ok) {
        throw new Error((data as any).error || "Failed to delete partitions");
      }

      setOperationFeedback({
        type: "success",
        message: `Successfully permanently deleted ${data.processed.length} partition(s). Physical disk freed: ${data.freedSizePretty}.`,
        details: data.failed.map((f) => `${f.name}: ${f.error}`),
      });

      setSelectedPartitions(new Set());
      setShowDeleteModal(false);
      setDeleteConfirmInput("");
      await onRefresh?.();
    } catch (err: any) {
      setOperationFeedback({
        type: "error",
        message: err.message || "Delete operation failed",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const totalDiskBytes = initialData?.totalSizeBytes ?? 0;
  const colors = [
    "bg-violet-500",
    "bg-cyan-500",
    "bg-amber-500",
    "bg-pink-500",
    "bg-emerald-500",
    "bg-blue-500",
  ];

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-6 transition-all">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-violet-500/10 text-violet-400 border border-violet-500/20">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
                Venue Partition Archive &amp; Deletion Tool
              </h2>
              <p className="text-xs sm:text-sm text-zinc-400 mt-0.5">
                Manage high-volume venue telemetry, wifi metrics, and push log partitions.
                Batch archive to cold storage or delete old partitions.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {initialData?.status && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                initialData.status === "HEALTHY"
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  : "bg-red-500/10 text-red-400 border border-red-500/20"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  initialData.status === "HEALTHY" ? "bg-emerald-400" : "bg-red-400"
                }`}
              />
              {initialData.status}
            </span>
          )}

          {onRefresh && (
            <button
              type="button"
              onClick={() => onRefresh()}
              className="p-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-zinc-400 hover:text-zinc-200 border border-white/10 transition-colors"
              title="Refresh partition health"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Summary Stat Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10">
          <p className="text-xs text-zinc-400">Total Partitions</p>
          <p className="text-xl font-bold text-zinc-100 mt-1">
            {initialData?.totalPartitions ?? partitions.length}
          </p>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            {initialData?.activeCount ?? 0} active · {initialData?.archivedCount ?? 0} archived
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10">
          <p className="text-xs text-zinc-400">Total Partition Disk</p>
          <p className="text-xl font-bold text-violet-300 mt-1">
            {initialData?.totalSizePretty ?? "0 B"}
          </p>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            {(initialData?.totalRows ?? 0).toLocaleString()} live rows
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10">
          <p className="text-xs text-zinc-400">Expired (&gt;12 mo)</p>
          <p className="text-xl font-bold text-amber-400 mt-1">
            {initialData?.expiredCount ?? 0}
          </p>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Eligible for cold detachment
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10">
          <p className="text-xs text-zinc-400">Selected for Bulk Action</p>
          <p className="text-xl font-bold text-cyan-400 mt-1">
            {selectedPartitions.size}
          </p>
          <p className="text-[11px] text-zinc-500 mt-0.5 truncate">
            {selectedTotalBytes > 0
              ? `${(selectedTotalBytes / (1024 * 1024)).toFixed(1)} MB selected`
              : "None selected"}
          </p>
        </div>
      </div>

      {/* Stacked Disk Allocation Bar */}
      {partitions.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between text-xs text-zinc-400">
            <span>Disk Allocation Breakdown</span>
            <span>
              Total:{" "}
              <strong className="text-zinc-200">
                {initialData?.totalSizePretty ?? "0 B"}
              </strong>
            </span>
          </div>
          <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-white/[0.08] p-0.5">
            {partitions.map((part, idx) => {
              const bytes = part.tableSizeBytes ?? 0;
              const percent = totalDiskBytes > 0 ? (bytes / totalDiskBytes) * 100 : 0;
              if (percent <= 0) return null;
              const isCold = part.isNearColdStorage || bytes >= 100 * 1024 * 1024;
              return (
                <div
                  key={part.name}
                  style={{ width: `${percent}%` }}
                  title={`${part.name}: ${part.tableSizePretty} (${percent.toFixed(1)}%)`}
                  className={`h-full transition-all ${
                    isCold ? "bg-red-500 animate-pulse" : colors[idx % colors.length]
                  }`}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Operation Feedback Toast */}
      {operationFeedback && (
        <div
          className={`mb-6 p-4 rounded-2xl border flex items-start gap-3 ${
            operationFeedback.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
              : "bg-red-500/10 border-red-500/20 text-red-300"
          }`}
        >
          {operationFeedback.type === "success" ? (
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400 mt-0.5" />
          ) : (
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-400 mt-0.5" />
          )}
          <div className="flex-1 text-sm">
            <p className="font-semibold">{operationFeedback.message}</p>
            {operationFeedback.details && operationFeedback.details.length > 0 && (
              <ul className="mt-1 list-disc list-inside text-xs opacity-90">
                {operationFeedback.details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={() => setOperationFeedback(null)}
            className="text-zinc-400 hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Filter & Toolbar */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between mb-4">
        {/* Search & Parent Table Dropdown */}
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Search by partition name or month (e.g. 2025, Telemetry)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-xs sm:text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-violet-500/50"
            />
          </div>

          <select
            value={parentFilter}
            onChange={(e) => setParentFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-zinc-900 border border-white/10 text-xs sm:text-sm text-zinc-300 focus:outline-none focus:border-violet-500/50"
          >
            <option value="ALL">All Parent Tables</option>
            {parentTables.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-zinc-900 border border-white/10 text-xs sm:text-sm text-zinc-300 focus:outline-none focus:border-violet-500/50"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active (Attached)</option>
            <option value="ARCHIVED">Archived (Cold)</option>
            <option value="EXPIRED">Expired (&gt;12 mo)</option>
            <option value="COLD">Cold Limit (&gt;100 MB)</option>
          </select>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowArchiveModal(true)}
            disabled={selectedPartitions.size === 0 || isProcessing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs sm:text-sm font-medium transition-colors disabled:opacity-40"
          >
            <Archive className="h-4 w-4" />
            Bulk Archive ({selectedPartitions.size})
          </button>

          <button
            type="button"
            onClick={() => setShowDeleteModal(true)}
            disabled={selectedPartitions.size === 0 || isProcessing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/30 text-xs sm:text-sm font-medium transition-colors disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" />
            Bulk Delete ({selectedPartitions.size})
          </button>
        </div>
      </div>

      {/* Quick Select Bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4 text-xs text-zinc-400">
        <span className="text-zinc-500">Quick Select:</span>
        <button
          type="button"
          onClick={handleSelectAllVisible}
          className="px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 transition-colors"
        >
          All Visible ({filteredPartitions.length})
        </button>
        <button
          type="button"
          onClick={handleSelectExpired}
          className="px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 transition-colors"
        >
          All Expired (&gt;12 mo)
        </button>
        <button
          type="button"
          onClick={handleSelectCold}
          className="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 transition-colors"
        >
          All Heavy (&gt;100 MB)
        </button>
        {selectedPartitions.size > 0 && (
          <button
            type="button"
            onClick={handleClearSelection}
            className="px-2.5 py-1 rounded-lg bg-zinc-700/50 hover:bg-zinc-700 text-zinc-300 transition-colors ml-auto"
          >
            Clear Selection
          </button>
        )}
      </div>

      {/* Partitions Table */}
      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
        <table className="w-full text-left text-xs sm:text-sm">
          <thead className="border-b border-white/10 bg-white/[0.02] text-zinc-400">
            <tr>
              <th className="p-3.5 w-10 text-center">
                <input
                  type="checkbox"
                  checked={
                    filteredPartitions.length > 0 &&
                    filteredPartitions.every((p) => selectedPartitions.has(p.name))
                  }
                  onChange={(e) => {
                    if (e.target.checked) {
                      handleSelectAllVisible();
                    } else {
                      handleClearSelection();
                    }
                  }}
                  className="rounded border-zinc-600 bg-zinc-800 text-violet-500 focus:ring-violet-500"
                />
              </th>
              <th className="p-3.5">Partition Name</th>
              <th className="p-3.5">Parent Table</th>
              <th className="p-3.5">Period</th>
              <th className="p-3.5">Rows</th>
              <th className="p-3.5">Disk Size</th>
              <th className="p-3.5">Status</th>
              <th className="p-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filteredPartitions.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-zinc-500">
                  No partitions matched your filters.
                </td>
              </tr>
            ) : (
              filteredPartitions.map((partition) => {
                const isSelected = selectedPartitions.has(partition.name);
                const isNearingThreshold = partition.isNearColdStorage;

                return (
                  <tr
                    key={partition.name}
                    className={`transition-colors ${
                      isSelected
                        ? "bg-violet-500/10"
                        : "hover:bg-white/[0.02]"
                    }`}
                  >
                    <td className="p-3.5 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleSelect(partition.name)}
                        className="rounded border-zinc-600 bg-zinc-800 text-violet-500 focus:ring-violet-500"
                      />
                    </td>
                    <td className="p-3.5 font-mono text-zinc-200">
                      <div className="font-semibold text-zinc-100 flex items-center gap-1.5">
                        {partition.name}
                        {partition.isArchived && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-sans">
                            {partition.schema}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3.5 text-zinc-300 font-medium">
                      {partition.parentTable}
                    </td>
                    <td className="p-3.5 text-zinc-400">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5 text-zinc-500" />
                        {partition.formattedPeriod || "—"}
                      </div>
                    </td>
                    <td className="p-3.5 text-zinc-300">
                      {partition.rowCount.toLocaleString()}
                    </td>
                    <td className="p-3.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-mono ${
                            isNearingThreshold ? "text-red-400 font-semibold" : "text-zinc-200"
                          }`}
                        >
                          {partition.tableSizePretty}
                        </span>
                        {isNearingThreshold && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-red-500/20 text-red-400 font-semibold">
                            &gt;100MB
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3.5">
                      {partition.isArchived ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-zinc-700/50 text-zinc-300 border border-zinc-600/50">
                          <Archive className="h-3 w-3" /> Archived
                        </span>
                      ) : partition.isExpired ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          <AlertTriangle className="h-3 w-3" /> Expired
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <CheckCircle2 className="h-3 w-3" /> Active
                        </span>
                      )}
                    </td>
                    <td className="p-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {!partition.isArchived && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedPartitions(new Set([partition.name]));
                              setShowArchiveModal(true);
                            }}
                            className="p-1.5 rounded-lg text-amber-400 hover:bg-amber-500/10 transition-colors"
                            title="Archive this partition"
                          >
                            <Archive className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPartitions(new Set([partition.name]));
                            setShowDeleteModal(true);
                          }}
                          className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                          title="Delete this partition"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Confirmation Modal: Bulk Archive */}
      {showArchiveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-3xl bg-zinc-900 border border-white/10 p-6 text-zinc-100 shadow-2xl">
            <div className="flex items-center gap-3 mb-4 text-amber-400">
              <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <Archive className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold">
                Confirm Bulk Partition Archive
              </h3>
            </div>

            <p className="text-sm text-zinc-300 mb-4">
              You are about to archive{" "}
              <strong className="text-white">{selectedPartitions.size} partition(s)</strong>.
              They will be safely detached from live query execution and moved into the cold storage
              archive schema.
            </p>

            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 mb-5 space-y-1.5 text-xs text-zinc-400">
              <div className="flex justify-between">
                <span>Selected partitions:</span>
                <span className="font-semibold text-zinc-200">
                  {selectedPartitions.size}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Total records:</span>
                <span className="font-semibold text-zinc-200">
                  {selectedTotalRows.toLocaleString()} rows
                </span>
              </div>
              <div className="flex justify-between">
                <span>Active catalog space to free:</span>
                <span className="font-semibold text-amber-300">
                  {(selectedTotalBytes / (1024 * 1024)).toFixed(1)} MB
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowArchiveModal(false)}
                disabled={isProcessing}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBulkArchive}
                disabled={isProcessing}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {isProcessing && <Loader2 className="h-4 w-4 animate-spin" />}
                Archive Partitions
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal: Bulk Delete */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-3xl bg-zinc-900 border border-red-500/20 p-6 text-zinc-100 shadow-2xl">
            <div className="flex items-center gap-3 mb-4 text-red-400">
              <div className="p-2 rounded-xl bg-red-500/10 border border-red-500/20">
                <ShieldAlert className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold">
                Confirm Permanent Partition Deletion
              </h3>
            </div>

            <p className="text-sm text-zinc-300 mb-4">
              <span className="text-red-400 font-semibold">Warning:</span> You are about to permanently drop{" "}
              <strong className="text-white">{selectedPartitions.size} partition table(s)</strong> and all containing records from physical disk. This operation cannot be undone.
            </p>

            <div className="p-4 rounded-2xl bg-red-500/[0.05] border border-red-500/20 mb-5 space-y-1.5 text-xs text-zinc-400">
              <div className="flex justify-between">
                <span>Partitions to drop:</span>
                <span className="font-semibold text-zinc-200">
                  {selectedPartitions.size}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Total records destroyed:</span>
                <span className="font-semibold text-red-400">
                  {selectedTotalRows.toLocaleString()} rows
                </span>
              </div>
              <div className="flex justify-between">
                <span>Disk space reclaimed:</span>
                <span className="font-semibold text-emerald-400">
                  {(selectedTotalBytes / (1024 * 1024)).toFixed(1)} MB
                </span>
              </div>
            </div>

            <div className="mb-5">
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                Type <strong className="text-red-400">DELETE</strong> to confirm permanent destruction:
              </label>
              <input
                type="text"
                placeholder="DELETE"
                value={deleteConfirmInput}
                onChange={(e) => setDeleteConfirmInput(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-red-500/30 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-red-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteConfirmInput("");
                }}
                disabled={isProcessing}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={deleteConfirmInput !== "DELETE" || isProcessing}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isProcessing && <Loader2 className="h-4 w-4 animate-spin" />}
                Permanently Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default BulkVenuePartitionManager;
