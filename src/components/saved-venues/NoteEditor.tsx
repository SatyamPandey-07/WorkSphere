"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Save, Loader2, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";

const MAX_CHARS = 2000;
const AUTOSAVE_DELAY = 1500;

interface NoteEditorProps {
  initialNotes: string | null;
  onSave: (notes: string) => Promise<void>;
}

export function NoteEditor({ initialNotes, onSave }: NoteEditorProps) {
  const [notes, setNotes] = useState(initialNotes || "");
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const savingRef = useRef(false);
  const hasChanges = notes !== (initialNotes || "");

  const debouncedNotes = useDebounce(notes, AUTOSAVE_DELAY);

  useEffect(() => {
    setNotes(initialNotes || "");
  }, [initialNotes]);

  const performSave = useCallback(
    async (value: string) => {
      if (savingRef.current) return;
      savingRef.current = true;
      setIsSaving(true);
      setError(null);
      try {
        await onSave(value.trim() || "");
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save");
      } finally {
        setIsSaving(false);
        savingRef.current = false;
      }
    },
    [onSave],
  );

  useEffect(() => {
    if (!isEditing) return;
    const trimmed = debouncedNotes.trim();
    const initial = (initialNotes || "").trim();
    if (trimmed !== initial) {
      performSave(debouncedNotes);
    }
  }, [debouncedNotes, isEditing, initialNotes, performSave]);

  const autoResize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    if (isEditing) autoResize();
  }, [isEditing, notes, autoResize]);

  const handleSave = useCallback(async () => {
    if (!hasChanges || isSaving) return;
    await performSave(notes);
  }, [notes, hasChanges, isSaving, performSave]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div className="w-full" onKeyDown={handleKeyDown}>
      {!isEditing && !notes ? (
        <button
          type="button"
          onClick={() => {
            setIsEditing(true);
            setTimeout(() => textareaRef.current?.focus(), 50);
          }}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 text-zinc-400 dark:text-zinc-500 hover:accent-border accent-text-hover transition-colors text-sm text-left"
          aria-label="Add a private note"
        >
          <FileText className="w-4 h-4 shrink-0" />
          <span>Add a private note...</span>
        </button>
      ) : isEditing ? (
        <div className="space-y-2">
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={notes}
              onChange={(e) => {
                if (e.target.value.length <= MAX_CHARS) {
                  setNotes(e.target.value);
                }
                autoResize();
              }}
              placeholder="Write your private notes here..."
              rows={2}
              className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl text-sm outline-none focus:border-[var(--primary-accent)] transition-colors text-zinc-900 dark:text-white placeholder:text-zinc-400 resize-none"
              aria-label="Private notes"
              aria-describedby="notes-char-count"
              autoFocus
            />
          </div>

          <div className="flex items-center justify-between">
            <span
              id="notes-char-count"
              className={cn(
                "text-xs",
                notes.length > MAX_CHARS * 0.9
                  ? "text-amber-500"
                  : "text-zinc-400 dark:text-zinc-500",
              )}
            >
              {notes.length}/{MAX_CHARS}
            </span>

            <div className="flex items-center gap-2">
              {saved && (
                <span
                  className="text-xs text-green-600 dark:text-green-400"
                  role="status"
                >
                  Saved!
                </span>
              )}
              {error && (
                <span
                  className="text-xs text-red-600 dark:text-red-400"
                  role="alert"
                >
                  {error}
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setIsEditing(false);
                  setNotes(initialNotes || "");
                  setError(null);
                }}
                className="px-3 py-1 text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!hasChanges || isSaving}
                className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium accent-bg accent-bg-hover text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                aria-label="Save notes"
              >
                {isSaving ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Save className="w-3 h-3" />
                )}
                Save
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setIsEditing(true);
            setTimeout(() => textareaRef.current?.focus(), 50);
          }}
          className="w-full text-left px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:accent-border-50 transition-colors group"
          aria-label="Edit note"
        >
          <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap line-clamp-3">
            {notes}
          </p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
            Click to edit
          </p>
        </button>
      )}
    </div>
  );
}
