"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import { Search, X, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FavoriteTag } from "@/hooks/useSavedVenues";

export interface TagFilterProps {
  allTags?: FavoriteTag[];
  selectedTagIds?: string[];
  onToggleTag: (tagId: string) => void;
  onClear: () => void;
  onFilterChange?: (query: string) => void;
  className?: string;
}

export function TagFilter({
  allTags,
  selectedTagIds,
  onToggleTag,
  onClear,
  onFilterChange,
  className,
}: TagFilterProps) {
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const safeAllTags = useMemo(
    () => (Array.isArray(allTags) ? allTags : []),
    [allTags],
  );
  const safeSelectedTagIds = useMemo(
    () => (Array.isArray(selectedTagIds) ? selectedTagIds : []),
    [selectedTagIds],
  );

  const uniqueTags = useMemo(() => {
    const seen = new Map<string, FavoriteTag>();
    for (const tag of safeAllTags) {
      if (!tag || typeof tag.name !== "string" || !tag.id) continue;
      const key = tag.name.toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, tag);
      }
    }
    return Array.from(seen.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [safeAllTags]);

  const filteredTags = useMemo(
    () =>
      uniqueTags.filter((tag) =>
        tag.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [uniqueTags, search],
  );

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen]);

  if (uniqueTags.length === 0) return null;

  return (
    <div
      ref={containerRef}
      data-testid="tag-filter-container"
      className={cn("relative", className)}
    >
      <button
        type="button"
        data-testid="tag-filter-button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-accent)] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950",
          safeSelectedTagIds.length > 0
            ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
            : "border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:border-blue-500/50",
        )}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={`Filter by tags${safeSelectedTagIds.length > 0 ? ` (${safeSelectedTagIds.length} active)` : ""}`}
      >
        <Filter className="w-4 h-4" />
        <span>Tags</span>
        {safeSelectedTagIds.length > 0 && (
          <span
            data-testid="tag-filter-count-badge"
            className="px-1.5 py-0.5 text-xs bg-blue-600 text-white rounded-full"
          >
            {safeSelectedTagIds.length}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          data-testid="tag-filter-dropdown"
          className="absolute top-full left-0 mt-2 w-64 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl z-50 p-2"
          role="listbox"
          aria-label="Available tags"
        >
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
            <input
              ref={inputRef}
              data-testid="tag-filter-search-input"
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                onFilterChange?.(e.target.value);
              }}
              placeholder="Search tags..."
              className="w-full pl-8 pr-8 py-1.5 bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs outline-none focus:border-[var(--primary-accent)] focus:ring-2 focus:ring-[var(--primary-accent)] focus:ring-offset-1 dark:focus:ring-offset-zinc-900 text-zinc-900 dark:white placeholder:text-zinc-400"
              aria-label="Search tags"
              autoFocus
            />
            {search && (
              <button
                type="button"
                data-testid="tag-filter-search-clear"
                onClick={() => {
                  setSearch("");
                  onFilterChange?.("");
                  inputRef.current?.focus();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-accent)]"
                aria-label="Clear tag filter"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {filteredTags.map((tag) => {
              const isActive = safeSelectedTagIds.includes(tag.id);
              const tagColor = tag.color || "#3b82f6";
              return (
                <button
                  key={tag.id}
                  data-testid={`tag-filter-option-${tag.id}`}
                  type="button"
                  onClick={() => onToggleTag(tag.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-accent)] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-zinc-900",
                    isActive
                      ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                      : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800",
                  )}
                  role="option"
                  aria-selected={isActive}
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: tagColor }}
                    aria-hidden="true"
                  />
                  <span className="truncate flex-1">{tag.name}</span>
                  {isActive && (
                    <svg
                      data-testid={`tag-filter-check-${tag.id}`}
                      className="w-3.5 h-3.5 text-blue-500 shrink-0"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M3 8l3 3 7-7"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              );
            })}
            {filteredTags.length === 0 && (
              <p
                data-testid="tag-filter-empty"
                className="text-xs text-zinc-400 text-center py-2"
              >
                No tags found
              </p>
            )}
          </div>

          {safeSelectedTagIds.length > 0 && (
            <button
              type="button"
              data-testid="tag-filter-clear-all"
              onClick={onClear}
              className="w-full mt-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-accent)] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-zinc-900"
            >
              <X className="w-3 h-3" />
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Active filter badges */}
      {safeSelectedTagIds.length > 0 && (
        <div
          data-testid="tag-filter-active-chips"
          className="flex flex-wrap gap-1.5 mt-2"
        >
          {uniqueTags
            .filter((t) => safeSelectedTagIds.includes(t.id))
            .map((tag) => {
              const tagColor = tag.color || "#3b82f6";
              return (
                <span
                  key={tag.id}
                  data-testid={`active-tag-chip-${tag.id}`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                  style={{
                    backgroundColor: `${tagColor}20`,
                    color: tagColor,
                  }}
                >
                  {tag.name}
                  <button
                    type="button"
                    data-testid={`remove-active-tag-${tag.id}`}
                    onClick={() => onToggleTag(tag.id)}
                    className="ml-0.5 hover:bg-black/10 dark:hover:bg-white/20 rounded-full p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-accent)] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-zinc-900"
                    aria-label={`Remove filter: ${tag.name}`}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              );
            })}
        </div>
      )}
    </div>
  );
}

export default TagFilter;
