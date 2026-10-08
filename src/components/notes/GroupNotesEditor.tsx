"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as Y from "yjs";
import YPartyKitProvider from "y-partykit/provider";
import { Bold, Italic, Loader2, Trash2, Underline, Wifi, WifiOff, FileDown } from "lucide-react";
import { applyYTextDiff } from "@/lib/crdt/applyYTextDiff";
import {
  enqueueNotesUpdate,
  flushNotesOutbox,
  loadNotesDocState,
  saveNotesDocState,
  resolveConflictsKeepLocal,
  resolveConflictsUseRemote,
  type NotesOutboxConflict,
} from "@/lib/crdt/notesOutbox";
import { useToast } from "@/components/ui/Toast";

export type GroupNotesEditorProps = {
  /** PartyKit room id (e.g. venue or coworking group id) */
  roomId: string;
  placeholder?: string;
  /** Shared Y.Text key inside the document */
  textKey?: string;
  venueName?: string;
};

type ConnStatus = "connecting" | "connected" | "offline";

/**
 * Offline-first CRDT group notes editor (#1023).
 * Y.Text ↔ contenteditable, IndexedDB outbox, PartyKit sync.
 */
export function GroupNotesEditor({
  roomId,
  placeholder = "Start writing group notes…",
  textKey = "group-notes",
  venueName,
}: GroupNotesEditorProps) {
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [pendingOutbox, setPendingOutbox] = useState(0);
  const [conflicts, setConflicts] = useState<NotesOutboxConflict[] | null>(
    null,
  );
  const [editorText, setEditorText] = useState("");

  const { toast } = useToast();

  const editorRef = useRef<HTMLDivElement>(null);
  const yDocRef = useRef<Y.Doc | null>(null);
  const yTextRef = useRef<Y.Text | null>(null);
  const providerRef = useRef<YPartyKitProvider | null>(null);
  const applyingRemoteRef = useRef(false);

  const syncEditorFromYText = useCallback(() => {
    const editor = editorRef.current;
    const ytext = yTextRef.current;
    if (!editor || !ytext) return;
    const next = ytext.toString();
    if (editor.innerText !== next) {
      applyingRemoteRef.current = true;
      editor.innerText = next;
      applyingRemoteRef.current = false;
    }
    setEditorText(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const ydoc = new Y.Doc();
    yDocRef.current = ydoc;
    const ytext = ydoc.getText(textKey);
    yTextRef.current = ytext;

    const host = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999";
    const provider = new YPartyKitProvider(host, `notes-${roomId}`, ydoc);
    providerRef.current = provider;

    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (
        origin === "remote" ||
        origin === "outbox-flush" ||
        origin === "idb-load"
      ) {
        return;
      }
      void (async () => {
        await saveNotesDocState(roomId, ydoc);
        const online =
          typeof navigator !== "undefined" ? navigator.onLine : true;
        const wsOpen = provider.ws?.readyState === WebSocket.OPEN;
        if (!online || !wsOpen) {
          await enqueueNotesUpdate(roomId, update);
          setPendingOutbox((n) => n + 1);
        }
      })();
    };
    ydoc.on("update", onUpdate);

    const observer = () => {
      if (!applyingRemoteRef.current) syncEditorFromYText();
    };
    ytext.observe(observer);

    const handleFlushResult = (result: {
      flushed: number;
      conflicts: NotesOutboxConflict[];
    }) => {
      if (result.flushed > 0 || result.conflicts.length > 0)
        setPendingOutbox(0);
      syncEditorFromYText();
      if (result.conflicts.length > 0) {
        setConflicts(result.conflicts);
        toast(
          `Your offline edits were merged with remote changes (${result.conflicts.length} conflict${result.conflicts.length > 1 ? "s" : ""}).`,
          "warning",
          { label: "Review", onClick: () => setConflicts(result.conflicts) },
        );
      } else if (result.flushed > 0) {
        toast("Your offline edits have been synced.", "success");
      }
    };

    const onStatus = (event: { status: string }) => {
      if (event.status === "connected") {
        setStatus("connected");
        void flushNotesOutbox(roomId, ydoc).then(handleFlushResult);
      } else if (event.status === "disconnected") {
        setStatus("offline");
      } else {
        setStatus("connecting");
      }
    };
    provider.on("status", onStatus);

    const onSync = (synced: boolean) => {
      if (!synced || cancelled) return;
      void flushNotesOutbox(roomId, ydoc).then(handleFlushResult);
    };
    provider.on("sync", onSync);

    void (async () => {
      const saved = await loadNotesDocState(roomId);
      if (cancelled) return;
      if (saved) {
        Y.applyUpdate(ydoc, saved, "idb-load");
        syncEditorFromYText();
      }
    })();

    return () => {
      cancelled = true;
      ytext.unobserve(observer);
      ydoc.off("update", onUpdate);
      provider.off("status", onStatus);
      provider.off("sync", onSync);
      // provider.destroy() closes the underlying WebSocket and removes all
      // internal Yjs bindings — more thorough than disconnect() alone, which
      // only stops reconnection without guaranteed socket closure.
      provider.destroy();
      ydoc.destroy();
      yDocRef.current = null;
      yTextRef.current = null;
      providerRef.current = null;
    };
  }, [roomId, syncEditorFromYText, textKey, toast]);

  const handleInput = () => {
    if (applyingRemoteRef.current) return;
    const editor = editorRef.current;
    const ytext = yTextRef.current;
    if (!editor || !ytext) return;
    setEditorText(editor.innerText);
    applyYTextDiff(ytext, editor.innerText);
  };

  const execFormat = (command: "bold" | "italic" | "underline") => {
    editorRef.current?.focus();
    document.execCommand(command);
    handleInput();
  };

  const handleResolveConflicts = useCallback(
    async (keepLocal: boolean) => {
      if (!conflicts || conflicts.length === 0) return;
      const ydoc = yDocRef.current;
      if (!ydoc) return;

      if (keepLocal) {
        await resolveConflictsKeepLocal(roomId, ydoc, conflicts);
        toast("Your local changes have been kept.", "success");
      } else {
        await resolveConflictsUseRemote(roomId, conflicts);
        toast(
          "Remote changes were kept. Your offline edits were discarded.",
          "warning",
        );
      }
      syncEditorFromYText();
      setConflicts(null);
    },
    [conflicts, roomId, syncEditorFromYText, toast],
  );

  const lastDeletedTextRef = useRef<string | null>(null);

  const handleDeleteNotes = useCallback(() => {
    const ytext = yTextRef.current;
    const editor = editorRef.current;
    if (!ytext || !editor) return;
    const previousText = ytext.toString() || editor.innerText;
    if (!previousText.trim()) return;

    lastDeletedTextRef.current = previousText;
    applyYTextDiff(ytext, "");
    editor.innerText = "";
    setEditorText("");

    toast("Group notes deleted", "info", {
      label: "Undo",
      onClick: () => {
        if (lastDeletedTextRef.current !== null) {
          const restored = lastDeletedTextRef.current;
          applyYTextDiff(ytext, restored);
          editor.innerText = restored;
          setEditorText(restored);
          lastDeletedTextRef.current = null;
          toast("Notes restored", "success");
        }
      },
    });
  }, [toast]);

  const handleExportMarkdown = useCallback(() => {
    const ytext = yTextRef.current;
    const editor = editorRef.current;
    const content = ytext?.toString() || editor?.innerText || "";

    if (!content.trim()) {
      toast("No notes to export yet", "warning");
      return;
    }

    const title = venueName || "Venue Notes";
    const dateStr = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const markdownDoc = [
      `# ${title}`,
      `> Exported from WorkSphere Collaborative Notes on ${dateStr}`,
      `> Room ID: \`${roomId}\``,
      "",
      "---",
      "",
      content,
      "",
    ].join("\n");

    const blob = new Blob([markdownDoc], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const sanitizedTitle = (venueName || roomId)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    link.href = url;
    link.download = `${sanitizedTitle || "venue"}-notes-${new Date().toISOString().split("T")[0]}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast("Exported venue notes as Markdown (.md) file", "success");
  }, [roomId, toast, venueName]);

  const trimmedEditorText = editorText.trim();
  const wordCount = trimmedEditorText ? trimmedEditorText.split(/\s+/).length : 0;
  const charCount = editorText.length;

  return (
    <div className="flex w-full flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-100 pb-3 dark:border-zinc-800">
        <h3 className="text-sm font-black uppercase tracking-widest text-zinc-800 dark:text-zinc-200">
          Group Notes
        </h3>
        <div className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 dark:border-zinc-800 dark:bg-zinc-900">
          {status === "connecting" && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
          )}
          {status === "connected" && (
            <Wifi className="h-3.5 w-3.5 text-green-500" />
          )}
          {status === "offline" && (
            <WifiOff className="h-3.5 w-3.5 text-orange-500" />
          )}
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            {status}
            {pendingOutbox > 0 ? ` · ${pendingOutbox} queued` : ""}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <FormatButton label="Bold" onClick={() => execFormat("bold")}>
            <Bold className="h-3.5 w-3.5" />
          </FormatButton>
          <FormatButton label="Italic" onClick={() => execFormat("italic")}>
            <Italic className="h-3.5 w-3.5" />
          </FormatButton>
          <FormatButton label="Underline" onClick={() => execFormat("underline")}>
            <Underline className="h-3.5 w-3.5" />
          </FormatButton>
        </div>
        <div className="flex items-center gap-1">
          <FormatButton label="Export Markdown (.md)" onClick={handleExportMarkdown}>
            <FileDown className="h-3.5 w-3.5 text-zinc-500 hover:text-indigo-600 dark:text-zinc-400 dark:hover:text-indigo-400 transition-colors" />
          </FormatButton>
          <FormatButton label="Clear notes" onClick={handleDeleteNotes}>
            <Trash2 className="h-3.5 w-3.5 text-zinc-400 hover:text-red-500 transition-colors" />
          </FormatButton>
        </div>
      </div>

      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        aria-label="Coworking group notes editor"
        contentEditable={status !== "connecting"}
        suppressContentEditableWarning
        onInput={handleInput}
        data-placeholder={placeholder}
        className="min-h-[160px] rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-900 outline-none empty:before:text-zinc-400 empty:before:content-[attr(data-placeholder)] focus:ring-2 focus:ring-blue-500/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      />

      <div className="flex items-center justify-between text-xs text-zinc-400 dark:text-zinc-500">
        <div>
          {status === "offline" && (
            <p className="text-[10px] font-bold text-orange-500">
              Offline — edits are saved to IndexedDB and will sync over PartyKit
              when you reconnect.
            </p>
          )}
        </div>
        <div
          data-testid="notes-count-indicator"
          className="shrink-0 flex items-center gap-1.5 font-medium ml-auto"
        >
          <span>
            {wordCount} {wordCount === 1 ? "word" : "words"}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {charCount} {charCount === 1 ? "char" : "chars"}
          </span>
        </div>
      </div>

      {conflicts && conflicts.length > 0 && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setConflicts(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="conflict-modal-title"
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <h2
                id="conflict-modal-title"
                className="text-lg font-semibold text-zinc-950 dark:text-white"
              >
                Merge Conflict
              </h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Your offline edits overlap with changes made by others. Choose
                which version to keep.
              </p>
            </div>

            <div className="max-h-60 space-y-3 overflow-y-auto px-5 py-4">
              {conflicts.map((c, i) => (
                <div
                  key={c.entry.id ?? i}
                  className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <p className="mb-1 text-xs font-bold uppercase tracking-wider text-zinc-500">
                    Conflict #{i + 1}
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="font-medium text-zinc-600 dark:text-zinc-400">
                        Your edit:
                      </span>
                      <p className="mt-0.5 rounded bg-blue-50 p-1 text-zinc-800 dark:bg-blue-950 dark:text-zinc-200">
                        {c.textBefore || "(empty)"}
                      </p>
                    </div>
                    <div>
                      <span className="font-medium text-zinc-600 dark:text-zinc-400">
                        Remote:
                      </span>
                      <p className="mt-0.5 rounded bg-amber-50 p-1 text-zinc-800 dark:bg-amber-950 dark:text-zinc-200">
                        {c.textAfter || "(empty)"}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3 border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => handleResolveConflicts(false)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                Use Remote
              </button>
              <button
                type="button"
                onClick={() => handleResolveConflicts(true)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
              >
                Keep Local
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FormatButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="rounded-md border border-zinc-200 bg-zinc-50 p-1.5 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      {children}
    </button>
  );
}
