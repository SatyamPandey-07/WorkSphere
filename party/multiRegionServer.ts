/**
 * Multi-Region PartyKit Server
 *
 * Enhanced PartyKit server with edge geolocation routing, cross-region
 * state synchronization, and sub-30ms latency presence updates.
 */

import type * as Party from "partykit/server";
import { onConnect as onConnectYjs } from "y-partykit";
import { verifyToken } from "@clerk/backend";
import {
  type Region,
  type RegionNode,
  resolveRegion,
  extractGeoFromHeaders,
  selectBestNode,
} from "../src/lib/edge/geoRouter";
import { DurableStateSync } from "../src/lib/edge/stateSync";

type SeatStatus = "green" | "yellow" | "red";

interface SeatCheckin {
  venueId: string;
  capacity: number;
  checkedInAt: number;
  version: number;
}

const DEFAULT_SEAT_CAPACITY = 8;

function seatStatusFor(count: number, capacity: number): SeatStatus {
  if (capacity <= 0) return "red";
  const ratio = count / capacity;
  if (ratio >= 1) return "red";
  if (ratio >= 0.6) return "yellow";
  return "green";
}

const REGION_NODES: RegionNode[] = [
  {
    id: "us-east-1",
    region: "us-east",
    host: "us-east.worksphere.partykit.dev",
    port: 443,
    weight: 1,
    latencyMs: 15,
    lastHeartbeat: Date.now(),
  },
  {
    id: "us-west-1",
    region: "us-west",
    host: "us-west.worksphere.partykit.dev",
    port: 443,
    weight: 1,
    latencyMs: 12,
    lastHeartbeat: Date.now(),
  },
  {
    id: "eu-west-1",
    region: "eu-west",
    host: "eu-west.worksphere.partykit.dev",
    port: 443,
    weight: 1,
    latencyMs: 18,
    lastHeartbeat: Date.now(),
  },
  {
    id: "eu-central-1",
    region: "eu-central",
    host: "eu-central.worksphere.partykit.dev",
    port: 443,
    weight: 1,
    latencyMs: 14,
    lastHeartbeat: Date.now(),
  },
  {
    id: "ap-south-1",
    region: "ap-south",
    host: "ap-south.worksphere.partykit.dev",
    port: 443,
    weight: 1,
    latencyMs: 22,
    lastHeartbeat: Date.now(),
  },
  {
    id: "ap-northeast-1",
    region: "ap-northeast",
    host: "ap-northeast.worksphere.partykit.dev",
    port: 443,
    weight: 1,
    latencyMs: 20,
    lastHeartbeat: Date.now(),
  },
];

export default class MultiRegionWorkspaceServer implements Party.Server {
  private seatCheckins = new Map<string, SeatCheckin>();
  private seatCheckinLocks = new Set<string>();
  private stateSync: DurableStateSync;
  private connRegions = new Map<string, Region>();
  private serverEpoch = Date.now();
  private sequenceId = 0;

  constructor(readonly room: Party.Room) {
    const region = (process.env.PARTYKIT_REGION as Region) ?? "us-east";
    this.stateSync = new DurableStateSync(region);

    this.stateSync.setBroadcastFn((message) => {
      this.room.broadcast(message);
    });
    this.stateSync.startSync();
  }

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const url = new URL(ctx.request.url);
    const token = url.searchParams.get("token");

    // Resolve client region from headers
    const geo = extractGeoFromHeaders(ctx.request.headers);
    const clientRegion = geo ? resolveRegion(geo) : "us-east";
    this.connRegions.set(conn.id, clientRegion);

    // Determine optimal node for the client
    const bestNode = selectBestNode(REGION_NODES, clientRegion);

    let isViewer = false;

    if (token) {
      try {
        const secretKey = process.env.CLERK_SECRET_KEY;
        const verifiedToken = await verifyToken(token, { secretKey });
        const userId = verifiedToken.sub;

        if (this.room.id.startsWith("canvas-")) {
          isViewer = false;
        } else {
          let folderId = this.room.id;
          if (folderId.startsWith("folder-")) {
            folderId = folderId.replace("folder-", "");
          }

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
      } catch {
        isViewer = true;
      }
    } else {
      isViewer = true;
    }

    conn.setState({
      role: isViewer ? "VIEWER" : "EDITOR",
      region: clientRegion,
    });

    // Send region info and optimal node to client
    conn.send(
      JSON.stringify({
        type: "region_info",
        clientRegion,
        optimalNode: bestNode
          ? { id: bestNode.id, region: bestNode.region, host: bestNode.host }
          : null,
        serverRegion: this.stateSync["state"].regionId,
      }),
    );

    // Bring newly connected clients up to speed
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

    // Send current cross-region presence
    const presenceState = this.stateSync.serializeState();
    conn.send(
      JSON.stringify({
        type: "presence_sync",
        state: presenceState,
      }),
    );

    // Yjs connection for shared state
    onConnectYjs(conn, this.room, {
      gc: true,
      readOnly: isViewer,
    });

    // Handle presence/cursor messages with cross-region sync
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

          if (data.type === "cursor" && data.venueId) {
            this.stateSync.updatePresence(
              conn.id,
              data.venueId,
              data.cursor ?? null,
            );
          }
        }

        if (data.type === "cross_region_sync") {
          if (!data.sourceRegion || typeof data.sourceRegion !== "string")
            return;
          const remoteState = this.stateSync.deserializeState(
            data.state as string,
          );
          if (remoteState) {
            this.stateSync.mergeRemoteState(remoteState);
          }
        }
      } catch {
        // Handled by Yjs
      }
    });
  }

  onMessage(message: string, sender: Party.Connection) {
    const state = sender.state as { role?: string };

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
            presence: this.stateSync.serializeState(),
          }),
        );
        return;
      }

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

      if (state.role === "VIEWER") return;

      this.room.broadcast(message, [sender.id]);
    } catch {
      if (state.role !== "VIEWER") {
        this.room.broadcast(message, [sender.id]);
      }
    }
  }

  onClose(conn: Party.Connection) {
    this.handleSeatCheckout(conn);
    this.stateSync.removePresence(conn.id);
    this.connRegions.delete(conn.id);
  }

  private handleSeatCheckin(
    conn: Party.Connection,
    venueId: string,
    capacity?: unknown,
  ) {
    const maxRetries = 3;
    const connId = conn.id;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (this.seatCheckinLocks.has(connId)) {
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

        const current = this.seatCheckins.get(connId);
        if (current && current.version !== expectedVersion) {
          continue;
        }

        this.seatCheckins.set(connId, newCheckin);

        this.stateSync.updatePresence(connId, venueId, null);

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

        const current = this.seatCheckins.get(connId);
        if (current && current.version !== previous.version) {
          continue;
        }

        this.seatCheckins.delete(connId);
        this.stateSync.removePresence(connId, previous.venueId);
        this.broadcastSeatUpdate(previous.venueId);
        return;
      } finally {
        this.seatCheckinLocks.delete(connId);
      }
    }
    console.error("[Seat] Max retries exceeded for checkout", connId);
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
