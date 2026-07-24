"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import * as Y from "yjs";
import YPartyKitProvider from "y-partykit/provider";
import { Bold, Italic, Loader2, Underline, Wifi, WifiOff } from "lucide-react";
import { applyYTextDiff } from "@/lib/crdt/applyYTextDiff";
import {
  enqueueNotesUpdate,
  flushNotesOutbox,
  loadNotesDocState,
  saveNotesDocState,
} from "@/lib/crdt/notesOutbox";

export type GroupNotesEditorProps = {
  /** PartyKit room id (e.g. venue or coworking group id) */
  roomId: string;
  placeholder?: string;
  /** Shared Y.Text key inside the document */
  textKey?: string;
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
}: GroupNotesEditorProps) {
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [pendingOutbox, setPendingOutbox] = useState(0);

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
  }, []);

  useEffect(() => {
    let cancelled = false;
    const ydoc = new Y.Doc();
    yDocRef.current = ydoc;
    const ytext = ydoc.getText(textKey);
    yTextRef.current = ytext;

    const host =
      process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999";
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

    const onStatus = (event: { status: string }) => {
      if (event.status === "connected") {
        setStatus("connected");
        void flushNotesOutbox(roomId, ydoc).then((flushed) => {
          if (flushed > 0) setPendingOutbox(0);
          syncEditorFromYText();
        });
      } else if (event.status === "disconnected") {
        setStatus("offline");
      } else {
        setStatus("connecting");
      }
    };
    provider.on("status", onStatus);

    const onSync = (synced: boolean) => {
      if (!synced || cancelled) return;
      void flushNotesOutbox(roomId, ydoc).then((flushed) => {
        if (flushed > 0) setPendingOutbox(0);
        syncEditorFromYText();
      });
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
      provider.disconnect();
      ydoc.destroy();
      yDocRef.current = null;
      yTextRef.current = null;
      providerRef.current = null;
    };
  }, [roomId, syncEditorFromYText, textKey]);

  const handleInput = () => {
    if (applyingRemoteRef.current) return;
    const editor = editorRef.current;
    const ytext = yTextRef.current;
    if (!editor || !ytext) return;
    applyYTextDiff(ytext, editor.innerText);
  };

  const execFormat = (command: "bold" | "italic" | "underline") => {
    editorRef.current?.focus();
    document.execCommand(command);
    handleInput();
  };

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

      {status === "offline" && (
        <p className="text-[10px] font-bold text-orange-500">
          Offline — edits are saved to IndexedDB and will sync over PartyKit
          when you reconnect.
        </p>
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
