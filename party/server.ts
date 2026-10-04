import type * as Party from "partykit/server";
import { onConnect as onConnectYjs } from "y-partykit";

/** Yjs rooms for collaborative collection notes: `folder-notes-{folderId}` (#3360). */
export const FOLDER_NOTES_ROOM_PREFIX = "folder-notes-";

/** Folder id for `folder-{id}` and `folder-notes-{id}` rooms (other rooms: the room id). */
export function folderIdFromRoom(roomId: string): string {
  if (roomId.startsWith(FOLDER_NOTES_ROOM_PREFIX)) return roomId.slice(FOLDER_NOTES_ROOM_PREFIX.length);
  if (roomId.startsWith("folder-")) return roomId.slice("folder-".length);
  return roomId;
}
import { verifyToken } from "@clerk/backend";

type SeatStatus = "green" | "yellow" | "red";

// Music genre options for the quick-select dropdown (issue #2077)
export type MusicGenre =
  "Lo-Fi" | "Jazz" | "Pop" | "Classical" | "None" | "Loud";

const VALID_MUSIC_GENRES: readonly MusicGenre[] = [
  "Lo-Fi",
  "Jazz",
  "Pop",
  "Classical",
  "None",
  "Loud",
];

interface SeatCheckin {
  venueId: string;
  capacity: number;
  checkedInAt: number;
  version: number;
}

// Tracks the current music genre reported by any checked-in user at a venue
interface VenueMusicState {
  genre: MusicGenre;
  updatedAt: number;
  reportedByConnId: string;
}

// Venues we don't have real capacity data for yet still need a sensible
// ring colour, so fall back to this when a check-in doesn't supply one.
const DEFAULT_SEAT_CAPACITY = 8;

function seatStatusFor(count: number, capacity: number): SeatStatus {
  if (capacity <= 0) return "red";
  const ratio = count / capacity;
  if (ratio >= 1) return "red";
  if (ratio >= 0.6) return "yellow";
  return "green";
}

export interface ReplayableSessionEvent {
  sequenceId: number;
  epoch: number;
  messageId: string;
  type: string;
  payload: any;
  timestamp: number;
  senderId?: string;
}

export interface PresenceUser {
  userId: string;
  userName: string;
  avatarUrl?: string;
  cursorPosition?: number | null;
  isTyping?: boolean;
  lastActive: number;
}

/** Distributed seat-hold lock representation (#3522) */
export interface SeatHold {
  seatId: string;
  venueId: string;
  userId: string;
  userName?: string;
  connId: string;
  heldAt: number;
  expiresAt: number;
  version: number;
}

/** Default seat-hold lock TTL (5 minutes in milliseconds) (#3522) */
export const DEFAULT_SEAT_HOLD_TTL_MS = 5 * 60 * 1000;

export default class WorkspaceServer implements Party.Server {
  // Real-time seat availability layer (#703): one check-in per connection,
  // keyed by connection id so we can always find & clear a user's previous
  // check-in on check-in/checkout/disconnect without scanning every venue.
  private seatCheckins = new Map<string, SeatCheckin>();
  private seatCheckinLocks = new Set<string>(); // Prevents concurrent ops per connection
  private serverEpoch = Date.now();
  private sequenceId = 0;
  private eventHistory: ReplayableSessionEvent[] = [];
  private readonly maxHistorySize = 500;
  private processedMessageIds = new Set<string>();
  private readonly maxProcessedIds = 1000;

  // Real-time distributed seat-hold locks (#3522):
  // 5-minute TTL locks to prevent double-booking during checkout.
  // Keyed by `${venueId}:${seatId}`.
  private seatHolds = new Map<string, SeatHold>();
  private connHolds = new Map<string, Set<string>>(); // connId -> Set<holdKey>
  private seatHoldCleanupInterval?: ReturnType<typeof setInterval>;

  // Music genre state per venue (#2077): tracks the current reported genre
  // for each venueId. Overwritten on each update — last reporter wins.
  private venueMusic = new Map<string, VenueMusicState>();

  // Active typing presence protocol (#3438)
  private roomPresence = new Map<string, PresenceUser>();
  private presenceCleanupInterval?: ReturnType<typeof setInterval>;

  private heartbeatInterval?: ReturnType<typeof setInterval>;
  private connectionStates = new Map<
    string,
    { lastPong: number; name?: string; currentVenueId?: string }
  >();

