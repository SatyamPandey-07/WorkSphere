"use client";

import React, { useState, useEffect, useCallback } from "react";
import { MetricsWidget } from "./MetricsWidget";
import {
  Loader2,
  ArrowRightLeft,
  GripVertical,
  ChevronLeft,
  ChevronRight,
  Wifi,
  VolumeX,
  Plug,
  Star,
  MapPin,
  Building2,
  Check,
  X,
} from "lucide-react";
import type { Venue } from "@/types/venue";

export interface ComparisonToolProps {
  currentFolder?: any; // The current folder object with venues
  venues?: Venue[]; // Direct list of venues to compare (up to 4)
  initialVenues?: Venue[];
  onOrderChange?: (venues: Venue[]) => void;
  className?: string;
  maxVenues?: number;
}

export function ComparisonTool({
  currentFolder,
  venues,
  initialVenues,
  onOrderChange,
  className = "",
  maxVenues = 4,
}: ComparisonToolProps) {
  // Extract initial venue list (up to 4) from props or currentFolder
  const extractVenues = useCallback((): Venue[] => {
    if (venues && venues.length > 0) return venues.slice(0, maxVenues);
    if (initialVenues && initialVenues.length > 0)
      return initialVenues.slice(0, maxVenues);
    if (currentFolder?.venues && Array.isArray(currentFolder.venues)) {
      return currentFolder.venues
        .map((item: any) => item.venue || item)
        .filter(Boolean)
        .slice(0, maxVenues);
    }
    return [];
  }, [venues, initialVenues, currentFolder, maxVenues]);

  // Local state preserving user column order
  const [orderedVenues, setOrderedVenues] = useState<Venue[]>(extractVenues);
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>("");
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Sync if venues prop changes and local state is empty
  useEffect(() => {
    const list = extractVenues();
    if (list.length > 0 && orderedVenues.length === 0) {
      setOrderedVenues(list);
    }
  }, [extractVenues, orderedVenues.length]);

  // Collection-level comparison state
  const [folders, setFolders] = useState<any[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [compareFolder, setCompareFolder] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!currentFolder?.id) return;
    async function fetchFolders() {
      try {
        const res = await fetch("/api/folders");
        const data = await res.json();
        if (data.folders) {
          setFolders(
            data.folders.filter((f: any) => f.id !== currentFolder.id),
          );
        }
      } catch (e) {
        console.error("Failed to fetch folders", e);
      }
    }
    fetchFolders();
  }, [currentFolder?.id]);

  useEffect(() => {
    if (!selectedFolderId) {
      setCompareFolder(null);
      return;
    }

    async function fetchCompareFolder() {
      setLoading(true);
      try {
        const res = await fetch(`/api/folders/${selectedFolderId}`);
        const data = await res.json();
        if (data.folder) {
          setCompareFolder(data.folder);
        }
      } catch (e) {
        console.error("Failed to fetch compare folder", e);
      } finally {
        setLoading(false);
      }
    }

    fetchCompareFolder();
  }, [selectedFolderId]);

  // Reordering helpers
  const reorderColumns = useCallback(
    (sourceIndex: number, targetIndex: number) => {
      if (
        sourceIndex === targetIndex ||
        sourceIndex < 0 ||
        targetIndex < 0 ||
        sourceIndex >= orderedVenues.length ||
        targetIndex >= orderedVenues.length
      ) {
        return;
      }

      const newOrder = [...orderedVenues];
      const [movedVenue] = newOrder.splice(sourceIndex, 1);
      newOrder.splice(targetIndex, 0, movedVenue);

      setOrderedVenues(newOrder);
      const msg = `Moved ${movedVenue.name} to position ${targetIndex + 1} of ${newOrder.length}.`;
      setLiveAnnouncement(msg);
      onOrderChange?.(newOrder);
    },
    [orderedVenues, onOrderChange],
  );

  const moveColumn = useCallback(
    (index: number, direction: "left" | "right") => {
      const targetIndex = direction === "left" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= orderedVenues.length) return;

      const newOrder = [...orderedVenues];
      const [movedVenue] = newOrder.splice(index, 1);
      newOrder.splice(targetIndex, 0, movedVenue);

      setOrderedVenues(newOrder);
      const msg = `Moved ${movedVenue.name} ${direction} to position ${targetIndex + 1} of ${newOrder.length}.`;
      setLiveAnnouncement(msg);
      onOrderChange?.(newOrder);
    },
    [orderedVenues, onOrderChange],
  );

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", index.toString());
    }
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    const dataIndex = e.dataTransfer
      ? e.dataTransfer.getData("text/plain")
      : "";
    const sourceIndex =
      draggedIndex !== null
        ? draggedIndex
        : dataIndex
          ? parseInt(dataIndex, 10)
          : NaN;

    if (!isNaN(sourceIndex)) {
      reorderColumns(sourceIndex, targetIndex);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // Keyboard navigation for reordering
  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      moveColumn(index, "left");
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      moveColumn(index, "right");
    }
  };

  return (
    <div
      data-testid="comparison-tool"
      className={`bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm mb-6 ${className}`}
    >
      {/* Screen reader live region for accessibility status announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="comparison-live-announcement"
      >
        {liveAnnouncement}
      </div>

      {/* Side-by-Side Venue Comparison Section */}
      {orderedVenues.length > 0 && (
        <div className="mb-8" data-testid="venue-comparison-section">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
                <Building2 className="w-5 h-5 text-indigo-500" />
                Side-by-Side Venue Comparison
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Compare up to {maxVenues} venues. Drag headers or use move
                buttons to reorder columns.
              </p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 self-start sm:self-auto">
              {orderedVenues.length} / {maxVenues} Venues
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table
              data-testid="venue-comparison-table"
              className="w-full text-left border-collapse"
            >
              <thead>
                <tr className="bg-zinc-50 dark:bg-zinc-950/60 border-b border-zinc-200 dark:border-zinc-800">
                  <th className="p-3.5 text-xs font-bold text-zinc-500 uppercase tracking-wider w-40 min-w-[140px] sticky left-0 bg-zinc-50 dark:bg-zinc-950/60 z-10">
                    Feature
                  </th>
                  {orderedVenues.map((venue, index) => {
                    const isDragging = draggedIndex === index;
                    const isOver = dragOverIndex === index;

                    return (
                      <th
                        key={venue.id}
                        data-testid={`venue-column-${venue.id}`}
                        data-column-index={index}
                        draggable={true}
                        onDragStart={(e) => {
                          if ((e.target as HTMLElement).closest("button")) {
                            e.preventDefault();
                            return;
                          }
                          handleDragStart(e, index);
                        }}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, index)}
                        className={`p-3.5 min-w-[210px] max-w-[260px] border-l border-zinc-200 dark:border-zinc-800 transition-colors ${
                          isOver
                            ? "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-400"
                            : ""
                        } ${isDragging ? "opacity-50" : "opacity-100"}`}
                      >
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center justify-between gap-1">
                            {/* Drag handle */}
                            <div
                              draggable={true}
                              onDragStart={(e) => handleDragStart(e, index)}
                              onDragEnd={handleDragEnd}
                              tabIndex={0}
                              role="button"
                              aria-label={`Drag to reorder ${venue.name}`}
                              onKeyDown={(e) => handleKeyDown(e, index)}
                              data-testid={`drag-handle-${venue.id}`}
                              className="cursor-grab active:cursor-grabbing p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                              title="Drag or use Arrow keys to reorder"
                            >
                              <GripVertical className="w-4 h-4" />
                            </div>

                            {/* Move Left / Right accessible buttons */}
                            <div className="flex items-center gap-0.5">
                              <button
                                type="button"
                                disabled={index === 0}
                                onClick={() => moveColumn(index, "left")}
                                aria-label={`Move ${venue.name} left`}
                                data-testid={`move-left-${venue.id}`}
                                className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors cursor-pointer"
                                title="Move left"
                              >
                                <ChevronLeft className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                disabled={index === orderedVenues.length - 1}
                                onClick={() => moveColumn(index, "right")}
                                aria-label={`Move ${venue.name} right`}
                                data-testid={`move-right-${venue.id}`}
                                className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors cursor-pointer"
                                title="Move right"
                              >
                                <ChevronRight className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          {/* Venue title */}
                          <div className="min-w-0">
                            <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
                              {venue.name}
                            </h4>
                            {venue.category && (
                              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase tracking-wider font-semibold">
                                {venue.category.replace(/_/g, " ")}
                              </span>
                            )}
                          </div>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
                {/* Rating */}
                <tr>
                  <td className="p-3 font-medium text-zinc-500 dark:text-zinc-400 sticky left-0 bg-white dark:bg-zinc-900 z-10">
                    Rating
                  </td>
                  {orderedVenues.map((venue) => (
                    <td
                      key={venue.id}
                      className="p-3 border-l border-zinc-200 dark:border-zinc-800"
                    >
                      <div className="flex items-center gap-1 font-semibold text-zinc-900 dark:text-zinc-100">
                        <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                        <span>{venue.rating ?? venue.score ?? "4.5"}</span>
                        {venue.reviewCount && (
                          <span className="text-xs text-zinc-400 font-normal">
                            ({venue.reviewCount})
                          </span>
                        )}
                      </div>
                    </td>
                  ))}
                </tr>

                {/* WiFi Speed & Quality */}
                <tr>
                  <td className="p-3 font-medium text-zinc-500 dark:text-zinc-400 sticky left-0 bg-white dark:bg-zinc-900 z-10">
                    WiFi
                  </td>
                  {orderedVenues.map((venue) => (
                    <td
                      key={venue.id}
                      className="p-3 border-l border-zinc-200 dark:border-zinc-800"
                    >
                      <div className="flex items-center gap-1.5 text-zinc-900 dark:text-zinc-100">
                        <Wifi className="w-4 h-4 text-blue-500 shrink-0" />
                        <span>
                          {venue.wifiSpeed
                            ? `${venue.wifiSpeed} Mbps`
                            : venue.wifiQuality
                              ? `${venue.wifiQuality} / 5`
                              : venue.wifi
                                ? "Available"
                                : "N/A"}
                        </span>
                      </div>
                    </td>
                  ))}
                </tr>

                {/* Noise Level */}
                <tr>
                  <td className="p-3 font-medium text-zinc-500 dark:text-zinc-400 sticky left-0 bg-white dark:bg-zinc-900 z-10">
                    Noise Level
                  </td>
                  {orderedVenues.map((venue) => (
                    <td
                      key={venue.id}
                      className="p-3 border-l border-zinc-200 dark:border-zinc-800"
                    >
                      <div className="flex items-center gap-1.5 capitalize text-zinc-900 dark:text-zinc-100">
                        <VolumeX className="w-4 h-4 text-purple-500 shrink-0" />
                        <span>{venue.noiseLevel || "Moderate"}</span>
                      </div>
                    </td>
                  ))}
                </tr>

                {/* Power Outlets */}
                <tr>
                  <td className="p-3 font-medium text-zinc-500 dark:text-zinc-400 sticky left-0 bg-white dark:bg-zinc-900 z-10">
                    Power Outlets
                  </td>
                  {orderedVenues.map((venue) => (
                    <td
                      key={venue.id}
                      className="p-3 border-l border-zinc-200 dark:border-zinc-800"
                    >
                      <div className="flex items-center gap-1.5 text-zinc-900 dark:text-zinc-100">
                        <Plug className="w-4 h-4 text-green-500 shrink-0" />
                        {venue.hasOutlets ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                            <Check className="w-3.5 h-3.5" />
                            {venue.outletDensity
                              ? venue.outletDensity.replace(/_/g, " ")
                              : "Available"}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-zinc-400">
                            <X className="w-3.5 h-3.5" /> None
                          </span>
                        )}
                      </div>
                    </td>
                  ))}
                </tr>

                {/* Address */}
                <tr>
                  <td className="p-3 font-medium text-zinc-500 dark:text-zinc-400 sticky left-0 bg-white dark:bg-zinc-900 z-10">
                    Location
                  </td>
                  {orderedVenues.map((venue) => (
                    <td
                      key={venue.id}
                      className="p-3 border-l border-zinc-200 dark:border-zinc-800"
                    >
                      <div className="flex items-start gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                        <MapPin className="w-3.5 h-3.5 text-zinc-400 shrink-0 mt-0.5" />
                        <span className="line-clamp-2">
                          {venue.address || "Address in details"}
                        </span>
                      </div>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Compare Collections Section (if currentFolder is supplied) */}
      {currentFolder && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-indigo-500" />
              Compare Collections
            </h3>

            <div className="flex items-center gap-3">
              <label
                htmlFor="compare-select"
                className="text-xs sm:text-sm font-medium text-zinc-600 dark:text-zinc-400"
              >
                Compare with:
              </label>
              <select
                id="compare-select"
                value={selectedFolderId}
                onChange={(e) => setSelectedFolderId(e.target.value)}
                className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm rounded-xl focus:ring-[var(--primary-accent)] focus:border-[var(--primary-accent)] block w-44 sm:w-48 p-2"
              >
                <option value="">Select a collection...</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative">
            <MetricsWidget
              venues={currentFolder.venues}
              title={currentFolder.name}
              isCompact
            />

            {loading ? (
              <div className="bg-zinc-50 dark:bg-zinc-950/50 border border-zinc-100 dark:border-zinc-800/50 rounded-2xl p-5 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
              </div>
            ) : compareFolder ? (
              <MetricsWidget
                venues={compareFolder.venues}
                title={compareFolder.name}
                isCompact
              />
            ) : (
              <div className="bg-zinc-50 dark:bg-zinc-950/50 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-2xl p-5 flex flex-col items-center justify-center text-zinc-400">
                <ArrowRightLeft className="w-8 h-8 mb-2 opacity-50" />
                <p className="text-sm">Select a collection above to compare</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ComparisonTool;
