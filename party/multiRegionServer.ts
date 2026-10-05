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
import { EdgeMeshSync } from "../src/lib/edge/edgeMeshSync";
import {
  generateHandoffToken,
  verifyHandoffToken,
} from "../src/lib/edge/edgeHandoff";

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

export interface ReplayableSessionEvent {
  sequenceId: number;
  epoch: number;
  messageId: string;
  type: string;
  payload: any;
  timestamp: number;
  senderId?: string;
}

export default class MultiRegionWorkspaceServer implements Party.Server {
  private seatCheckins = new Map<string, SeatCheckin>();
  private seatCheckinLocks = new Set<string>();
  private stateSync: DurableStateSync;
  private meshSync: EdgeMeshSync;
  private connRegions = new Map<string, Region>();
  private serverRegion: Region;
  private serverId: string;
  private serverEpoch = Date.now();
  private sequenceId = 0;
  private eventHistory: ReplayableSessionEvent[] = [];
  private readonly maxHistorySize = 500;
  private processedMessageIds = new Set<string>();
  private readonly maxProcessedIds = 1000;

  constructor(readonly room: Party.Room) {
    this.serverRegion = (process.env.PARTYKIT_REGION as Region) ?? "us-east";
    this.serverId = `${this.serverRegion}-${room.id}-${Date.now()}`;
    this.stateSync = new DurableStateSync(this.serverRegion);

    this.stateSync.setBroadcastFn((message) => {
      this.room.broadcast(message);
    });
    this.stateSync.startSync();

    // Initialize inter-server mesh sync
    this.meshSync = new EdgeMeshSync(this.serverId, this.serverRegion, {
      heartbeatIntervalMs: 10_000,
      syncIntervalMs: 5_000,
    });

    this.meshSync.setGetLocalStateFn(() => this.stateSync.serializeState());

    this.meshSync.setOnRemoteStateReceived((state, _sourceRegion) => {
      const remoteState = this.stateSync.deserializeState(
        JSON.stringify(state),
      );
      if (remoteState) {
        this.stateSync.mergeRemoteState(remoteState);
      }
    });

    // Connect to peer edge servers in the mesh
    const meshPeers = REGION_NODES.filter((n) => n.id !== this.serverId).map(
      (n) => ({
        serverId: n.id,
        region: n.region as Region,
        host: n.host,
      }),
    );
    this.meshSync.start(meshPeers);
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
    let userId: string | undefined;

    if (token) {
      try {
        const secretKey = process.env.CLERK_SECRET_KEY;
        const verifiedToken = await verifyToken(token, { secretKey });
        userId = verifiedToken.sub;

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
      userId,
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
    // The snapshot goes to this connection only: stamp it with the latest
    // sequence number without consuming one, so every other client's stream
    // stays gapless.
    if (this.seatCheckins.size > 0) {
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
    const state = sender.state as { userId?: string; role?: string; region?: Region };

    try {
      const parsed = JSON.parse(message);

      if (parsed.type === "typing") {
        this.room.broadcast(message, [sender.id]);
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

      // Edge handoff: client requests a token to migrate to another region
      if (
        parsed.type === "edge_handoff_request" &&
        typeof parsed.targetRegion === "string"
      ) {
        this.handleHandoffRequest(sender, parsed.targetRegion as Region);
        return;
      }

      // Edge handoff: client presents a token from another region
      if (
        parsed.type === "edge_handoff_verify" &&
        typeof parsed.token === "string"
      ) {
        this.handleHandoffVerify(sender, parsed.token);
        return;
      }

      if (state.role === "VIEWER") return;

      this.recordAndBroadcast(sender, parsed.type || "message", parsed, msgId);
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

  // -----------------------------------------------------------------------
  // Edge Handoff Handlers
  // -----------------------------------------------------------------------

  private async handleHandoffRequest(
    conn: Party.Connection,
    targetRegion: Region,
  ): Promise<void> {
    const connState = conn.state as { userId?: string } | null;
    const userId = connState?.userId ?? conn.id;

    try {
      const token = await generateHandoffToken(
        userId,
        this.serverRegion,
        targetRegion,
      );

      // Find the optimal target node
      const targetNode = REGION_NODES.find((n) => n.region === targetRegion);

      conn.send(
        JSON.stringify({
          type: "edge_handoff_token",
          token,
          targetRegion,
          targetHost: targetNode?.host ?? null,
          sourceRegion: this.serverRegion,
        }),
      );
    } catch (err) {
      conn.send(
        JSON.stringify({
          type: "edge_handoff_error",
          error: `Failed to generate handoff token: ${err instanceof Error ? err.message : String(err)}`,
        }),
      );
    }
  }

  private async handleHandoffVerify(
    conn: Party.Connection,
    token: string,
  ): Promise<void> {
    const result = await verifyHandoffToken(token, this.serverRegion);

    if (!result.valid) {
      conn.send(
        JSON.stringify({
          type: "edge_handoff_rejected",
          error: result.error ?? "Invalid handoff token",
        }),
      );
      return;
    }

    const payload = result.payload!;

    // Accept the handoff — set connection state with transferred identity
    conn.setState({
      ...((conn.state as Record<string, unknown>) ?? {}),
      userId: payload.userId,
      region: payload.targetRegion,
      handoffFrom: payload.sourceRegion,
      handoffAt: Date.now(),
    });

    this.connRegions.set(conn.id, payload.targetRegion);

    // Send current state to the newly handed-off client
    const presenceState = this.stateSync.serializeState();
    conn.send(
      JSON.stringify({
        type: "edge_handoff_accepted",
        userId: payload.userId,
        sourceRegion: payload.sourceRegion,
        targetRegion: payload.targetRegion,
        presence: presenceState,
        seats: this.seatSummary(),
      }),
    );
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
    const seatMsg = {
      venueId,
      count,
      capacity,
      status: seatStatusFor(count, capacity),
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
      // The sender never receives its own event, but the event consumed a
      // sequence number. Report it so the sender's in-order tracking advances.
      try {
        sender.send(
          JSON.stringify({
            type: "msg_ack",
            messageId: resolvedMessageId,
            status: "processed",
            sequenceId: this.sequenceId,
            epoch: this.serverEpoch,
          }),
        );
      } catch {
        // Sender already disconnected; nothing to acknowledge.
      }
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
        presence: this.stateSync ? this.stateSync.serializeState() : null,
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