  constructor(readonly room: Party.Room) {
    // 5-second sweep for active typing presence cleanup (>15s inactivity) (#3438)
    this.presenceCleanupInterval = setInterval(() => {
      this.pruneInactivePresence();
    }, 5000);

    // 2-second sweep for expired seat holds (Issue #3522)
    this.seatHoldCleanupInterval = setInterval(() => {
      this.pruneExpiredSeatHolds();
    }, 2000);

    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      for (const [connId, state] of this.connectionStates.entries()) {
        const conn = this.room.getConnection(connId);
        if (!conn) {
          // Connection already gone — prune ALL state for this connId so that
          // seatCheckins, connectionStates, and seatCheckinLocks don't accumulate
          // indefinitely after abrupt disconnects (Issue #1936).
          this.connectionStates.delete(connId);
          if (this.seatCheckins.has(connId)) {
            const prev = this.seatCheckins.get(connId)!;
            this.seatCheckins.delete(connId);
            this.broadcastSeatUpdate(prev.venueId);
          }
          this.seatCheckinLocks.delete(connId);
          continue;
        }

        if (now - state.lastPong >= 45000) {
          // 45-second timeout: broadcast departure and force-close stale socket
          if (state.name) {
            this.room.broadcast(
              JSON.stringify({ type: "peer-leave", name: state.name }),
            );
          }
          conn.close();
          this.connectionStates.delete(connId);
          if (this.seatCheckins.has(connId)) {
            const prev = this.seatCheckins.get(connId)!;
            this.seatCheckins.delete(connId);
            this.broadcastSeatUpdate(prev.venueId);
          }
          this.seatCheckinLocks.delete(connId);
        } else if (now - state.lastPong >= 10000) {
          conn.send(JSON.stringify({ type: "ping" }));
        }
      }
    }, 15000);
  }

  pruneInactivePresence(now: number = Date.now()): number {
    let pruned = 0;
    for (const [connId, presence] of this.roomPresence.entries()) {
      const conn = this.room.getConnection(connId);
      const isInactive = now - presence.lastActive > 15000;
      if (!conn || isInactive) {
        this.roomPresence.delete(connId);
        this.room.broadcast(
          JSON.stringify({
            type: "presence_remove",
            userId: presence.userId,
            userName: presence.userName,
            connId,
          }),
        );
        pruned++;
      }
    }
    return pruned;
  }

  getRoomPresence(): PresenceUser[] {
    return Array.from(this.roomPresence.values());
  }

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const url = new URL(ctx.request.url);
    const token = url.searchParams.get("token");

    let isViewer = false;
    let verifiedUserId: string | undefined;
    // Collection notes (#3360) hold private text: only folder members may join.
    const isFolderNotesRoom = this.room.id.startsWith(FOLDER_NOTES_ROOM_PREFIX);
    let isFolderMember = false;

    if (token) {
      try {
        const secretKey = process.env.CLERK_SECRET_KEY;
        const verifiedToken = await verifyToken(token, { secretKey });
        const userId = verifiedToken.sub;
        verifiedUserId = userId;

        // Canvas whiteboard rooms: any authenticated user can edit
        if (this.room.id.startsWith("canvas-")) {
          isViewer = false;
        } else {
          const folderId = folderIdFromRoom(this.room.id);

          // Fetch user's role in the folder via Next.js internal API to avoid Edge Prisma errors
          const NEXT_PUBLIC_APP_URL =
            process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
          const sharedSecret =
            process.env.PARTYKIT_AUTH_SECRET || process.env.PARTYKIT_SHARED_SECRET;
          const authRes = await fetch(
            `${NEXT_PUBLIC_APP_URL}/api/partykit/auth?userId=${encodeURIComponent(userId)}&folderId=${encodeURIComponent(folderId)}`,
            // The auth route rejects calls without the shared secret; without
            // this header every lookup failed and all users became viewers.
            sharedSecret ? { headers: { Authorization: `Bearer ${sharedSecret}` } } : undefined,
          );

          if (authRes.ok) {
            const authData = await authRes.json();
            if (authData.role === "MEMBER" || authData.role === "VIEWER") {
              isViewer = true;
            }
            isFolderMember = authData.member === true || authData.role === "OWNER";
          } else {
            isViewer = true;
          }
        }
      } catch (err) {
        console.error("Token verification or DB fetch failed:", err);
        conn.close(4001, "Unauthorized: Token expired");
        return;
      }
    } else {
      isViewer = true;
    }

    if (isFolderNotesRoom && !isFolderMember) {
      conn.close(4003, "Forbidden: collection notes are limited to members");
      return;
    }

    conn.setState({
      role: isViewer ? "VIEWER" : "EDITOR",
      userId: verifiedUserId,
    });

    // Bring newly connected clients up to speed on current seat availability
    // (#703) so rings render correctly before any new check-in event fires.
    if (this.seatCheckins.size > 0) {
      this.sequenceId++;
      conn.send(
        JSON.stringify({
          type: "seat_snapshot",
          venues: this.seatSummary(),
          epoch: this.serverEpoch,
          sequenceId: this.sequenceId,
        }),
      );
    }

    // Check if client provided last acknowledged sequence on connection URL
    const lastSeqParam = url.searchParams.get("lastSeq");
    const epochParam = url.searchParams.get("epoch");
    if (lastSeqParam !== null) {
      const lastSeq = parseInt(lastSeqParam, 10);
      const epoch = epochParam ? parseInt(epochParam, 10) : undefined;
      if (!isNaN(lastSeq) && lastSeq > 0) {
        this.handleSyncRequest(conn, lastSeq, epoch);
      }
    }

    // Yjs connection for shared state (messages, markers)
    // Pass readOnly option so y-partykit automatically drops incoming updates
    onConnectYjs(
      conn,
      this.room,
      isFolderNotesRoom
        ? // Notes must outlive the room's in-memory lifetime (#3360);
          // y-partykit requires gc off when persisting.
          { gc: false, readOnly: isViewer, persist: { mode: "snapshot" } }
        : { gc: true, readOnly: isViewer },
    );

    this.connectionStates.set(conn.id, { lastPong: Date.now() });

    // Send initial presence state to newly connected client (#3438)
    if (this.roomPresence.size > 0) {
      conn.send(
        JSON.stringify({
          type: "presence_state",
          users: Array.from(this.roomPresence.values()),
        }),
      );
    }

    // Send active seat holds snapshot so new viewers immediately see held seats (#3522)
    if (this.seatHolds.size > 0) {
      this.sendSeatHoldsSnapshot(conn);
    }

    // Also handle simple presence via standard WebSockets
    conn.addEventListener("message", (event: { data: unknown }) => {
      try {
        const raw = event.data as string;
        if (raw.length > 10_240) return;

        const data = JSON.parse(raw);
        if (data.type === "presence" || data.type === "cursor") {
          const state = conn.state as { userId?: string } | null;
          if (!state?.userId || data.userId !== state.userId) return;
          if (typeof data.venueId !== "string") return;

          this.room.broadcast(raw, [conn.id]);
        }
      } catch {
        // Not JSON or other error, handled by Yjs
      }
    });
  }

  onMessage(message: string, sender: Party.Connection) {
    const state = sender.state as { role?: string; userId?: string };

    try {
      const parsed = JSON.parse(message);

      if (parsed.type === "typing") {
        this.room.broadcast(message, [sender.id]);
        return;
      }

      // Room awareness presence updates (#3438)
      if (parsed.type === "presence_update") {
        const presence: PresenceUser = {
          userId: String(
            parsed.userId || (sender.state as any)?.userId || sender.id,
          ),
          userName: String(
            parsed.userName ||
              (sender.state as any)?.name ||
              "Collaborator",
          ),
          avatarUrl: parsed.avatarUrl ? String(parsed.avatarUrl) : undefined,
          cursorPosition:
            typeof parsed.cursorPosition === "number"
              ? parsed.cursorPosition
              : null,
          isTyping: Boolean(parsed.isTyping),
          lastActive:
            typeof parsed.lastActive === "number"
              ? parsed.lastActive
              : Date.now(),
        };

        this.roomPresence.set(sender.id, presence);

        this.room.broadcast(
          JSON.stringify({
            type: "presence_update",
            ...presence,
            connId: sender.id,
          }),
          [sender.id],
        );
        return;
      }

      // Presence heartbeat (every 5s from client) (#3438)
      if (parsed.type === "presence_heartbeat") {
        const now = Date.now();
        const existing = this.roomPresence.get(sender.id);
        if (existing) {
          existing.lastActive = now;
          if (typeof parsed.cursorPosition === "number") {
            existing.cursorPosition = parsed.cursorPosition;
          }
          if (typeof parsed.isTyping === "boolean") {
            existing.isTyping = parsed.isTyping;
          }
        } else if (parsed.userId) {
          this.roomPresence.set(sender.id, {
            userId: String(parsed.userId),
            userName: String(parsed.userName || "Collaborator"),
            avatarUrl: parsed.avatarUrl ? String(parsed.avatarUrl) : undefined,
            cursorPosition:
              typeof parsed.cursorPosition === "number"
                ? parsed.cursorPosition
                : null,
            isTyping: Boolean(parsed.isTyping),
            lastActive: now,
          });
        }
        return;
      }

      if (
        parsed.type === "request_presence" ||
        parsed.type === "presence_sync"
      ) {
        sender.send(
          JSON.stringify({
            type: "presence_state",
            users: Array.from(this.roomPresence.values()),
          }),
        );
        return;
      }

      if (parsed.type === "sync_request") {
        const lastSeq = typeof parsed.lastSeq === "number" ? parsed.lastSeq : 0;
        const epoch = typeof parsed.epoch === "number" ? parsed.epoch : undefined;
        this.handleSyncRequest(sender, lastSeq, epoch);
        return;
      }

      if (parsed.type === "ack_seq") {
        const lastSeq = typeof parsed.lastSeq === "number" ? parsed.lastSeq : parsed.seq;
        sender.setState({
          ...((sender.state as Record<string, unknown>) ?? {}),
          lastAckSeq: lastSeq,
        });
        return;
      }

      // Deduplication for idempotent retry messages
      const msgId = parsed.messageId || parsed.message?.id;
      if (msgId) {
        if (this.processedMessageIds.has(msgId)) {
          sender.send(
            JSON.stringify({
              type: "msg_ack",
              messageId: msgId,
              status: "duplicate",
              sequenceId: this.sequenceId,
              epoch: this.serverEpoch,
            }),
          );
          return;
        }
        this.processedMessageIds.add(msgId);
        if (this.processedMessageIds.size > this.maxProcessedIds) {
          const oldest = this.processedMessageIds.values().next().value;
          if (oldest) this.processedMessageIds.delete(oldest);
        }
      }

      if (parsed.type === "ping") {
        sender.send(
          JSON.stringify({
            type: "pong",
            timestamp: parsed.timestamp,
          }),
        );
        return;
      }

      if (parsed.type === "pong") {
        const state = this.connectionStates.get(sender.id);
        if (state) {
          state.lastPong = Date.now();
        }
        return;
      }

      if (parsed.type === "cursor" && parsed.name) {
        const state = this.connectionStates.get(sender.id);
        if (state) {
          state.name = parsed.name;
        }
      }

      if (
        parsed.type === "request_room_snapshot" ||
        parsed.type === "request_snapshot"
      ) {
        const snapshotId = parsed.snapshotId || `snap-${Date.now()}`;
        sender.send(
          JSON.stringify({
            type: "room_snapshot_response",
            roomId: this.room.id,
            snapshotId,
            timestamp: Date.now(),
            seats: this.seatSummary(),
          }),
        );
        return;
      }

      // WebRTC signaling is allowed for VIEWERS, but `from` must match the
      // Clerk userId we verified on connect — never trust the client field alone.
      if (parsed.type === "webrtc-signal") {
        if (!state.userId || parsed.from !== state.userId) return;
        this.room.broadcast(message, [sender.id]);
        return;
      }

      // Spatial audio listener position updates are high-frequency ephemeral state,
      // allowed for all viewers/editors, but `userId` must match verified connection state.
      if (parsed.type === "spatial_listener_update") {
        if (!state.userId || parsed.userId !== state.userId) return;
        this.room.broadcast(message, [sender.id]);
        return;
      }

      // Distributed seat-hold locking protocol (#3522)
      if (
        parsed.type === "seat_hold_request" &&
        typeof parsed.seatId === "string" &&
        typeof parsed.venueId === "string"
      ) {
        this.handleSeatHoldRequest(
          sender,
          parsed.seatId,
          parsed.venueId,
          String(parsed.userId || state.userId || sender.id),
          parsed.userName ? String(parsed.userName) : (sender.state as any)?.name,
          typeof parsed.ttlMs === "number" ? parsed.ttlMs : undefined,
        );
        return;
      }

      if (
        parsed.type === "seat_release_request" &&
        typeof parsed.seatId === "string" &&
        typeof parsed.venueId === "string"
      ) {
        this.handleSeatReleaseRequest(
          sender,
          parsed.seatId,
          parsed.venueId,
          String(parsed.userId || state.userId || sender.id),
        );
        return;
      }

      if (
        parsed.type === "seat_checkout_complete" &&
        typeof parsed.seatId === "string" &&
        typeof parsed.venueId === "string"
      ) {
        this.handleSeatCheckoutComplete(sender, parsed.seatId, parsed.venueId);
        return;
      }

      if (parsed.type === "request_seat_holds") {
        const venueId = typeof parsed.venueId === "string" ? parsed.venueId : undefined;
        this.sendSeatHoldsSnapshot(sender, venueId);
        return;
      }

      // Seat availability check-in/checkout (#703). This is presence data,
      // not a document edit, so VIEWERS are allowed to use it too — it
      // deliberately skips the role gate below.
      if (
        parsed.type === "seat_checkin" &&
        typeof parsed.venueId === "string"
      ) {
        // Track which venue this connection is checked into (#2077)
        const connState = this.connectionStates.get(sender.id);
        if (connState) {
          connState.currentVenueId = parsed.venueId;
        }
        this.handleSeatCheckin(sender, parsed.venueId, parsed.capacity);
        return;
      }
      if (parsed.type === "seat_checkout") {
        const connState = this.connectionStates.get(sender.id);
        if (connState) {
          connState.currentVenueId = undefined;
        }
        this.handleSeatCheckout(sender);
        return;
      }

      // Music genre update (#2077): checked-in users can report the current
      // music playing at their venue. Validated against allowed genre list.
      if (
        parsed.type === "music_genre_update" &&
        typeof parsed.venueId === "string" &&
        typeof parsed.genre === "string"
      ) {
        this.handleMusicGenreUpdate(sender, parsed.venueId, parsed.genre);
        return;
      }

      // Prevent VIEWERS from broadcasting standard messages (like explicit map updates)
      if (state.role === "VIEWER") {
        return; // Drop the message
      }

      // Broadcast all other string messages to other clients
      // (Yjs handles ArrayBuffer messages automatically via onConnect)
      this.recordAndBroadcast(sender, parsed.type || "message", parsed, msgId);
    } catch {
      // Not JSON, ignore or broadcast if EDITOR
      if (state.role !== "VIEWER") {
        this.room.broadcast(message, [sender.id]);
      }
    }
  }

  // Clear a disconnecting user's seat check-in so they don't count toward
  // a venue's availability after they've left (#703).
  onClose(conn: Party.Connection) {
    this.connectionStates.delete(conn.id);
    this.handleSeatCheckout(conn);
    this.handleConnectionSeatHoldsCleanup(conn.id);

    if (this.roomPresence.has(conn.id)) {
      const presence = this.roomPresence.get(conn.id)!;
      this.roomPresence.delete(conn.id);
      this.room.broadcast(
        JSON.stringify({
          type: "presence_remove",
          userId: presence.userId,
          userName: presence.userName,
          connId: conn.id,
        }),
      );
    }
  }

  private handleSeatCheckin(
    conn: Party.Connection,
    venueId: string,
    capacity?: unknown,
  ) {
    const maxRetries = 3;
    const connId = conn.id;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Per-connection lock to prevent interleaved operations
      if (this.seatCheckinLocks.has(connId)) {
        // Another operation for this connection is in flight - wait and retry
        // In practice PartyKit processes sequentially, but this guards against edge cases
        continue;
      }

      this.seatCheckinLocks.add(connId);
      try {
        const previous = this.seatCheckins.get(connId);
        const expectedVersion = previous?.version ?? 0;
        const resolvedCapacity =
          typeof capacity === "number" && capacity > 0
            ? capacity
            : (previous?.capacity ?? DEFAULT_SEAT_CAPACITY);

        const newCheckin: SeatCheckin = {
          venueId,
          capacity: resolvedCapacity,
          checkedInAt: Date.now(),
          version: expectedVersion + 1,
        };

        // Optimistic lock: verify no concurrent modification
        const current = this.seatCheckins.get(connId);
        if (current && current.version !== expectedVersion) {
          continue; // Retry - concurrent modification detected
        }

        this.seatCheckins.set(connId, newCheckin);

        this.broadcastSeatUpdate(venueId);
        if (previous && previous.venueId !== venueId) {
          this.broadcastSeatUpdate(previous.venueId);
        }
        return;
      } finally {
        this.seatCheckinLocks.delete(connId);
      }
    }
    console.error("[Seat] Max retries exceeded for checkin", connId);
  }

  private handleSeatCheckout(conn: Party.Connection) {
    const maxRetries = 3;
    const connId = conn.id;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (this.seatCheckinLocks.has(connId)) {
        continue;
      }

      this.seatCheckinLocks.add(connId);
      try {
        const previous = this.seatCheckins.get(connId);
        if (!previous) return;

        // Optimistic lock check
        const current = this.seatCheckins.get(connId);
        if (current && current.version !== previous.version) {
          continue; // Retry
        }

        this.seatCheckins.delete(connId);
        this.broadcastSeatUpdate(previous.venueId);
        return;
      } finally {
        this.seatCheckinLocks.delete(connId);
      }
    }
    console.error("[Seat] Max retries exceeded for checkout", connId);
  }

  // Handles a music genre report from a checked-in user (#2077).
  // Validates the genre, stores it per venue, and broadcasts to all clients
  // so VenueCards update in real-time without a page refresh.
  private handleMusicGenreUpdate(
    conn: Party.Connection,
    venueId: string,
    genre: string,
  ) {
    // Only accept valid genres from the defined list — reject arbitrary strings
    const normalised = VALID_MUSIC_GENRES.find(
      (g) => g.toLowerCase() === genre.toLowerCase(),
    );
    if (!normalised) {
      conn.send(
        JSON.stringify({
          type: "music_genre_error",
          error: `Invalid genre. Must be one of: ${VALID_MUSIC_GENRES.join(", ")}`,
        }),
      );
      return;
    }

    // Only accept updates from users currently checked into this venue
    const connState = this.connectionStates.get(conn.id);
    if (connState?.currentVenueId !== venueId) {
      conn.send(
        JSON.stringify({
          type: "music_genre_error",
          error: "You must be checked in at this venue to report music genre.",
        }),
      );
      return;
    }

    const updatedAt = Date.now();
    this.venueMusic.set(venueId, {
      genre: normalised,
      updatedAt,
      reportedByConnId: conn.id,
    });

    // Broadcast the update to all connections so venue cards refresh instantly
    this.sequenceId++;
    this.room.broadcast(
      JSON.stringify({
        type: "music_genre_broadcast",
        venueId,
        genre: normalised,
        updatedAt,
        sequenceId: this.sequenceId,
      }),
    );
  }

  private countForVenue(venueId: string): number {
    let count = 0;
    for (const checkin of this.seatCheckins.values()) {
      if (checkin.venueId === venueId) count++;
    }
    return count;
  }

  private capacityForVenue(venueId: string): number {
    for (const checkin of this.seatCheckins.values()) {
      if (checkin.venueId === venueId) return checkin.capacity;
    }
    return DEFAULT_SEAT_CAPACITY;
  }

  private broadcastSeatUpdate(venueId: string) {
    const count = this.countForVenue(venueId);
    const capacity = this.capacityForVenue(venueId);
    const music = this.venueMusic.get(venueId);
    const seatMsg = {
      venueId,
      count,
      capacity,
      status: seatStatusFor(count, capacity),
      musicGenre: music?.genre ?? null,
      musicGenreUpdatedAt: music?.updatedAt ?? null,
    };
    this.recordAndBroadcast(null, "seat_update", seatMsg);
  }

  private recordAndBroadcast(
    sender: Party.Connection | null,
    type: string,
    payload: Record<string, unknown>,
    messageId?: string,
  ): ReplayableSessionEvent {
    this.sequenceId++;
    const resolvedMessageId =
      messageId ||
      (typeof payload.messageId === "string" ? payload.messageId : undefined) ||
      (typeof (payload as any).message?.id === "string"
        ? (payload as any).message.id
        : undefined) ||
      `evt-${this.serverEpoch}-${this.sequenceId}`;

    const enriched = {
      ...payload,
      type,
      epoch: this.serverEpoch,
      sequenceId: this.sequenceId,
      messageId: resolvedMessageId,
    };
    const wireMessage = JSON.stringify(enriched);

    const eventRecord: ReplayableSessionEvent = {
      sequenceId: this.sequenceId,
      epoch: this.serverEpoch,
      messageId: resolvedMessageId,
      type,
      payload: enriched,
      timestamp: Date.now(),
      senderId: sender?.id,
    };

    this.eventHistory.push(eventRecord);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    if (sender) {
      this.room.broadcast(wireMessage, [sender.id]);
    } else {
      this.room.broadcast(wireMessage);
    }

    return eventRecord;
  }

  private handleSyncRequest(
    conn: Party.Connection,
    lastSeq: number,
    clientEpoch?: number,
  ) {
    if (typeof clientEpoch === "number" && clientEpoch !== this.serverEpoch) {
      this.sendFullSyncFallback(conn, "epoch_mismatch");
      return;
    }

    if (lastSeq >= this.sequenceId) {
      conn.send(
        JSON.stringify({
          type: "sync_ack",
          epoch: this.serverEpoch,
          latestSeq: this.sequenceId,
          status: "synchronized",
        }),
      );
      return;
    }

    const oldestEvent = this.eventHistory[0];
    const oldestSeq = oldestEvent ? oldestEvent.sequenceId : this.sequenceId + 1;

    if (lastSeq + 1 < oldestSeq) {
      this.sendFullSyncFallback(conn, "history_unavailable");
      return;
    }

    const missedEvents = this.eventHistory.filter(
      (e) => e.sequenceId > lastSeq && e.sequenceId <= this.sequenceId,
    );

    conn.send(
      JSON.stringify({
        type: "sync_replay",
        epoch: this.serverEpoch,
        fromSeq: lastSeq + 1,
        toSeq: this.sequenceId,
        events: missedEvents.map((e) => e.payload),
      }),
    );
  }

  private sendFullSyncFallback(conn: Party.Connection, reason: string) {
    conn.send(
      JSON.stringify({
        type: "sync_fallback",
        reason,
        epoch: this.serverEpoch,
        latestSeq: this.sequenceId,
        seats: this.seatSummary(),
      }),
    );
  }

  private seatSummary() {
    const counts = new Map<string, number>();
    for (const checkin of this.seatCheckins.values()) {
      counts.set(checkin.venueId, (counts.get(checkin.venueId) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([venueId, count]) => {
      const capacity = this.capacityForVenue(venueId);
      const music = this.venueMusic.get(venueId);
      return {
        venueId,
        count,
        capacity,
        status: seatStatusFor(count, capacity),
        musicGenre: music?.genre ?? null,
        musicGenreUpdatedAt: music?.updatedAt ?? null,
      };
    });
  }

  /**
   * Sweeps expired seat holds and broadcasts unlock events (#3522).
   */
  pruneExpiredSeatHolds(now: number = Date.now()): number {
    let expiredCount = 0;
    for (const [holdKey, hold] of this.seatHolds.entries()) {
      if (now >= hold.expiresAt) {
        this.seatHolds.delete(holdKey);
        const userHolds = this.connHolds.get(hold.connId);
        if (userHolds) {
          userHolds.delete(holdKey);
          if (userHolds.size === 0) {
            this.connHolds.delete(hold.connId);
          }
        }
        this.sequenceId++;
        this.room.broadcast(
          JSON.stringify({
            type: "seat_unlocked",
            seatId: hold.seatId,
            venueId: hold.venueId,
            reason: "EXPIRED",
            timestamp: now,
            sequenceId: this.sequenceId,
          }),
        );
        expiredCount++;
      }
    }
    return expiredCount;
  }

  private handleSeatHoldRequest(
    conn: Party.Connection,
    seatId: string,
    venueId: string,
    userId: string,
    userName?: string,
    ttlMs: number = DEFAULT_SEAT_HOLD_TTL_MS,
  ) {
    this.pruneExpiredSeatHolds();

    const holdKey = `${venueId}:${seatId}`;
    const now = Date.now();
    const existing = this.seatHolds.get(holdKey);

    // If held by another user and not expired
    if (existing && now < existing.expiresAt && existing.userId !== userId) {
      conn.send(
        JSON.stringify({
          type: "seat_hold_rejected",
          seatId,
          venueId,
          reason: "ALREADY_HELD",
          heldBy: existing.userId,
          heldByName: existing.userName,
          expiresAt: existing.expiresAt,
          remainingMs: Math.max(0, existing.expiresAt - now),
        }),
      );
      return;
    }

    // Acquire or renew hold
    const clampedTtl = Math.min(Math.max(ttlMs, 10_000), 600_000);
    const expiresAt = now + clampedTtl;
    const version = (existing?.version ?? 0) + 1;

    const newHold: SeatHold = {
      seatId,
      venueId,
      userId,
      userName,
      connId: conn.id,
      heldAt: now,
      expiresAt,
      version,
    };

    this.seatHolds.set(holdKey, newHold);

    let connSet = this.connHolds.get(conn.id);
    if (!connSet) {
      connSet = new Set();
      this.connHolds.set(conn.id, connSet);
    }
    connSet.add(holdKey);

    this.sequenceId++;
    conn.send(
      JSON.stringify({
        type: "seat_hold_acquired",
        seatId,
        venueId,
        expiresAt,
        ttlMs: clampedTtl,
        version,
        sequenceId: this.sequenceId,
      }),
    );

    this.room.broadcast(
      JSON.stringify({
        type: "seat_locked",
        seatId,
        venueId,
        heldBy: userId,
        heldByName: userName,
        expiresAt,
        version,
        sequenceId: this.sequenceId,
      }),
    );
  }

  private handleSeatReleaseRequest(
    conn: Party.Connection,
    seatId: string,
    venueId: string,
    userId: string,
  ) {
    const holdKey = `${venueId}:${seatId}`;
    const existing = this.seatHolds.get(holdKey);
    if (!existing) return;

    if (existing.userId === userId || existing.connId === conn.id) {
      this.seatHolds.delete(holdKey);
      const connSet = this.connHolds.get(conn.id);
      if (connSet) {
        connSet.delete(holdKey);
        if (connSet.size === 0) {
          this.connHolds.delete(conn.id);
        }
      }

      this.sequenceId++;
      this.room.broadcast(
        JSON.stringify({
          type: "seat_unlocked",
          seatId,
          venueId,
          reason: "RELEASED",
          timestamp: Date.now(),
          sequenceId: this.sequenceId,
        }),
      );
    }
  }

  private handleSeatCheckoutComplete(
    _conn: Party.Connection,
    seatId: string,
    venueId: string,
  ) {
    const holdKey = `${venueId}:${seatId}`;
    const existing = this.seatHolds.get(holdKey);
    if (existing) {
      this.seatHolds.delete(holdKey);
      const connSet = this.connHolds.get(existing.connId);
      if (connSet) {
        connSet.delete(holdKey);
        if (connSet.size === 0) {
          this.connHolds.delete(existing.connId);
        }
      }
    }

    this.sequenceId++;
    this.room.broadcast(
      JSON.stringify({
        type: "seat_unlocked",
        seatId,
        venueId,
        reason: "CHECKOUT_COMPLETE",
        timestamp: Date.now(),
        sequenceId: this.sequenceId,
      }),
    );
  }

  private sendSeatHoldsSnapshot(conn: Party.Connection, venueId?: string) {
    this.pruneExpiredSeatHolds();
    const now = Date.now();
    const holds: Array<{
      seatId: string;
      venueId: string;
      heldBy: string;
      heldByName?: string;
      expiresAt: number;
      remainingMs: number;
    }> = [];

    for (const hold of this.seatHolds.values()) {
      if (now < hold.expiresAt && (!venueId || hold.venueId === venueId)) {
        holds.push({
          seatId: hold.seatId,
          venueId: hold.venueId,
          heldBy: hold.userId,
          heldByName: hold.userName,
          expiresAt: hold.expiresAt,
          remainingMs: Math.max(0, hold.expiresAt - now),
        });
      }
    }

    conn.send(
      JSON.stringify({
        type: "seat_holds_snapshot",
        venueId,
        holds,
      }),
    );
  }

  private handleConnectionSeatHoldsCleanup(connId: string) {
    const heldKeys = this.connHolds.get(connId);
    if (!heldKeys || heldKeys.size === 0) return;

    const now = Date.now();
    for (const holdKey of heldKeys) {
      const hold = this.seatHolds.get(holdKey);
      if (hold) {
        this.seatHolds.delete(holdKey);
        this.sequenceId++;
        this.room.broadcast(
          JSON.stringify({
            type: "seat_unlocked",
            seatId: hold.seatId,
            venueId: hold.venueId,
            reason: "DISCONNECTED",
            timestamp: now,
            sequenceId: this.sequenceId,
          }),
        );
      }
    }
    this.connHolds.delete(connId);
  }

  getActiveSeatHolds(venueId?: string): SeatHold[] {
    this.pruneExpiredSeatHolds();
    const now = Date.now();
    const result: SeatHold[] = [];
    for (const hold of this.seatHolds.values()) {
      if (now < hold.expiresAt && (!venueId || hold.venueId === venueId)) {
        result.push({ ...hold });
      }
    }
    return result;
  }
}
