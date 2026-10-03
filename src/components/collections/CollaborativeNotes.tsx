"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import * as Y from "yjs";
import YPartyKitProvider from "y-partykit/provider";
import usePartySocket from "partysocket/react";
import { useAuth, useUser } from "@clerk/nextjs";
import { Cloud, CloudOff, FileText, Loader2 } from "lucide-react";
import { applyYTextDiff } from "@/lib/crdt/applyYTextDiff";
import {
  MAX_COLLECTION_NOTES_LENGTH,
  collectionNotesRoom,
  getCollectionNotesText,
  seedCollectionNotes,
} from "@/lib/crdt/collectionNotes";

const SNAPSHOT_DEBOUNCE_MS = 1500;
const TYPING_TIMEOUT_MS = 2500;
const HEARTBEAT_INTERVAL_MS = 5000;

export interface CollaboratorPresence {
  userId: string;
  userName: string;
  avatarUrl?: string;
  cursorPosition?: number | null;
  isTyping: boolean;
  lastActive: number;
}

export interface CollaborativeNotesProps {
  folderId?: string;
  roomId?: string;
  initialText?: string | null;
  canEdit?: boolean;
  className?: string;
  currentUser?: {
    userId?: string;
    userName?: string;
    avatarUrl?: string;
  };
}

type SyncStatus = "connecting" | "synced" | "offline";

