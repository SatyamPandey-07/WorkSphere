/**
 * partykitRoomManager.ts
 *
 * Resilient PartyKit room client with exponential backoff, full jitter,
 * connection state broadcasting, and CRDT delta state synchronization.
 * Handles network dropouts gracefully for nomadic workers switching connections.
 */

import { ConnectionLifecycleState } from "./connectionState";

export type ConnectionStatus = "connected" | "reconnecting" | "offline";

export interface SeatCheckin {
  seatId: string;
  userId: string;
  userName?: string;
  status: "OCCUPIED" | "AVAILABLE" | "HELD";
  timestamp: number;
  sequenceId: number;
}

export interface VenueRoomEvent {
  sequenceId: number;
  epoch: number;
  type: "seat_checkin" | "seat_checkout" | "seat_hold" | "seat_release";
  seat: SeatCheckin;
  timestamp: number;
}

export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState: number;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface PartykitRoomManagerOptions {
  host?: string;
  room: string;
  protocol?: "ws" | "wss";
  initialBackoffMs?: number; // Default 500ms
  maxBackoffMs?: number;     // Default 30,000ms (30s)
  maxRetries?: number;       // Default unlimited (0 = unlimited)
  socketFactory?: (url: string) => WebSocketLike;
  randomFn?: () => number;   // Injectable for deterministic tests
}

export interface ConnectionStateDetails {
  reconnectAttempts: number;
  nextRetryDelayMs?: number;
  lastSequenceId: number;
  epoch?: number;
}

export class PartykitRoomManager {
  private options: Required<PartykitRoomManagerOptions>;
  private socket: WebSocketLike | null = null;
  private state: ConnectionStatus = "offline";
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isManuallyClosed = false;

  // CRDT state synchronization
  private lastSequenceId = 0;
  private epoch = 0;
  private seats: Map<string, SeatCheckin> = new Map();

  // Listeners
  private stateListeners: Set<(state: ConnectionStatus, details: ConnectionStateDetails) => void> = new Set();
  private messageListeners: Set<(data: unknown) => void> = new Set();
  private syncListeners: Set<(events: VenueRoomEvent[]) => void> = new Set();

  private onlineHandler: (() => void) | null = null;
  private offlineHandler: (() => void) | null = null;

  constructor(options: PartykitRoomManagerOptions) {
    this.options = {
      host: options.host ?? (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_PARTYKIT_HOST ? process.env.NEXT_PUBLIC_PARTYKIT_HOST : "localhost:1999"),
      room: options.room,
      protocol: options.protocol ?? "wss",
      initialBackoffMs: options.initialBackoffMs ?? 500,
      maxBackoffMs: options.maxBackoffMs ?? 30000,
      maxRetries: options.maxRetries ?? 0,
      socketFactory: options.socketFactory ?? ((url: string) => new (globalThis as any).WebSocket(url)),
      randomFn: options.randomFn ?? Math.random,
    };

    this.setupNetworkListeners();
  }

  private setupNetworkListeners(): void {
    if (typeof window !== "undefined") {
      this.onlineHandler = () => {
        if (!this.isManuallyClosed && this.state !== "connected") {
          // Immediately attempt reconnection when network comes back online
          this.cancelScheduledReconnect();
          this.reconnectAttempts = 0;
          this.connect();
        }
      };

      this.offlineHandler = () => {
        if (this.state !== "offline") {
          this.cancelScheduledReconnect();
          this.transitionState("offline");
          if (this.socket) {
            try {
              this.socket.close();
            } catch {
              // Ignore close error
            }
          }
        }
      };

      window.addEventListener("online", this.onlineHandler);
      window.addEventListener("offline", this.offlineHandler);
    }
  }

