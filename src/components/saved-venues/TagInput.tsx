"use client";

import { useState, useRef, useCallback } from "react";
import { Plus, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const TAG_COLORS = [
  { name: "Blue", value: "#3b82f6" },
  { name: "Green", value: "#22c55e" },
  { name: "Orange", value: "#f97316" },
  { name: "Purple", value: "#a855f7" },
  { name: "Red", value: "#ef4444" },
  { name: "Teal", value: "#14b8a6" },
  { name: "Pink", value: "#ec4899" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Indigo", value: "#6366f1" },
  { name: "Rose", value: "#f43f5e" },
];

interface TagInputProps {
  onAdd: (name: string, color: string) => Promise<void>;
  existingNames?: string[];
}

export function TagInput({ onAdd, existingNames = [] }: TagInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [selectedColor, setSelectedColor] = useState(TAG_COLORS[0].value);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const duplicate = existingNames.some(
    (n) => n.toLowerCase() === name.trim().toLowerCase(),
  );

  const handleSubmit = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || duplicate || isSubmitting) return;

    setError(null);
    setIsSubmitting(true);
    try {
      await onAdd(trimmed, selectedColor);
      setName("");
      setSelectedColor(TAG_COLORS[0].value);
      setIsOpen(false);
      triggerRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add tag");
    } finally {
      setIsSubmitting(false);
    }
  }, [name, selectedColor, duplicate, isSubmitting, onAdd]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setIsOpen(false);
      setError(null);
      triggerRef.current?.focus();
    }
  };

  if (!isOpen) {
    return (
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setIsOpen(true);
          setTimeout(() => nameInputRef.current?.focus(), 50);
        }}
        className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:accent-border accent-text-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-accent)] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900"
        aria-label="Add new tag"
      >
        <Plus className="w-3.5 h-3.5" />
        <span>Add Tag</span>
      </button>
    );
  }

  return (
    <div
      className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 shadow-lg"
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-label="Add tag"
    >
      <div className="flex items-center gap-2 mb-2">
        <input
          ref={nameInputRef}
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder="Tag name..."
          maxLength={50}
          className="flex-1 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm outline-none focus:border-[var(--primary-accent)] focus:ring-2 focus:ring-[var(--primary-accent)] focus:ring-offset-1 dark:focus:ring-offset-zinc-900 transition-colors text-zinc-900 dark:text-white placeholder:text-zinc-400"
          aria-label="Tag name"
          aria-invalid={duplicate || !!error}
          aria-describedby={
            duplicate ? "tag-duplicate-error" : error ? "tag-error" : undefined
          }
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!name.trim() || duplicate || isSubmitting}
          className="shrink-0 p-1.5 rounded-lg accent-bg accent-bg-hover text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-accent)] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900"
          aria-label="Confirm add tag"
        >
          {isSubmitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Check className="w-4 h-4" />
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setIsOpen(false);
            setName("");
            setError(null);
          }}
          className="shrink-0 p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-accent)] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900"
          aria-label="Cancel"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M10.5 3.5L3.5 10.5M3.5 3.5l7 7"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {duplicate && (
        <p
          id="tag-duplicate-error"
          className="text-xs text-amber-600 dark:text-amber-400 mb-2"
          role="alert"
        >
          Tag already exists
        </p>
      )}
      {error && !duplicate && (
        <p
          id="tag-error"
          className="text-xs text-red-600 dark:text-red-400 mb-2"
          role="alert"
        >
          {error}
        </p>
      )}

      <div
        className="flex flex-wrap gap-1.5"
        role="radiogroup"
        aria-label="Tag color"
      >
        {TAG_COLORS.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setSelectedColor(c.value)}
            className={cn(
              "w-6 h-6 rounded-full transition-all flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-accent)] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900",
              selectedColor === c.value
                ? "ring-2 ring-offset-2 ring-offset-white dark:ring-offset-zinc-900 scale-110"
                : "hover:scale-110",
            )}
            style={{
              backgroundColor: c.value,
              ...(selectedColor === c.value ? { ringColor: c.value } : {}),
            }}
            role="radio"
            aria-checked={selectedColor === c.value}
            aria-label={`${c.name} color`}
          />
        ))}
      </div>
    </div>
  );
}