export function CollaborativeNotes({
  folderId,
  roomId: propRoomId,
  initialText = null,
  canEdit = true,
  className = "",
  currentUser: propCurrentUser,
}: CollaborativeNotesProps) {
  const resolvedFolderId =
    folderId ||
    (propRoomId?.startsWith("folder-notes-")
      ? propRoomId.replace("folder-notes-", "")
      : propRoomId) ||
    "default-folder";

  const { getToken } = useAuth();
  const clerkUser = useUser?.() || { user: null };

  const currentUserId =
    propCurrentUser?.userId ||
    clerkUser.user?.id ||
    "local-user";
  const currentUserName =
    propCurrentUser?.userName ||
    clerkUser.user?.fullName ||
    clerkUser.user?.firstName ||
    clerkUser.user?.username ||
    "Collaborator";
  const currentUserAvatar =
    propCurrentUser?.avatarUrl || clerkUser.user?.imageUrl;

  const [text, setText] = useState(initialText ?? "");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("connecting");
  const [collaborators, setCollaborators] = useState<Map<string, CollaboratorPresence>>(
    new Map(),
  );

  const isLocalTypingRef = useRef(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const ytextRef = useRef<Y.Text | null>(null);
  const selectionRef = useRef<{ start: Y.RelativePosition; end: Y.RelativePosition } | null>(null);
  const initialTextRef = useRef(initialText);
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const roomName = collectionNotesRoom(resolvedFolderId);
  const host = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999";

  // PartySocket for presence protocol & room awareness (#3438)
  const socket = usePartySocket({
    host,
    room: roomName,
    onOpen() {
      // 1. Announce initial presence
      socket.send(
        JSON.stringify({
          type: "presence_update",
          userId: currentUserId,
          userName: currentUserName,
          avatarUrl: currentUserAvatar,
          cursorPosition: null,
          isTyping: false,
          lastActive: Date.now(),
        }),
      );
      // 2. Request current room presences
      socket.send(JSON.stringify({ type: "request_presence" }));
    },
    onMessage(event) {
      try {
        const data = JSON.parse(event.data);

        // Presence update from a collaborator
        if (data.type === "presence_update") {
          if (data.userId === currentUserId) return;
          setCollaborators((prev) => {
            const next = new Map(prev);
            next.set(data.userId, {
              userId: data.userId,
              userName: data.userName || "Collaborator",
              avatarUrl: data.avatarUrl,
              cursorPosition: data.cursorPosition ?? null,
              isTyping: Boolean(data.isTyping),
              lastActive: data.lastActive || Date.now(),
            });
            return next;
          });
        }

        // Collaborator dropped / disconnected / pruned
        if (data.type === "presence_remove" || data.type === "presence_leave") {
          setCollaborators((prev) => {
            const next = new Map(prev);
            next.delete(data.userId);
            return next;
          });
        }

        // Initial snapshot of all active collaborators in room
        if (data.type === "presence_state" && Array.isArray(data.users)) {
          setCollaborators((prev) => {
            const next = new Map(prev);
            for (const user of data.users) {
              if (user.userId !== currentUserId) {
                next.set(user.userId, {
                  userId: user.userId,
                  userName: user.userName || "Collaborator",
                  avatarUrl: user.avatarUrl,
                  cursorPosition: user.cursorPosition ?? null,
                  isTyping: Boolean(user.isTyping),
                  lastActive: user.lastActive || Date.now(),
                });
              }
            }
            return next;
          });
        }
      } catch {
        // Non-JSON or other event, handled by Yjs
      }
    },
  });

  // Requirement 2: Clients send a presence heartbeat every 5 seconds while active
  useEffect(() => {
    const heartbeatTimer = setInterval(() => {
      try {
        const isOpen =
          socket &&
          (socket.readyState === 1 ||
            (typeof WebSocket !== "undefined" &&
              socket.readyState === WebSocket.OPEN));
        if (isOpen) {
          socket.send(
            JSON.stringify({
              type: "presence_heartbeat",
              userId: currentUserId,
              userName: currentUserName,
              avatarUrl: currentUserAvatar,
              isTyping: isLocalTypingRef.current,
              lastActive: Date.now(),
            }),
          );
        }
      } catch {
        // Socket closed or reconnecting
      }
    }, HEARTBEAT_INTERVAL_MS);

    return () => clearInterval(heartbeatTimer);
  }, [socket, currentUserId, currentUserName, currentUserAvatar]);

  // Remember caret position as CRDT-relative position
  const rememberSelection = useCallback(() => {
    const el = textareaRef.current;
    const ytext = ytextRef.current;
    if (!el || !ytext) return;
    selectionRef.current = {
      start: Y.createRelativePositionFromTypeIndex(ytext, el.selectionStart),
      end: Y.createRelativePositionFromTypeIndex(ytext, el.selectionEnd),
    };
  }, []);

  // Yjs provider setup for conflict-free text synchronization
  useEffect(() => {
    const doc = new Y.Doc();
    const ytext = getCollectionNotesText(doc);
    ytextRef.current = ytext;

    const provider = new YPartyKitProvider(host, roomName, doc, {
      params: async () => ({ token: (await getTokenRef.current?.()) ?? "" }),
    });

    const saveSnapshot = () => {
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
      snapshotTimerRef.current = setTimeout(() => {
        void fetch(`/api/folders/${resolvedFolderId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: ytext.toString().slice(0, MAX_COLLECTION_NOTES_LENGTH),
          }),
        }).catch(() => {});
      }, SNAPSHOT_DEBOUNCE_MS);
    };

    const onTextChange = (event: Y.YTextEvent) => {
      const next = ytext.toString();
      setText(next);

      const el = textareaRef.current;
      const sel = selectionRef.current;
      if (!event.transaction.local && el && sel && document.activeElement === el) {
        requestAnimationFrame(() => {
          const start = Y.createAbsolutePositionFromRelativePosition(sel.start, doc);
          const end = Y.createAbsolutePositionFromRelativePosition(sel.end, doc);
          if (start && end) el.setSelectionRange(start.index, end.index);
        });
      }
      if (canEdit && event.transaction.local && event.transaction.origin !== "seed") {
        saveSnapshot();
      }
    };
    ytext.observe(onTextChange);

    const onSync = (synced: boolean) => {
      if (!synced) return;
      setSyncStatus("synced");
      if (canEdit) seedCollectionNotes(doc, initialTextRef.current);
      setText(ytext.toString());
    };
    const onStatus = ({ status: s }: { status: string }) => {
      if (s === "disconnected") setSyncStatus("offline");
      else if (s === "connected") setSyncStatus("synced");
    };

    provider.on("sync", onSync);
    provider.on("status", onStatus);

    return () => {
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      ytext.unobserve(onTextChange);
      provider.off("sync", onSync);
      provider.off("status", onStatus);
      provider.destroy();
      doc.destroy();
      ytextRef.current = null;
    };
  }, [host, roomName, resolvedFolderId, canEdit]);

  // Handle local typing events and presence update broadcasts
  const handleTextChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value.slice(0, MAX_COLLECTION_NOTES_LENGTH);
    setText(next);

    const ytext = ytextRef.current;
    if (ytext && canEdit) {
      applyYTextDiff(ytext, next);
      rememberSelection();
    }

    // Broadcast isTyping = true immediately
    if (!isLocalTypingRef.current) {
      isLocalTypingRef.current = true;
      try {
        const isOpen =
          socket &&
          (socket.readyState === 1 ||
            (typeof WebSocket !== "undefined" &&
              socket.readyState === WebSocket.OPEN));
        if (isOpen) {
          socket.send(
            JSON.stringify({
              type: "presence_update",
              userId: currentUserId,
              userName: currentUserName,
              avatarUrl: currentUserAvatar,
              cursorPosition: e.target.selectionStart,
              isTyping: true,
              lastActive: Date.now(),
            }),
          );
        }
      } catch {
        // socket not ready
      }
    }

    // Debounce resetting isTyping to false after inactivity
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      isLocalTypingRef.current = false;
      try {
        const isOpen =
          socket &&
          (socket.readyState === 1 ||
            (typeof WebSocket !== "undefined" &&
              socket.readyState === WebSocket.OPEN));
        if (isOpen) {
          socket.send(
            JSON.stringify({
              type: "presence_update",
              userId: currentUserId,
              userName: currentUserName,
              avatarUrl: currentUserAvatar,
              cursorPosition: textareaRef.current?.selectionStart ?? null,
              isTyping: false,
              lastActive: Date.now(),
            }),
          );
        }
      } catch {
        // socket not ready
      }
    }, TYPING_TIMEOUT_MS);
  };

  const activeCollaboratorsList = Array.from(collaborators.values());
  const typingCollaborators = activeCollaboratorsList.filter((c) => c.isTyping);

  return (
    <section
      aria-labelledby={`collection-notes-${resolvedFolderId}`}
      className={`mt-4 ${className}`}
      data-testid="collaborative-notes-container"
    >
      {/* UI Presence Bar (Requirement 3) */}
      <div
        data-testid="presence-bar"
        className="flex items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-2.5 mb-2.5"
      >
        <div className="flex items-center gap-2">
          <label
            id={`collection-notes-${resolvedFolderId}`}
            htmlFor={`collection-notes-input-${resolvedFolderId}`}
            className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5"
          >
            <FileText className="w-4 h-4 text-zinc-500" aria-hidden="true" />
            <span>Collection notes</span>
          </label>
        </div>

        {/* Collaborators Avatar Chips and Status */}
        <div className="flex items-center gap-2">
          <div
            data-testid="collaborators-list"
            aria-label="Active collaborators"
            className="flex items-center gap-1.5 flex-wrap"
          >
            {activeCollaboratorsList.map((collab) => (
              <div
                key={collab.userId}
                data-testid={`collaborator-${collab.userId}`}
                className="relative group flex items-center gap-1.5 pl-1.5 pr-2.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800/90 border border-zinc-200 dark:border-zinc-700/70 text-xs shadow-xs transition-all"
                title={`${collab.userName}${collab.isTyping ? " (typing...)" : ""}`}
              >
                {/* User Avatar with Green Indicator Dot */}
                <div className="relative flex items-center justify-center shrink-0">
                  {collab.avatarUrl ? (
                    <img
                      src={collab.avatarUrl}
                      alt={collab.userName}
                      className="w-5 h-5 rounded-full object-cover border border-white dark:border-zinc-900"
                    />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-blue-600 text-white font-bold text-[10px] flex items-center justify-center border border-white dark:border-zinc-900 uppercase">
                      {collab.userName.slice(0, 2)}
                    </div>
                  )}

                  {/* Green Indicator Dot */}
                  <span
                    data-testid={`active-dot-${collab.userId}`}
                    aria-label="Online"
                    className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-1 ring-white dark:ring-zinc-900"
                  >
                    <span className="sr-only">Active</span>
                  </span>
                </div>

                {/* Collaborator Name */}
                <span className="font-medium text-zinc-700 dark:text-zinc-300 max-w-[90px] truncate">
                  {collab.userName}
                </span>

                {/* Typing Bubble */}
                {collab.isTyping && (
                  <div
                    data-testid={`typing-bubble-${collab.userId}`}
                    aria-label={`${collab.userName} is typing`}
                    className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950 border border-blue-300 dark:border-blue-800 text-[10px] text-blue-600 dark:text-blue-400 font-bold"
                  >
                    <span className="w-1 h-1 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-1 h-1 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-1 h-1 rounded-full bg-blue-500 animate-bounce" />
                    <span className="sr-only">typing</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Sync status indicator */}
          <span
            className="inline-flex items-center gap-1 text-xs text-zinc-500 ml-1"
            aria-live="polite"
          >
            {syncStatus === "connecting" && (
              <>
                <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                <span className="hidden sm:inline">Connecting…</span>
              </>
            )}
            {syncStatus === "synced" && (
              <>
                <Cloud className="w-3 h-3 text-emerald-500" aria-hidden="true" />
                <span className="hidden sm:inline">Live — edits merge automatically</span>
              </>
            )}
            {syncStatus === "offline" && (
              <>
                <CloudOff className="w-3 h-3 text-amber-500" aria-hidden="true" />
                <span className="hidden sm:inline">Offline — changes will merge on reconnect</span>
              </>
            )}
          </span>
        </div>
      </div>

      {/* Typing indicator notification banner */}
      {typingCollaborators.length > 0 && (
        <div
          data-testid="typing-banner"
          aria-live="polite"
          className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 mb-2 font-medium"
        >
          <div className="flex gap-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" />
          </div>
          <span>
            {typingCollaborators.map((c) => c.userName).join(", ")}{" "}
            {typingCollaborators.length === 1 ? "is typing…" : "are typing…"}
          </span>
        </div>
      )}

      {/* Collaborative Notes Textarea */}
      <textarea
        id={`collection-notes-input-${resolvedFolderId}`}
        ref={textareaRef}
        value={text}
        onChange={handleTextChange}
        onSelect={rememberSelection}
        onKeyUp={rememberSelection}
        onClick={rememberSelection}
        readOnly={!canEdit}
        maxLength={MAX_COLLECTION_NOTES_LENGTH}
        rows={5}
        placeholder={
          canEdit
            ? "Add notes for everyone on this collection…"
            : "No notes yet."
        }
        className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 read-only:bg-zinc-50 dark:read-only:bg-zinc-900/50"
      />
      <p className="mt-1 text-xs text-zinc-400 text-right">
        {text.length}/{MAX_COLLECTION_NOTES_LENGTH}
      </p>
    </section>
  );
}

export default CollaborativeNotes;
