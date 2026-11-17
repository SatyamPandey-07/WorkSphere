"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as Y from "yjs";
import YPartyKitProvider from "y-partykit/provider";
import { useAuth } from "@clerk/nextjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { Bold, Italic, Trash2, Underline, FileDown } from "lucide-react";
import { applyYTextDiff } from "@/lib/crdt/applyYTextDiff";
import {
  enqueueNotesUpdate,
  flushNotesOutbox,
  loadNotesDocState,
  saveNotesDocState,
  listNotesOutbox,
  resolveConflictsKeepLocal,
  resolveConflictsUseRemote,
  type NotesOutboxConflict,
} from "@/lib/crdt/notesOutbox";
import { useToast } from "@/components/ui/Toast";
import {
  ConnectionStatusPill,
  type ConnectionStatus,
} from "./ConnectionStatusPill";
import { OfflineSyncBanner } from "./OfflineSyncBanner";
import { CollaboratorPresence } from "./CollaboratorPresence";

export type AwarenessPeer = {
  clientId: number;
  name: string;
  avatarUrl?: string;
  color: string;
  cursorIndex?: number;
};

export type GroupNotesEditorProps = {
  /** PartyKit room id (e.g. venue or coworking group id) */
  roomId: string;
  placeholder?: string;
  /** Shared Y.Text key inside the document */
  textKey?: string;
  venueName?: string;
  /** Current user identity for shared awareness cursors */
  currentUser?: {
    name: string;
    avatarUrl?: string;
    color?: string;
  };
};

export type { ConnectionStatus };

const CURSOR_PALETTE = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#9333ea",
  "#e11d48",
  "#0891b2",
];

function getCaretCharacterOffset(element: HTMLElement): number {
  if (typeof window === "undefined") return 0;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return 0;
  const range = selection.getRangeAt(0);
  const preCaretRange = range.cloneRange();
  preCaretRange.selectNodeContents(element);
  preCaretRange.setEnd(range.endContainer, range.endOffset);
  return preCaretRange.toString().length;
}

/**
 * Offline-first CRDT group notes editor (#1023, #7228, #7843).
 * Y.Text ↔ contenteditable, y-indexeddb + outbox persistence, PartyKit sync & awareness cursors.
 * Includes connection status pill, active collaborator presence, offline banner, and unsynced edits counter.
 */