  /**
   * Calculates exponential backoff with full jitter:
   * cap = min(maxBackoff, initialBackoff * 2^(attempt - 1))
   * delay = random(0, cap)
   */
  public calculateBackoffDelay(attempt: number = this.reconnectAttempts): number {
    const cappedExp = Math.min(
      this.options.maxBackoffMs,
      this.options.initialBackoffMs * Math.pow(2, Math.max(0, attempt - 1))
    );
    // Full jitter formula: random value between 0 and capped exponential
    const delay = Math.floor(this.options.randomFn() * cappedExp);
    return Math.max(0, delay);
  }

  public getUrl(): string {
    const proto = this.options.protocol === "wss" ? "wss" : "ws";
    const baseUrl = `${proto}://${this.options.host}/parties/venueRoom/${this.options.room}`;
    if (this.lastSequenceId > 0) {
      return `${baseUrl}?lastSeq=${this.lastSequenceId}&epoch=${this.epoch}`;
    }
    return baseUrl;
  }

  public connect(): void {
    this.isManuallyClosed = false;
    this.cancelScheduledReconnect();

    if (this.state === "offline") {
      this.transitionState("reconnecting");
    }

    try {
      const url = this.getUrl();
      this.socket = this.options.socketFactory(url);

      this.socket.onopen = () => {
        this.reconnectAttempts = 0;
        this.transitionState("connected");

        // On reconnection, request delta state vector if we have a previous sequence number
        if (this.lastSequenceId > 0) {
          this.requestDeltaSync();
        }
      };

      this.socket.onmessage = (event: { data: string }) => {
        try {
          const parsed = JSON.parse(event.data);
          this.handleIncomingMessage(parsed);
        } catch {
          // Ignore invalid JSON payloads
        }
      };

      this.socket.onclose = () => {
        if (!this.isManuallyClosed) {
          this.handleConnectionDrop();
        }
      };

      this.socket.onerror = () => {
        if (!this.isManuallyClosed) {
          this.handleConnectionDrop();
        }
      };
    } catch {
      this.handleConnectionDrop();
    }
  }

