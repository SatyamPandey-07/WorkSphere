import type * as Party from "partykit/server";
import { onConnect as onConnectYjs } from "y-partykit";
import { verifyToken } from "@clerk/backend";

type SeatStatus = "green" | "yellow" | "red";

interface SeatCheckin {
  venueId: string;
  capacity: number;
  checkedInAt: number;
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

export default class WorkspaceServer implements Party.Server {
  // Real-time seat availability layer (#703): one check-in per connection,
  // keyed by connection id so we can always find & clear a user's previous
  // check-in on check-in/checkout/disconnect without scanning every venue.
  private seatCheckins = new Map<string, SeatCheckin>();
  private serverEpoch = Date.now();
  private sequenceId = 0;

  constructor(readonly room: Party.Room) {}

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const url = new URL(ctx.request.url);
    const token = url.searchParams.get("token");

    let isViewer = false;
    let verifiedUserId: string | undefined;

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
          // Extract folder ID if room is named "folder-{id}"
          let folderId = this.room.id;
          if (folderId.startsWith("folder-")) {
            folderId = folderId.replace("folder-", "");
          }

          // Fetch user's role in the folder via Next.js internal API to avoid Edge Prisma errors
          const NEXT_PUBLIC_APP_URL =
            process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
          const authRes = await fetch(
            `${NEXT_PUBLIC_APP_URL}/api/partykit/auth?userId=${userId}&folderId=${folderId}`,
          );

          if (authRes.ok) {
            const authData = await authRes.json();
            if (authData.role === "MEMBER" || authData.role === "VIEWER") {
              isViewer = true;
            }
          } else {
            isViewer = true;
          }
        }
      } catch (err) {
        console.error("Token verification or DB fetch failed:", err);
        isViewer = true;
      }
    } else {
      isViewer = true;
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

    // Yjs connection for shared state (messages, markers)
    // Pass readOnly option so y-partykit automatically drops incoming updates
    onConnectYjs(conn, this.room, {
      gc: true,
      readOnly: isViewer,
    });

    // Also handle simple presence via standard WebSockets
    conn.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data as string);
        if (data.type === "presence" || data.type === "cursor") {
          // Broadcast presence/cursor to everyone else in the room
          this.room.broadcast(event.data as string, [conn.id]);
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

      // Seat availability check-in/checkout (#703). This is presence data,
      // not a document edit, so VIEWERS are allowed to use it too — it
      // deliberately skips the role gate below.
      if (
        parsed.type === "seat_checkin" &&
        typeof parsed.venueId === "string"
      ) {
        this.handleSeatCheckin(sender, parsed.venueId, parsed.capacity);
        return;
      }
      if (parsed.type === "seat_checkout") {
        this.handleSeatCheckout(sender);
        return;
      }

      // Prevent VIEWERS from broadcasting standard messages (like explicit map updates)
      if (state.role === "VIEWER") {
        return; // Drop the message
      }

      // Broadcast all other string messages to other clients
      // (Yjs handles ArrayBuffer messages automatically via onConnect)
      this.room.broadcast(message, [sender.id]);
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
    this.handleSeatCheckout(conn);
  }

  private handleSeatCheckin(
    conn: Party.Connection,
    venueId: string,
    capacity?: unknown,
  ) {
    const previous = this.seatCheckins.get(conn.id);
    const resolvedCapacity =
      typeof capacity === "number" && capacity > 0
        ? capacity
        : (previous?.capacity ?? DEFAULT_SEAT_CAPACITY);

    this.seatCheckins.set(conn.id, {
      venueId,
      capacity: resolvedCapacity,
      checkedInAt: Date.now(),
    });

    this.broadcastSeatUpdate(venueId);
    // Also refresh the venue they just left, if any, since its count dropped.
    if (previous && previous.venueId !== venueId) {
      this.broadcastSeatUpdate(previous.venueId);
    }
  }

  private handleSeatCheckout(conn: Party.Connection) {
    const previous = this.seatCheckins.get(conn.id);
    if (!previous) return;
    this.seatCheckins.delete(conn.id);
    this.broadcastSeatUpdate(previous.venueId);
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
    this.sequenceId++;
    this.room.broadcast(
      JSON.stringify({
        type: "seat_update",
        venueId,
        count,
        capacity,
        status: seatStatusFor(count, capacity),
        epoch: this.serverEpoch,
        sequenceId: this.sequenceId,
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
      return {
        venueId,
        count,
        capacity,
        status: seatStatusFor(count, capacity),
      };
    });
  }
}