export function GroupNotesEditor({
  roomId,
  placeholder = "Start writing group notes…",
  textKey = "group-notes",
  venueName,
  currentUser,
}: GroupNotesEditorProps) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [pendingCount, setPendingCount] = useState(0);
  const [isLocalPersistenceReady, setIsLocalPersistenceReady] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [conflicts, setConflicts] = useState<NotesOutboxConflict[] | null>(
    null,
  );
  const [editorText, setEditorText] = useState("");
  const [activePeers, setActivePeers] = useState<AwarenessPeer[]>([]);

  const { toast } = useToast();

  // PartyKit treats a connection without a token as read-only and drops its
  // updates, so send a fresh Clerk token on every (re)connect.
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const editorRef = useRef<HTMLDivElement>(null);
  const yDocRef = useRef<Y.Doc | null>(null);
  const yTextRef = useRef<Y.Text | null>(null);
  const providerRef = useRef<YPartyKitProvider | null>(null);
  const applyingRemoteRef = useRef(false);
  const isFlushingRef = useRef(false);

  const localIdentity = useMemo(() => {
    const fallbackIndex =
      roomId.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0) %
      CURSOR_PALETTE.length;
    return {
      name: currentUser?.name || "Coworker",
      avatarUrl: currentUser?.avatarUrl,
      color: currentUser?.color || CURSOR_PALETTE[fallbackIndex],
    };
  }, [currentUser, roomId]);

  const broadcastCursorAwareness = useCallback(
    (cursorIndex: number) => {
      const awareness = providerRef.current?.awareness;
      if (!awareness) return;
      awareness.setLocalStateField("user", {
        name: localIdentity.name,
        avatarUrl: localIdentity.avatarUrl,
        color: localIdentity.color,
        cursorIndex,
      });
    },
    [localIdentity],
  );

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

    // Load initial pending outbox count from IndexedDB
    void (async () => {
      try {
        const pending = await listNotesOutbox(roomId);
        if (!cancelled) {
          setPendingCount(pending.length);
        }
      } catch {
        // outbox check error handled safely
      }
    })();

    // Offline local caching with y-indexeddb for deterministic CRDT merge on reconnect
    let idbProvider: IndexeddbPersistence | null = null;
    if (typeof indexedDB !== "undefined") {
      try {
        idbProvider = new IndexeddbPersistence(
          `worksphere-notes-${roomId}`,
          ydoc,
        );
        idbProvider.on("synced", () => {
          if (!cancelled) {
            setIsLocalPersistenceReady(true);
            syncEditorFromYText();
          }
        });
        setIsLocalPersistenceReady(true);
      } catch (err) {
        console.warn("Failed to initialize IndexedDB persistence", err);
        setIsLocalPersistenceReady(false);
      }
    } else {
      setIsLocalPersistenceReady(false);
    }

    const host = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999";
    let provider: YPartyKitProvider | null = null;
    try {
      provider = new YPartyKitProvider(host, `notes-${roomId}`, ydoc, {
        params: async () => ({
          token: (await getTokenRef.current?.()) ?? "",
        }),
      });
      providerRef.current = provider;
      const initialStatus: ConnectionStatus = provider.wsconnected
        ? "connected"
        : provider.wsconnecting
          ? "connecting"
          : "disconnected";
      setStatus(initialStatus);
    } catch (err) {
      console.warn("Failed to initialize PartyKit provider", err);
      setStatus("disconnected");
    }

    // Initialize shared awareness state (user avatar, name, cursor)
    const awareness = provider?.awareness;
    const syncPeersFromAwareness = () => {
      if (!awareness || cancelled) return;
      const states = awareness.getStates();
      const peersMap = new Map<number, AwarenessPeer>();
      states.forEach((state, clientId) => {
        if (clientId === awareness.clientID) return;
        if (!state) return;
        const userState = state.user as
          | {
              name?: string;
              avatarUrl?: string;
              color?: string;
              cursorIndex?: number;
            }
          | undefined;
        const name =
          typeof userState?.name === "string" && userState.name.trim()
            ? userState.name.trim()
            : `Collaborator ${clientId}`;
        peersMap.set(clientId, {
          clientId,
          name,
          avatarUrl: userState?.avatarUrl,
          color:
            userState?.color ||
            CURSOR_PALETTE[clientId % CURSOR_PALETTE.length],
          cursorIndex: userState?.cursorIndex,
        });
      });
      setActivePeers(Array.from(peersMap.values()));
    };

    if (awareness) {
      awareness.setLocalStateField("user", {
        name: localIdentity.name,
        avatarUrl: localIdentity.avatarUrl,
        color: localIdentity.color,
        cursorIndex: 0,
      });
      awareness.on("change", syncPeersFromAwareness);
      syncPeersFromAwareness();
    }

    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (
        origin === "remote" ||
        origin === "outbox-flush" ||
        origin === "idb-load"
      ) {
        return;
      }
      void (async () => {
        try {
          await saveNotesDocState(roomId, ydoc);
        } catch {
          // ignore doc snapshot save error
        }
        const wsOpen =
          providerRef.current?.wsconnected &&
          providerRef.current?.ws?.readyState === WebSocket.OPEN;
        if (!wsOpen) {
          try {
            await enqueueNotesUpdate(roomId, update);
            const pending = await listNotesOutbox(roomId);
            if (!cancelled) {
              setPendingCount(pending.length);
            }
          } catch {
            if (!cancelled) {
              setPendingCount((n) => n + 1);
            }
          }
        }
      })();
    };
    ydoc.on("update", onUpdate);

    const observer = () => {
      if (!applyingRemoteRef.current) syncEditorFromYText();
    };
    ytext.observe(observer);

    const handleFlushResult = (
      result: {
        flushed: number;
        conflicts: NotesOutboxConflict[];
      },
      remainingCount: number,
    ) => {
      if (cancelled) return;
      setPendingCount(remainingCount);
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

    const runFlush = async () => {
      if (isFlushingRef.current || cancelled) return;
      isFlushingRef.current = true;
      setIsSyncing(true);
      try {
        const result = await flushNotesOutbox(roomId, ydoc, textKey);
        let remainingCount = 0;
        try {
          const remaining = await listNotesOutbox(roomId);
          remainingCount = remaining.length;
        } catch {
          remainingCount = result.conflicts.length;
        }
        if (!cancelled) {
          handleFlushResult(result, remainingCount);
        }
      } catch (err) {
        console.warn("Failed to flush notes outbox", err);
      } finally {
        isFlushingRef.current = false;
        if (!cancelled) {
          setIsSyncing(false);
        }
      }
    };

    const onStatus = (event: { status: string }) => {
      if (cancelled) return;
      if (event.status === "connected") {
        setStatus("connected");
        void runFlush();
      } else if (event.status === "disconnected") {
        setStatus("disconnected");
        setIsSyncing(false);
      } else if (event.status === "connecting") {
        setStatus("connecting");
      }
    };

    const onSync = (synced: boolean) => {
      if (!synced || cancelled) return;
      void runFlush();
    };

    if (provider) {
      provider.on("status", onStatus);
      provider.on("sync", onSync);
    }

    void (async () => {
      try {
        const saved = await loadNotesDocState(roomId);
        if (cancelled) return;
        if (saved) {
          Y.applyUpdate(ydoc, saved, "idb-load");
          syncEditorFromYText();
        }
      } catch (err) {
        console.warn("Failed to load saved notes doc state", err);
        if (!cancelled) {
          setIsLocalPersistenceReady(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      ytext.unobserve(observer);
      ydoc.off("update", onUpdate);
      if (provider) {
        provider.off("status", onStatus);
        provider.off("sync", onSync);
        if (typeof provider.destroy === "function") {
          provider.destroy();
        } else if (typeof provider.disconnect === "function") {
          provider.disconnect();
        }
      }
      if (awareness) {
        awareness.off("change", syncPeersFromAwareness);
      }
      if (idbProvider) {
        void idbProvider.destroy();
      }
      ydoc.destroy();
      yDocRef.current = null;
      yTextRef.current = null;
      providerRef.current = null;
    };
  }, [localIdentity, roomId, syncEditorFromYText, textKey, toast]);

  const handleInput = () => {
    if (applyingRemoteRef.current) return;
    const editor = editorRef.current;
    const ytext = yTextRef.current;
    if (!editor || !ytext) return;
    setEditorText(editor.innerText);
    applyYTextDiff(ytext, editor.innerText);
    broadcastCursorAwareness(getCaretCharacterOffset(editor));
  };

  const handleSelectionChange = () => {
    const editor = editorRef.current;
    if (!editor) return;
    broadcastCursorAwareness(getCaretCharacterOffset(editor));
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
      try {
        const remaining = await listNotesOutbox(roomId);
        setPendingCount(remaining.length);
      } catch {
        setPendingCount(0);
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
  const wordCount = trimmedEditorText
    ? trimmedEditorText.split(/\s+/).length
    : 0;
  const charCount = editorText.length;

  return (
    <div className="flex w-full flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      {/* Header / Toolbar */}
      <div className="flex items-center justify-between border-b border-zinc-100 pb-3 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-black uppercase tracking-widest text-zinc-800 dark:text-zinc-200">
            Group Notes
          </h3>
          <CollaboratorPresence peers={activePeers} />
        </div>
        <ConnectionStatusPill status={status} pendingCount={pendingCount} />
      </div>

      {/* Persistent Offline / Sync Warning Banner */}
      <OfflineSyncBanner
        status={status}
        pendingCount={pendingCount}
        isLocalPersistenceReady={isLocalPersistenceReady}
        isSyncing={isSyncing}
      />

      {/* Formatting & action buttons */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <FormatButton label="Bold" onClick={() => execFormat("bold")}>
            <Bold className="h-3.5 w-3.5" />
          </FormatButton>
          <FormatButton label="Italic" onClick={() => execFormat("italic")}>
            <Italic className="h-3.5 w-3.5" />
          </FormatButton>
          <FormatButton
            label="Underline"
            onClick={() => execFormat("underline")}
          >
            <Underline className="h-3.5 w-3.5" />
          </FormatButton>
        </div>
        <div className="flex items-center gap-1">
          <FormatButton
            label="Export Markdown (.md)"
            onClick={handleExportMarkdown}
          >
            <FileDown className="h-3.5 w-3.5 text-zinc-500 hover:text-indigo-600 dark:text-zinc-400 dark:hover:text-indigo-400 transition-colors" />
          </FormatButton>
          <FormatButton label="Clear notes" onClick={handleDeleteNotes}>
            <Trash2 className="h-3.5 w-3.5 text-zinc-400 hover:text-red-500 transition-colors" />
          </FormatButton>
        </div>
      </div>

      {/* ContentEditable Notes Scratchpad */}
      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        aria-label="Coworking group notes editor"
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyUp={handleSelectionChange}
        onClick={handleSelectionChange}
        data-placeholder={placeholder}
        className="min-h-[160px] rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-900 outline-none empty:before:text-zinc-400 empty:before:content-[attr(data-placeholder)] focus:ring-2 focus:ring-blue-500/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      />

      {/* Footer bar */}
      <div className="flex items-center justify-between text-xs text-zinc-400 dark:text-zinc-500">
        <div>
          {status === "disconnected" && (
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

      {/* Conflict Resolution Modal */}
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

export default GroupNotesEditor;
