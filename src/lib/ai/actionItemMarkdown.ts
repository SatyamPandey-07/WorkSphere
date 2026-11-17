/**
 * Markdown export helpers for AI-synthesized meeting action items.
 * Output is a GitHub / Notion compatible task list:
 *   - [ ] **Title**: description (Assignee: @name, Due: YYYY-MM-DD)
 */

import type { ActionItem } from "@/core/agents/ActionItemSynthesizer";

export interface ExportableActionItem {
  title: string;
  description?: string | null;
  assignee?: string | null;
  dueDate?: string | Date | null;
  completed?: boolean;
}

/** Collapses newlines/extra whitespace so one item always stays on one line. */
function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Escapes characters that would break the bold title. */
function escapeTitle(value: string): string {
  return singleLine(value).replace(/\*/g, "\\*");
}

/** Returns YYYY-MM-DD, or null if the value is missing/invalid. */
export function formatDueDate(value?: string | Date | null): string | null {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Handles like "alice" or "@alice" become "@alice". Display names containing
 * spaces ("Alice Smith") are not valid @mentions, so they are kept as-is.
 */
export function formatAssignee(value?: string | null): string | null {
  if (!value) return null;
  const name = singleLine(value).replace(/^@+/, "");
  if (!name) return null;
  return /\s/.test(name) ? name : `@${name}`;
}

export function formatActionItemAsMarkdown(item: ExportableActionItem): string {
  const box = item.completed ? "[x]" : "[ ]";
  const title = escapeTitle(item.title || "Untitled action item");
  const description = item.description ? singleLine(item.description) : "";

  const meta: string[] = [];
  const assignee = formatAssignee(item.assignee);
  const due = formatDueDate(item.dueDate);
  if (assignee) meta.push(`Assignee: ${assignee}`);
  if (due) meta.push(`Due: ${due}`);

  let line = `- ${box} **${title}**`;
  if (description) line += `: ${description}`;
  if (meta.length > 0) line += ` (${meta.join(", ")})`;
  return line;
}

export function buildMarkdownChecklist(
  items: ExportableActionItem[],
  heading?: string,
): string {
  if (!items || items.length === 0) return "";
  const body = items.map(formatActionItemAsMarkdown).join("\n");
  return heading ? `## ${singleLine(heading)}\n\n${body}\n` : `${body}\n`;
}

const MAX_DESCRIPTION_LENGTH = 140;

/**
 * Maps a synthesizer ActionItem to the exportable shape:
 * - `task` becomes the title and `contextQuote` the (truncated) description
 * - the 'UNASSIGNED' sentinel becomes "no assignee"
 * - status COMPLETED becomes a checked box
 */
export function toExportableActionItem(item: ActionItem): ExportableActionItem {
  const assignee =
    item.assignee && item.assignee.trim().toUpperCase() !== "UNASSIGNED"
      ? item.assignee
      : null;
  const quote = item.contextQuote ? singleLine(item.contextQuote) : "";
  const description =
    quote.length > MAX_DESCRIPTION_LENGTH
      ? `${quote.slice(0, MAX_DESCRIPTION_LENGTH - 1).trimEnd()}…`
      : quote || null;

  return {
    title: item.task,
    description,
    assignee,
    dueDate: item.dueDate ?? null,
    completed: item.status === "COMPLETED",
  };
}
