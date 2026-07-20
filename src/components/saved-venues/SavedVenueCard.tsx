"use client";

import { memo, useState, useCallback } from "react";
import {
  MapPin,
  Star,
  Wifi,
  Plug,
  Trash2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TagChip } from "./TagChip";
import { TagInput } from "./TagInput";
import { NoteEditor } from "./NoteEditor";
import type { SavedVenue, FavoriteTag } from "@/hooks/useSavedVenues";

interface SavedVenueCardProps {
  favorite: SavedVenue;
  onUpdateNotes: (favoriteId: string, notes: string) => Promise<void>;
  onAddTag: (
    favoriteId: string,
    name: string,
    color: string,
  ) => Promise<FavoriteTag>;
  onUpdateTag: (
    favoriteId: string,
    tagId: string,
    data: { name?: string; color?: string },
  ) => Promise<void>;
  onDeleteTag: (favoriteId: string, tagId: string) => Promise<void>;
  onRemoveFavorite: (venueId: string) => Promise<void>;
}

export const SavedVenueCard = memo(function SavedVenueCard({
  favorite,
  onUpdateNotes,
  onAddTag,
  onUpdateTag,
  onDeleteTag,
  onRemoveFavorite,
}: SavedVenueCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingTagName, setEditingTagName] = useState("");
  const { venue, tags } = favorite;

  const handleRemove = useCallback(async () => {
    if (isRemoving) return;
    setIsRemoving(true);
    try {
      await onRemoveFavorite(venue.placeId || venue.id);
    } catch {
      setIsRemoving(false);
    }
  }, [isRemoving, venue, onRemoveFavorite]);

  const handleAddTag = useCallback(
    async (name: string, color: string) => {
      await onAddTag(favorite.id, name, color);
    },
    [favorite.id, onAddTag],
  );

  const handleRenameTag = useCallback((tag: FavoriteTag) => {
    setEditingTagId(tag.id);
    setEditingTagName(tag.name);
  }, []);

  const handleSaveRename = useCallback(async () => {
    if (!editingTagId || !editingTagName.trim()) {
      setEditingTagId(null);
      return;
    }
    try {
      await onUpdateTag(favorite.id, editingTagId, {
        name: editingTagName.trim(),
      });
    } catch {
      // Error handled by hook
    }
    setEditingTagId(null);
  }, [editingTagId, editingTagName, favorite.id, onUpdateTag]);

  const categoryColor =
    venue.category === "cafe"
      ? "text-amber-600"
      : venue.category === "coworking"
        ? "text-blue-600"
        : "text-green-600";

  return (
    <article
      className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden hover:accent-border-30 hover:shadow-lg hover:accent-shadow-sm transition-all"
      aria-label={`Saved venue: ${venue.name}`}
    >
      {/* Card Header */}
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-zinc-900 dark:text-white truncate">
              {venue.name}
            </h3>
            {venue.address && (
              <p className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400 mt-1 truncate">
                <MapPin className="w-3 h-3 shrink-0" />
                {venue.address}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleRemove}
            disabled={isRemoving}
            className="shrink-0 p-2 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900"
            aria-label={`Remove ${venue.name} from saved venues`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {/* Venue meta */}
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          <span
            className={cn(
              "text-xs font-semibold uppercase tracking-wider",
              categoryColor,
            )}
          >
            {venue.category}
          </span>
          {venue.rating && (
            <span className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
              <Star className="w-3 h-3 fill-current text-amber-500" />
              {venue.rating.toFixed(1)}
            </span>
          )}
          {venue.wifiQuality && (
            <span className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
              <Wifi className="w-3 h-3" />
              {venue.wifiQuality}/5
            </span>
          )}
          {venue.hasOutlets && (
            <span className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
              <Plug className="w-3 h-3" />
              Outlets
            </span>
          )}
          {venue.noiseLevel && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400 capitalize">
              {venue.noiseLevel}
            </span>
          )}
        </div>

        {/* Tags */}
        <div className="flex flex-wrap items-center gap-1.5 mt-3 min-h-[28px]">
          {tags.map((tag) =>
            editingTagId === tag.id ? (
              <input
                key={tag.id}
                type="text"
                value={editingTagName}
                onChange={(e) => setEditingTagName(e.target.value)}
                onBlur={handleSaveRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveRename();
                  if (e.key === "Escape") setEditingTagId(null);
                }}
                className="px-2 py-0.5 text-sm rounded-full border accent-border bg-white dark:bg-zinc-900 outline-none text-zinc-900 dark:text-white focus:ring-2 focus:ring-[var(--primary-accent)] focus:ring-offset-1 dark:focus:ring-offset-zinc-900"
                autoFocus
                aria-label={`Rename tag ${tag.name}`}
              />
            ) : (
              <TagChip
                key={tag.id}
                name={tag.name}
                color={tag.color}
                size="sm"
                onDelete={() => onDeleteTag(favorite.id, tag.id)}
                onRename={() => handleRenameTag(tag)}
              />
            ),
          )}
          <TagInput
            onAdd={handleAddTag}
            existingNames={tags.map((t) => t.name)}
          />
        </div>

        {/* Notes preview / expand */}
        {favorite.notes && !isExpanded && (
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="w-full mt-3 text-left px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800/50 text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap line-clamp-2 hover:accent-border-30 transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--primary-accent)] focus:ring-offset-2 dark:focus:ring-offset-zinc-900"
            aria-label="Show note"
          >
            {favorite.notes}
          </button>
        )}
      </div>

      {/* Expandable section */}
      <div className="px-4 sm:px-5 pb-4 sm:pb-5">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-center gap-1 py-1.5 text-xs text-zinc-400 accent-text-hover transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--primary-accent)] focus:ring-offset-2 dark:focus:ring-offset-zinc-900 rounded-lg"
          aria-expanded={isExpanded}
          aria-label={isExpanded ? "Show less" : "Show more"}
        >
          {isExpanded ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              Show more
            </>
          )}
        </button>

        {isExpanded && (
          <div className="mt-3 space-y-4">
            <div>
              <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                Private Notes
              </h4>
              <NoteEditor
                initialNotes={favorite.notes}
                onSave={(notes) => onUpdateNotes(favorite.id, notes)}
              />
            </div>
          </div>
        )}
      </div>
    </article>
  );
});
