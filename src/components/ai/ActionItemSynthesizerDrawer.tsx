"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCopy,
  Download,
  ListChecks,
  X,
} from "lucide-react";
import type { SynthesisReport } from "@/core/agents/ActionItemSynthesizer";
import {
  buildMarkdownChecklist,
  toExportableActionItem,
} from "@/lib/ai/actionItemMarkdown";
import { cn } from "@/lib/utils";

export interface ActionItemSynthesizerDrawerProps {
  report: SynthesisReport;
  className?: string;
}

interface ToastState {
  type: "success" | "error";
  message: string;
}

const TOAST_DURATION_MS = 3000;

function toFileName(meetingId: string): string {
  const safe = (meetingId || "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe ? `action-items-${safe}.md` : "action-items.md";
}

export function ActionItemSynthesizerDrawer({
  report,
  className = "",
}: ActionItemSynthesizerDrawerProps) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  const showToast = useCallback((next: ToastState) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast(next);
    toastTimeoutRef.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }, []);

  const items = [...report.assignedItems, ...report.unassignedItems];
  const hasItems = items.length > 0;
  const exportable = items.map(toExportableActionItem);

  const handleCopyMarkdown = async () => {
    if (!hasItems) return;
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(buildMarkdownChecklist(exportable));
      showToast({ type: "success", message: "Markdown checklist copied to clipboard" });
    } catch {
      showToast({ type: "error", message: "Couldn't copy. Please try again." });
    }
  };

  const handleExportMarkdown = () => {
    if (!hasItems) return;
    try {
      const markdown = buildMarkdownChecklist(exportable, report.title || "Action Items");
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = toFileName(report.meetingId);
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      showToast({ type: "success", message: "Exported action-items markdown file" });
    } catch {
      showToast({ type: "error", message: "Couldn't export the file." });
    }
  };

  return (
    <div
      data-testid="action-item-drawer"
      className={cn(
        "rounded-3xl p-5 bg-zinc-900/90 border border-zinc-800 text-zinc-100 shadow-xl space-y-4",
        className
      )}
    >
      {toast && (
        <div
          role="status"
          data-testid="action-item-toast"
          className={cn(
            "p-3 rounded-2xl text-xs font-bold flex items-center justify-between shadow-lg animate-in fade-in slide-in-from-top-2 duration-300",
            toast.type === "success"
              ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white"
              : "bg-red-600/90 text-white"
          )}
        >
          <div className="flex items-center gap-2">
            {toast.type === "success" ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <AlertCircle className="w-4 h-4" />
            )}
            <span data-testid="action-item-toast-text">{toast.message}</span>
          </div>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
            className="p-1 rounded-lg bg-black/20 hover:bg-black/30 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400">
            <ListChecks className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-sm font-black text-white">
              {report.title || "Meeting Action Items"}
            </h4>
            <p className="text-[11px] text-zinc-400">
              Export as a GitHub / Notion compatible task list.
            </p>
          </div>
        </div>
        <span
          data-testid="action-item-count-badge"
          className="text-xs px-2.5 py-1 rounded-full bg-zinc-800 text-zinc-300 font-bold"
        >
          {items.length} {items.length === 1 ? "item" : "items"}
        </span>
      </div>

      {hasItems ? (
        <ul className="space-y-2" data-testid="action-item-list">
          {items.map((item) => (
            <li
              key={item.id}
              className="p-3 rounded-2xl bg-zinc-950/60 border border-zinc-800/80 text-xs"
            >
              <div className="font-bold text-white">{item.task}</div>
              <div className="text-[10px] text-zinc-400 mt-0.5">
                {item.assignee && item.assignee !== "UNASSIGNED" ? item.assignee : "Unassigned"}
                {item.dueDate ? ` · Due ${item.dueDate}` : ""}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p data-testid="action-item-empty" className="text-xs text-zinc-400">
          No action items were found in this meeting.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-zinc-800/60">
        <button
          type="button"
          data-testid="action-item-copy-markdown"
          onClick={handleCopyMarkdown}
          disabled={!hasItems}
          className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ClipboardCopy className="w-3.5 h-3.5" />
          Copy Markdown Checklist
        </button>
        <button
          type="button"
          data-testid="action-item-export-markdown"
          onClick={handleExportMarkdown}
          disabled={!hasItems}
          className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="w-3.5 h-3.5" />
          Export .md
        </button>
      </div>
    </div>
  );
}

export default ActionItemSynthesizerDrawer;