  private handleConnectionDrop(): void {
    if (this.isManuallyClosed) return;

    this.reconnectAttempts++;
    if (this.options.maxRetries > 0 && this.reconnectAttempts > this.options.maxRetries) {
      this.transitionState("offline");
      return;
    }

    const nextDelay = this.calculateBackoffDelay(this.reconnectAttempts);
    this.transitionState("reconnecting", nextDelay);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, nextDelay);
  }

  private cancelScheduledReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  public requestDeltaSync(): void {
    if (!this.socket || this.state !== "connected") return;

    this.socket.send(
      JSON.stringify({
        type: "sync_request",
        lastSeq: this.lastSequenceId,
        epoch: this.epoch,
      })
    );
  }

  private handleIncomingMessage(msg: any): void {
    if (!msg || typeof msg !== "object") return;

    // Track latest sequence ID
    if (typeof msg.sequenceId === "number") {
      this.lastSequenceId = Math.max(this.lastSequenceId, msg.sequenceId);
    }
    if (typeof msg.epoch === "number") {
      this.epoch = msg.epoch;
    }

    // Handle initial full snapshot
    if (msg.type === "seat_snapshot" && Array.isArray(msg.seats)) {
      this.seats.clear();
      for (const seat of msg.seats) {
        this.seats.set(seat.seatId, seat);
      }
      if (typeof msg.sequenceId === "number") {
        this.lastSequenceId = msg.sequenceId;
      }
      if (typeof msg.epoch === "number") {
        this.epoch = msg.epoch;
      }
    }

    // Handle CRDT delta state replay from server
    if (msg.type === "sync_replay" && Array.isArray(msg.events)) {
      this.reconcileDelta(msg.events);
      if (typeof msg.toSeq === "number") {
        this.lastSequenceId = Math.max(this.lastSequenceId, msg.toSeq);
      }
    }

    // Handle full state fallback (e.g. history gap or epoch mismatch)
    if (msg.type === "sync_fallback" && Array.isArray(msg.seats)) {
      this.seats.clear();
      for (const seat of msg.seats) {
        this.seats.set(seat.seatId, seat);
      }
      if (typeof msg.latestSeq === "number") {
        this.lastSequenceId = msg.latestSeq;
      }
      if (typeof msg.epoch === "number") {
        this.epoch = msg.epoch;
      }
    }

    // Handle incremental seat updates
    if (msg.type === "seat_update" && msg.event?.seat) {
      const event: VenueRoomEvent = msg.event;
      this.seats.set(event.seat.seatId, event.seat);
      if (typeof event.sequenceId === "number") {
        this.lastSequenceId = Math.max(this.lastSequenceId, event.sequenceId);
      }
    }

    // Notify listeners
    this.messageListeners.forEach((fn) => fn(msg));
  }

  /**
   * Reconciles missed events received via delta replay.
   */
  public reconcileDelta(events: VenueRoomEvent[]): void {
    const appliedEvents: VenueRoomEvent[] = [];

    // Sort missed events by CRDT sequence number
    const sorted = [...events].sort((a, b) => a.sequenceId - b.sequenceId);

    for (const evt of sorted) {
      if (evt.seat?.seatId) {
        this.seats.set(evt.seat.seatId, evt.seat);
        this.lastSequenceId = Math.max(this.lastSequenceId, evt.sequenceId);
        appliedEvents.push(evt);
      }
    }

    this.syncListeners.forEach((fn) => fn(appliedEvents));
  }

  public checkIn(seatId: string, userId: string, userName?: string): void {
    if (!this.socket || this.state !== "connected") {
      throw new Error("Cannot check in: PartyKit socket is not connected");
    }

    this.socket.send(
      JSON.stringify({
        type: "seat_checkin",
        seatId,
        userId,
        userName,
      })
    );
  }

  public checkOut(seatId: string, userId: string): void {
    if (!this.socket || this.state !== "connected") {
      throw new Error("Cannot check out: PartyKit socket is not connected");
    }

    this.socket.send(
      JSON.stringify({
        type: "seat_checkout",
        seatId,
        userId,
      })
    );
  }

  private transitionState(newState: ConnectionStatus, nextRetryDelayMs?: number): void {
    this.state = newState;
    const details: ConnectionStateDetails = {
      reconnectAttempts: this.reconnectAttempts,
      nextRetryDelayMs,
      lastSequenceId: this.lastSequenceId,
      epoch: this.epoch,
    };

    this.stateListeners.forEach((listener) => listener(newState, details));
  }

  public onStateChange(listener: (state: ConnectionStatus, details: ConnectionStateDetails) => void): () => void {
    this.stateListeners.add(listener);
    // Emit immediate current state
    listener(this.state, {
      reconnectAttempts: this.reconnectAttempts,
      lastSequenceId: this.lastSequenceId,
      epoch: this.epoch,
    });
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  public onMessage(listener: (data: unknown) => void): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  public onSync(listener: (events: VenueRoomEvent[]) => void): () => void {
    this.syncListeners.add(listener);
    return () => {
      this.syncListeners.delete(listener);
    };
  }

  public getState(): ConnectionStatus {
    return this.state;
  }

  public getLastSequenceId(): number {
    return this.lastSequenceId;
  }

  public getEpoch(): number {
    return this.epoch;
  }

  public getSeats(): Map<string, SeatCheckin> {
    return new Map(this.seats);
  }

  public getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  public disconnect(): void {
    this.isManuallyClosed = true;
    this.cancelScheduledReconnect();

    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // Ignore
      }
      this.socket = null;
    }

    this.transitionState("offline");

    if (typeof window !== "undefined") {
      if (this.onlineHandler) window.removeEventListener("online", this.onlineHandler);
      if (this.offlineHandler) window.removeEventListener("offline", this.offlineHandler);
    }
  }
}

export default PartykitRoomManager;
