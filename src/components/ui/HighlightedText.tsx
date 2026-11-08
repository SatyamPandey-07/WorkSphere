"use client";

import React from "react";

interface HighlightedTextProps {
  text: string;
  /** The search query to highlight. Matching substrings are wrapped in <mark>. */
  query: string;
  /** Additional className for the root span */
  className?: string;
  /** className for highlighted <mark> elements */
  highlightClassName?: string;
}

/**
 * Renders `text` with occurrences of `query` wrapped in `<mark>` for
 * keyboard-accessible, theme-aware search term highlighting.
 *
 * - Case-insensitive matching
 * - Preserves original casing in the output
 * - Returns plain text if query is empty/whitespace
 */
export function HighlightedText({
  text,
  query,
  className = "",
  highlightClassName = "bg-yellow-200 dark:bg-yellow-600/40 text-yellow-900 dark:text-yellow-100 rounded px-0.5",
}: HighlightedTextProps) {
  const trimmed = query.trim();

  if (!trimmed) {
    return <span className={className}>{text}</span>;
  }

  // Escape special regex characters in the query
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);

  return (
    <span className={className}>
      {parts.map((part, idx) =>
        regex.test(part) ? (
          <mark key={idx} className={highlightClassName}>
            {part}
          </mark>
        ) : (
          <React.Fragment key={idx}>{part}</React.Fragment>
        ),
      )}
    </span>
  );
}
