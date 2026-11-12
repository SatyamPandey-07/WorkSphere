import type * as Party from "partykit/server";

export type AgentState = "IDLE" | "PLANNING" | "EXECUTING" | "REPORTING";

export interface AgentHeartbeatPayload {
  agentId: string;
  agentName?: string;
  state: AgentState;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface ClientConnectionMessage {
  type: "SUBSCRIBE" | "UNSUBSCRIBE" | "HEARTBEAT";
  payload?: AgentHeartbeatPayload;
}

export default class AgentMonitorRoom implements Party.Server {
  constructor(readonly room: Party.Room) {}

  // In-memory store of active agent states per room instance
  private agentStates: Map<string, AgentHeartbeatPayload> = new Map();

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    // Send initial snapshot of current agent states to newly reconnected/connected client
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

      if (data.type === "HEARTBEAT" && data.payload) {
        const heartbeat = data.payload;
        // Update stored snapshot
        this.agentStates.set(heartbeat.agentId, heartbeat);

        // Broadcast state transition to all connected dashboard clients
        this.room.broadcast(
          JSON.stringify({
            type: "AGENT_HEARTBEAT_UPDATE",
            payload: heartbeat,
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