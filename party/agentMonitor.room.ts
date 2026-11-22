import type * as Party from "partykit/server";
import { verifyToken } from "@clerk/backend";

export type AgentState =
  | "IDLE"
  | "PLANNING"
  | "EXECUTING"
  | "REPORTING"
  | "OFFLINE"
  | "ERROR"
  | "TERMINATED";

export interface AgentConnectionState {
  agentId?: string;
  userId?: string;
  authenticated?: boolean;
}

export interface AgentHeartbeatPayload {
  agentId: string;
  agentName?: string;
  state: AgentState;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface ClientConnectionMessage {
  type: "SUBSCRIBE" | "UNSUBSCRIBE" | "HEARTBEAT" | "PRUNE_STALE";
  payload?: AgentHeartbeatPayload;
  agentId?: string;
}

export const DEFAULT_AGENT_HEARTBEAT_TIMEOUT_MS = 30_000; // 30 seconds
export const DEFAULT_AGENT_PURGE_TTL_MS = 300_000; // 5 minutes

export default class AgentMonitorRoom implements Party.Server {
  readonly room: Party.Room;
  private readonly heartbeatTimeoutMs: number;
  private readonly purgeTimeoutMs: number;

  // In-memory store of active agent states per room instance
  private agentStates: Map<string, AgentHeartbeatPayload> = new Map();

  // Maps WebSocket connection IDs to associated agent ID (if any)
  private connectionToAgentMap: Map<string, string> = new Map();

  constructor(
    room: Party.Room,
    options?: { heartbeatTimeoutMs?: number; purgeTimeoutMs?: number }
  ) {
    this.room = room;
    this.heartbeatTimeoutMs =
      options?.heartbeatTimeoutMs ?? DEFAULT_AGENT_HEARTBEAT_TIMEOUT_MS;
    this.purgeTimeoutMs =
      options?.purgeTimeoutMs ?? DEFAULT_AGENT_PURGE_TTL_MS;
  }

  /**
   * Retrieves all current in-memory agent states.
   */
  getAgentStates(): AgentHeartbeatPayload[] {
    return Array.from(this.agentStates.values());
  }

  /**
   * Sweeps active agent states: transitions timed-out active agents to OFFLINE,
   * and evicts records exceeding the purge TTL.
   */
  pruneStaleAgents(now: number = Date.now()): {
    expired: string[];
    purged: string[];
  } {
    const expired: string[] = [];
    const purged: string[] = [];

    for (const [agentId, heartbeat] of this.agentStates.entries()) {
      const age = now - heartbeat.timestamp;

      if (age > this.purgeTimeoutMs) {
        this.agentStates.delete(agentId);
        purged.push(agentId);
        this.room.broadcast(
          JSON.stringify({
            type: "AGENT_PURGED",
            payload: { agentId },
          })
        );
      } else if (
        age > this.heartbeatTimeoutMs &&
        heartbeat.state !== "OFFLINE" &&
        heartbeat.state !== "TERMINATED"
      ) {
        heartbeat.state = "OFFLINE";
        heartbeat.timestamp = now;
        expired.push(agentId);
        this.room.broadcast(
          JSON.stringify({
            type: "AGENT_HEARTBEAT_UPDATE",
            payload: heartbeat,
          })
        );
      }
    }

    return { expired, purged };
  }

  async onConnect(conn: Party.Connection<AgentConnectionState>, ctx: Party.ConnectionContext) {
    // If request contains an auth token, perform asynchronous authentication handshake
    if (ctx?.request?.url) {
      try {
        const url = new URL(ctx.request.url);
        const token = url.searchParams.get("token");
        const queryAgentId = url.searchParams.get("agentId") || undefined;

        if (token) {
          const secretKey = process.env.CLERK_SECRET_KEY;
          const verified = await verifyToken(token, { secretKey });

          // If connection closed while verification was in flight, abort cleanly
          if (conn.readyState !== undefined && conn.readyState !== 1) {
            return;
          }

          conn.setState({
            authenticated: true,
            userId: verified?.sub,
            agentId: queryAgentId,
          });

          if (queryAgentId) {
            this.connectionToAgentMap.set(conn.id, queryAgentId);
          }
        }
      } catch (_err) {
        conn.close(4001, "Unauthorized: Token verification failed");
        return;
      }
    }

    // Ensure socket is still open before continuing or dispatching snapshots
    if (conn.readyState !== undefined && conn.readyState !== 1) {
      return;
    }

    // Proactively prune stale states so the connecting client receives accurate snapshot
    this.pruneStaleAgents();

    const currentStates = Array.from(this.agentStates.values());
    conn.send(
      JSON.stringify({
        type: "INITIAL_STATE",
        payload: {
          agents: currentStates,
          connectedClients: Array.from(this.room.getConnections()).length,
        },
      })
    );
  }

  async onMessage(message: string | ArrayBuffer, sender: Party.Connection) {
    if (typeof message !== "string") return;

    try {
      const data: ClientConnectionMessage = JSON.parse(message);

      if (data.type === "HEARTBEAT" && data.payload && data.payload.agentId) {
        const heartbeat = data.payload;
        // Associate connection with agent ID
        this.connectionToAgentMap.set(sender.id, heartbeat.agentId);

        // Update stored snapshot
        this.agentStates.set(heartbeat.agentId, heartbeat);

        // Broadcast state transition to all connected dashboard clients
        this.room.broadcast(
          JSON.stringify({
            type: "AGENT_HEARTBEAT_UPDATE",
            payload: heartbeat,
          })
        );
      } else if (data.type === "UNSUBSCRIBE") {
        const targetAgentId =
          data.agentId ||
          data.payload?.agentId ||
          this.connectionToAgentMap.get(sender.id);

        if (targetAgentId && this.agentStates.has(targetAgentId)) {
          const existing = this.agentStates.get(targetAgentId)!;
          existing.state = "TERMINATED";
          existing.timestamp = Date.now();

          this.room.broadcast(
            JSON.stringify({
              type: "AGENT_HEARTBEAT_UPDATE",
              payload: existing,
            })
          );
        }

        this.connectionToAgentMap.delete(sender.id);
      } else if (data.type === "PRUNE_STALE") {
        const result = this.pruneStaleAgents();
        sender.send(
          JSON.stringify({
            type: "PRUNE_RESULT",
            payload: result,
          })
        );
      }
    } catch (err) {
      sender.send(
        JSON.stringify({
          type: "ERROR",
          message: "Invalid message payload format",
        })
      );
    }
  }

  async onClose(conn: Party.Connection) {
    // If the closing connection belonged to an active agent, transition to OFFLINE
    const associatedAgentId = this.connectionToAgentMap.get(conn.id);
    if (associatedAgentId) {
      this.connectionToAgentMap.delete(conn.id);
      const agentRecord = this.agentStates.get(associatedAgentId);
      if (
        agentRecord &&
        agentRecord.state !== "TERMINATED" &&
        agentRecord.state !== "OFFLINE"
      ) {
        agentRecord.state = "OFFLINE";
        agentRecord.timestamp = Date.now();

        this.room.broadcast(
          JSON.stringify({
            type: "AGENT_HEARTBEAT_UPDATE",
            payload: agentRecord,
          })
        );
      }
    }

    // Notify clients of updated presence count
    this.room.broadcast(
      JSON.stringify({
        type: "PRESENCE_UPDATE",
        payload: {
          connectedClients: Array.from(this.room.getConnections()).length,
        },
      })
    );
  }
}
