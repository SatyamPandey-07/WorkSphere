"use client";

/**
 * Conflict-free collaborative notes for a shared venue collection (#3360).
 *
 * The note is a Yjs Y.Text synced over the members-only PartyKit room
 * `folder-notes-{folderId}`. Typing is translated into minimal character
 * ops (applyYTextDiff), so concurrent edits to different paragraphs merge
 * instead of the last save overwriting the rest. Editors also write a
 * debounced plain-text snapshot to Folder.description for list/PDF/public views.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import YPartyKitProvider from "y-partykit/provider";
import { useAuth } from "@clerk/nextjs";
import { Cloud, CloudOff, Loader2 } from "lucide-react";
import { applyYTextDiff } from "@/lib/crdt/applyYTextDiff";
import {
  MAX_COLLECTION_NOTES_LENGTH,
  collectionNotesRoom,
  getCollectionNotesText,
  seedCollectionNotes,
} from "@/lib/crdt/collectionNotes";

const SNAPSHOT_DEBOUNCE_MS = 1500;

interface CollectionNotesEditorProps {
  folderId: string;
  /** Current Folder.description, used once to seed an empty shared note. */
  initialText: string | null;
  /** OWNER / EDITOR may type; others see the live note read-only. */
  canEdit: boolean;
}

type Status = "connecting" | "synced" | "offline";

export function CollectionNotesEditor({ folderId, initialText, canEdit }: CollectionNotesEditorProps) {
  const { getToken } = useAuth();
  const [text, setText] = useState(initialText ?? "");
  const [status, setStatus] = useState<Status>("connecting");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const ytextRef = useRef<Y.Text | null>(null);
  const selectionRef = useRef<{ start: Y.RelativePosition; end: Y.RelativePosition } | null>(null);
  const initialTextRef = useRef(initialText);
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read through a ref: getToken's identity may change between renders, and
  // it must not tear down the Y.Doc and reconnect the provider when it does.
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  /** Remember the caret as CRDT-relative positions so remote edits don't move it. */
  const rememberSelection = useCallback(() => {
    const el = textareaRef.current;
    const ytext = ytextRef.current;
    if (!el || !ytext) return;
    selectionRef.current = {
      start: Y.createRelativePositionFromTypeIndex(ytext, el.selectionStart),
      end: Y.createRelativePositionFromTypeIndex(ytext, el.selectionEnd),
    };
  }, []);

  useEffect(() => {
    const doc = new Y.Doc();
    const ytext = getCollectionNotesText(doc);
    ytextRef.current = ytext;

    const host = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999";
    const provider = new YPartyKitProvider(host, collectionNotesRoom(folderId), doc, {
      // Fresh Clerk token on every (re)connect; the room is members-only.
      params: async () => ({ token: (await getTokenRef.current()) ?? "" }),
    });

    const saveSnapshot = () => {
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
      snapshotTimerRef.current = setTimeout(() => {
        // Every client converges to the same text, so snapshot writes can't
        // lose edits; the CRDT, not this field, is the source of truth.
        void fetch(`/api/folders/${folderId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: ytext.toString().slice(0, MAX_COLLECTION_NOTES_LENGTH) }),
        }).catch(() => {});
      }, SNAPSHOT_DEBOUNCE_MS);
    };

    const onTextChange = (event: Y.YTextEvent) => {
      const next = ytext.toString();
      setText(next);

      const el = textareaRef.current;
      const sel = selectionRef.current;
      if (!event.transaction.local && el && sel && document.activeElement === el) {
        // Restore the caret after React re-renders the new value.
        requestAnimationFrame(() => {
          const start = Y.createAbsolutePositionFromRelativePosition(sel.start, doc);
          const end = Y.createAbsolutePositionFromRelativePosition(sel.end, doc);
          if (start && end) el.setSelectionRange(start.index, end.index);
        });
      }
      if (canEdit && event.transaction.local && event.transaction.origin !== "seed") saveSnapshot();
    };
    ytext.observe(onTextChange);

    const onSync = (synced: boolean) => {
      if (!synced) return;
      setStatus("synced");
      if (canEdit) seedCollectionNotes(doc, initialTextRef.current);
      setText(ytext.toString());
    };
    const onStatus = ({ status: s }: { status: string }) => {
      if (s === "disconnected") setStatus("offline");
    };
    provider.on("sync", onSync);
    provider.on("status", onStatus);

    return () => {
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
      ytext.unobserve(onTextChange);
      provider.off("sync", onSync);
      provider.off("status", onStatus);
      provider.destroy();
      doc.destroy();
      ytextRef.current = null;
    };
  }, [folderId, canEdit]);

  const onChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const ytext = ytextRef.current;
    if (!ytext || !canEdit) return;
    const next = event.target.value.slice(0, MAX_COLLECTION_NOTES_LENGTH);
    setText(next);
    applyYTextDiff(ytext, next);
    rememberSelection();
  };

  const trimmedText = text.trim();
  const wordCount = trimmedText ? trimmedText.split(/\s+/).length : 0;
  const charCount = text.length;

  return (
    <section aria-labelledby={`collection-notes-${folderId}`} className="mt-4">
      <div className="flex items-center justify-between mb-1.5">
        <label
          id={`collection-notes-${folderId}`}
          htmlFor={`collection-notes-input-${folderId}`}
          className="text-sm font-semibold text-zinc-700 dark:text-zinc-300"
        >
          Collection notes
        </label>
        <span className="inline-flex items-center gap-1 text-xs text-zinc-500" aria-live="polite">
          {status === "connecting" && (
            <>
              <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> Connecting…
            </>
          )}
          {status === "synced" && (
            <>
              <Cloud className="w-3 h-3" aria-hidden="true" /> Live — edits merge automatically
            </>
          )}
          {status === "offline" && (
            <>
              <CloudOff className="w-3 h-3" aria-hidden="true" /> Offline — changes will merge on reconnect
            </>
          )}
        </span>
      </div>
      <textarea
        id={`collection-notes-input-${folderId}`}
        ref={textareaRef}
        value={text}
        onChange={onChange}
        onSelect={rememberSelection}
        onKeyUp={rememberSelection}
        onClick={rememberSelection}
        readOnly={!canEdit}
        maxLength={MAX_COLLECTION_NOTES_LENGTH}
        rows={5}
        placeholder={canEdit ? "Add notes for everyone on this collection…" : "No notes yet."}
        className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 read-only:bg-zinc-50 dark:read-only:bg-zinc-900/50"
      />
      <div
        data-testid="notes-count-indicator"
        className="mt-1 flex items-center justify-end gap-1.5 text-xs text-zinc-400 dark:text-zinc-500 font-medium text-right"
      >
        <span>
          {wordCount} {wordCount === 1 ? "word" : "words"}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          {charCount}/{MAX_COLLECTION_NOTES_LENGTH}
        </span>
      </div>
    </section>
  );
}
