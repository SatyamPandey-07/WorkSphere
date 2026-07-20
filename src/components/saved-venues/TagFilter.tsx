"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Search, X, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FavoriteTag } from "@/hooks/useSavedVenues";

interface TagFilterProps {
  allTags: FavoriteTag[];
  selectedTagIds: string[];
  onToggleTag: (tagId: string) => void;
  onClear: () => void;
}

export function TagFilter({
  allTags,
  selectedTagIds,
  onToggleTag,
  onClear,
}: TagFilterProps) {
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const uniqueTags = useMemo(() => {
    const seen = new Map<string, FavoriteTag>();
    for (const tag of allTags) {
      const key = tag.name.toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, tag);
      }
    }
    return Array.from(seen.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [allTags]);

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

  if (uniqueTags.length === 0) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-accent)] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950",
          selectedTagIds.length > 0
            ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
            : "border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:border-blue-500/50",
        )}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={`Filter by tags${selectedTagIds.length > 0 ? ` (${selectedTagIds.length} active)` : ""}`}
      >
        <Filter className="w-4 h-4" />
        <span>Tags</span>
        {selectedTagIds.length > 0 && (
          <span className="px-1.5 py-0.5 text-xs bg-blue-600 text-white rounded-full">
            {selectedTagIds.length}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="absolute top-full left-0 mt-2 w-64 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl z-50 p-2"
          role="listbox"
          aria-label="Available tags"
        >
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tags..."
              className="w-full pl-8 pr-3 py-1.5 bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs outline-none focus:border-[var(--primary-accent)] focus:ring-2 focus:ring-[var(--primary-accent)] focus:ring-offset-1 dark:focus:ring-offset-zinc-900 text-zinc-900 dark:text-white placeholder:text-zinc-400"
              aria-label="Search tags"
              autoFocus
            />
          </div>

          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {filteredTags.map((tag) => {
              const isActive = selectedTagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
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
                    style={{ backgroundColor: tag.color }}
                    aria-hidden="true"
                  />
                  <span className="truncate flex-1">{tag.name}</span>
                  {isActive && (
                    <svg
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
              <p className="text-xs text-zinc-400 text-center py-2">
                No tags found
              </p>
            )}
          </div>

          {selectedTagIds.length > 0 && (
            <button
              type="button"
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
      {selectedTagIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {uniqueTags
            .filter((t) => selectedTagIds.includes(t.id))
            .map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                style={{
                  backgroundColor: `${tag.color}20`,
                  color: tag.color,
                }}
              >
                {tag.name}
                <button
                  type="button"
                  onClick={() => onToggleTag(tag.id)}
                  className="ml-0.5 hover:bg-black/10 dark:hover:bg-white/20 rounded-full p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-accent)] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-zinc-900"
                  aria-label={`Remove filter: ${tag.name}`}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
