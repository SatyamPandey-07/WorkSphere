/**
 * PartySocket Reconnection Protocol
 *
 * ### State Machine Transitions
 * | Current State  | Next State     | Trigger / Description |
 * | :------------- | :------------- | :-------------------- |
 * | `DISCONNECTED` | `CONNECTING`   | Initial connection attempt or manual connect call. |
 * | `CONNECTING`   | `CONNECTED`    | Connection established successfully. |
 * | `CONNECTING`   | `RECONNECTING` | Initial connection failed, attempting to retry. |
 * | `CONNECTED`    | `RECONNECTING` | Connection dropped unexpectedly. |
 * | `RECONNECTING` | `CONNECTING`   | Executing the next retry attempt. |
 * | `RECONNECTING` | `DISCONNECTED` | Max retries reached, giving up. |
 *
 * ### Configuration Options
 * - `maxRetries` (number): The maximum number of reconnection attempts before terminating the process.
 * - `initialDelayMs` / `minReconnectionDelay` (number): The base delay in milliseconds before the first reconnection attempt.
 * - `maxDelayMs` / `maxReconnectionDelay` (number): The maximum delay in milliseconds between reconnection attempts (used for backoff limits).
 *
 * ### Example: Custom Event Listener Binding
 * ```typescript
 * const socket = new PartySocket({ host: "localhost:8080" });
 *
 * // Bind a custom listener to track reconnection attempts
 * socket.addEventListener("reconnecting", (event) => {
 *   console.log(`Reconnecting... Attempt ${event.detail.attempt}`);
 * });
 * ```
 */

/**
 * Shared PartySocket reconnect tuning.
 *
 * Default partysocket uses infinite retries and a 0ms delay on the first
 * reconnect, which storms the server when the network interface flaps
 * (Wi‑Fi → cellular). Cap attempts and back off with jitter instead.
 */

export const PARTY_SOCKET_RECONNECT_OPTIONS = {
  maxRetries: 5,
  minReconnectionDelay: 1_000,
  maxReconnectionDelay: 30_000,
  reconnectionDelayGrowFactor: 2,
} as const;

export type PartyReconnectOptions = {
  maxRetries: number;
  minReconnectionDelay: number;
  maxReconnectionDelay: number;
  reconnectionDelayGrowFactor: number;
};

/**
 * Delay before reconnect attempt `retryCount`.
 * PartySocket increments retryCount before waiting; 0 is the initial connect.
 */
export function jitteredReconnectDelay(
  retryCount: number,
  opts: PartyReconnectOptions = PARTY_SOCKET_RECONNECT_OPTIONS,
  random: () => number = Math.random,
): number {
  if (retryCount <= 0) return 0;

  const { minReconnectionDelay: min, maxReconnectionDelay: max } = opts;
  const grow = opts.reconnectionDelayGrowFactor;
  const base = Math.min(max, min * grow ** (retryCount - 1));
  // ±20% jitter so clients don't retry in lockstep after a mass disconnect
  const jitter = base * (random() * 0.4 - 0.2);
  return Math.round(Math.min(max, Math.max(min, base + jitter)));
}

export enum ConnectionState {
  CLOSED = "CLOSED",
  CONNECTING = "CONNECTING",
  CONNECTED = "CONNECTED",
}

export interface ReplayableSessionEvent<T = any> {
  sequenceId: number;
  epoch: number;
  messageId: string;
  type: string;
  payload: T;
  timestamp: number;
  senderId?: string;
}

export interface SyncRequestMessage {
  type: "sync_request";
  lastSeq: number;
  epoch?: number;
  clientRegion?: string;
}

export interface SyncReplayMessage {
  type: "sync_replay";
  epoch: number;
  fromSeq: number;
  toSeq: number;
  events: any[];
}

export interface SyncAckMessage {
  type: "sync_ack";
  epoch: number;
  latestSeq: number;
  status: "synchronized";
}

export interface SyncFallbackMessage {
  type: "sync_fallback";
  reason: "epoch_mismatch" | "history_unavailable" | "invalid_sequence";
  epoch: number;
  latestSeq: number;
  seats?: any;
  presence?: any;
}

export interface MsgAckMessage {
  type: "msg_ack";
  messageId: string;
  status: "processed" | "duplicate";
  sequenceId: number;
  epoch: number;
}

export interface SessionResyncOptions {
  maxQueueSize?: number;
  maxProcessedIds?: number;
}

const NON_REPLAYABLE_TYPES = new Set([
  "cursor",
  "presence",
  "typing",
  "ping",
  "pong",
  "spatial_listener_update",
]);

/**
 * Manages client-side offline message queueing, sequence tracking,
 * ordered catch-up replay, and deduplication for PartyKit sessions.
 */
export class SessionResyncQueue {
  public lastSeq = 0;
  public lastEpoch: number | null = null;
  public isCatchingUp = false;
  private offlineActions: string[] = [];
  private offlineCrdt: any[] = [];
  private processedMessageIds = new Set<string>();
  private pendingLiveEvents = new Map<number, any>();
  private readonly maxQueueSize: number;
  private readonly maxProcessedIds: number;

  constructor(options: SessionResyncOptions = {}) {
    this.maxQueueSize = options.maxQueueSize ?? 100;
    this.maxProcessedIds = options.maxProcessedIds ?? 1000;
  }

  isEphemeral(data: any): boolean {
    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      return false;
    }
    if (typeof data === "string") {
      try {
        const parsed = JSON.parse(data);
        return NON_REPLAYABLE_TYPES.has(parsed.type);
      } catch {
        return false;
      }
    }
    return false;
  }

  enqueue(data: any): boolean {
    if (this.isEphemeral(data)) {
      return false;
    }

    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      if (this.offlineCrdt.length >= this.maxQueueSize) {
        this.offlineCrdt.shift();
      }
      this.offlineCrdt.push(data);
      return true;
    }

    if (this.offlineActions.length >= this.maxQueueSize) {
      this.offlineActions.shift();
    }
    this.offlineActions.push(data);
    return true;
  }

  getOfflineActions(): string[] {
    return this.offlineActions;
  }

  getOfflineCrdt(): any[] {
    return this.offlineCrdt;
  }

  hasPending(): boolean {
    return this.offlineCrdt.length > 0 || this.offlineActions.length > 0;
  }

  flush(sendFn: (data: any) => void): { crdtCount: number; actionsCount: number } {
    const crdtToSend = [...this.offlineCrdt];
    const actionsToSend = [...this.offlineActions];
    this.offlineCrdt.length = 0;
    this.offlineActions.length = 0;

    for (const msg of crdtToSend) {
      sendFn(msg);
    }
    for (const msg of actionsToSend) {
      sendFn(msg);
    }

    return { crdtCount: crdtToSend.length, actionsCount: actionsToSend.length };
  }

  hasProcessed(messageId: string): boolean {
    return this.processedMessageIds.has(messageId);
  }

  markProcessed(messageId: string): void {
    this.processedMessageIds.add(messageId);
    if (this.processedMessageIds.size > this.maxProcessedIds) {
      const oldest = this.processedMessageIds.values().next().value;
      if (oldest) this.processedMessageIds.delete(oldest);
    }
  }

  createSyncRequest(): string {
    return JSON.stringify({
      type: "sync_request",
      lastSeq: this.lastSeq,
      epoch: this.lastEpoch ?? undefined,
    });
  }

  handleSyncReplay(events: any[]): any[] {
    this.isCatchingUp = true;
    const sorted = [...events].sort((a, b) => {
      const seqA =
        typeof a === "object" && a !== null
          ? a.sequenceId ?? 0
          : typeof a === "string"
            ? (JSON.parse(a).sequenceId ?? 0)
            : 0;
      const seqB =
        typeof b === "object" && b !== null
          ? b.sequenceId ?? 0
          : typeof b === "string"
            ? (JSON.parse(b).sequenceId ?? 0)
            : 0;
      return seqA - seqB;
    });

    const eventsToApply: any[] = [];
    for (const raw of sorted) {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      const seq = parsed.sequenceId;
      const msgId = parsed.messageId || parsed.message?.id;

      if (msgId && this.hasProcessed(msgId)) {
        continue;
      }

      if (typeof seq === "number") {
        if (seq <= this.lastSeq && parsed.epoch === this.lastEpoch) {
          continue;
        }
        this.lastSeq = seq;
        if (typeof parsed.epoch === "number") {
          this.lastEpoch = parsed.epoch;
        }
      }

      if (msgId) {
        this.markProcessed(msgId);
      }
      eventsToApply.push(parsed);
    }

    this.isCatchingUp = false;
    const drained = this.drainPendingLiveEvents();
    return [...eventsToApply, ...drained];
  }

  handleLiveEvent(data: any): { shouldApply: boolean; event: any } {
    const parsed =
      typeof data === "string"
        ? (() => {
            try {
              return JSON.parse(data);
            } catch {
              return null;
            }
          })()
        : data;

    if (!parsed || typeof parsed !== "object") {
      return { shouldApply: true, event: data };
    }

    const seq = parsed.sequenceId;
    const msgId = parsed.messageId || parsed.message?.id;

    if (typeof seq !== "number") {
      return { shouldApply: true, event: parsed };
    }

    if (msgId && this.hasProcessed(msgId)) {
      return { shouldApply: false, event: parsed };
    }

    if (seq <= this.lastSeq && (parsed.epoch === this.lastEpoch || !this.lastEpoch)) {
      return { shouldApply: false, event: parsed };
    }

    if (this.isCatchingUp || seq > this.lastSeq + 1) {
      this.pendingLiveEvents.set(seq, parsed);
      return { shouldApply: false, event: parsed };
    }

    this.lastSeq = seq;
    if (typeof parsed.epoch === "number") {
      this.lastEpoch = parsed.epoch;
    }
    if (msgId) {
      this.markProcessed(msgId);
    }

    return { shouldApply: true, event: parsed };
  }

  drainPendingLiveEvents(): any[] {
    const drained: any[] = [];
    while (this.pendingLiveEvents.has(this.lastSeq + 1)) {
      const nextSeq = this.lastSeq + 1;
      const nextEvent = this.pendingLiveEvents.get(nextSeq);
      this.pendingLiveEvents.delete(nextSeq);

      const msgId = nextEvent.messageId || nextEvent.message?.id;
      if (msgId && this.hasProcessed(msgId)) {
        continue;
      }
      this.lastSeq = nextSeq;
      if (typeof nextEvent.epoch === "number") {
        this.lastEpoch = nextEvent.epoch;
      }
      if (msgId) {
        this.markProcessed(msgId);
      }
      drained.push(nextEvent);
    }
    return drained;
  }
}

type DelaySocket = {
  _retryCount: number;
  _getNextDelay: () => number;
  _connect?: () => void;
  _disconnect?: (code?: number, reason?: string) => void;
  _clearTimeouts?: () => void;
  _wait?: () => Promise<void>;
  addEventListener?: (
    event: string,
    callback: (...args: any[]) => void,
  ) => void;
  removeEventListener?: (
    event: string,
    callback: (...args: any[]) => void,
  ) => void;
  onmessage?: ((event: any) => void) | null;
  send?: (data: any) => void;
  __worksphereJitter?: boolean;
  __worksphereState?: ConnectionState;
  __lastCloseCode?: number | null;
  __lastCloseReason?: string | null;
  __offlineActionsQueue?: string[];
  __offlineCrdtQueue?: any[];
  __worksphereResyncQueue?: SessionResyncQueue;
  __worksphereForceReconnect?: () => void;
};

/** Swap in jittered backoff and session state resynchronization on a live PartySocket instance (idempotent). */
export function attachJitteredBackoff<T extends object>(socket: T): T {
  const s = socket as T & DelaySocket;
  if (s.__worksphereJitter) return socket;

  let pendingTimeoutId: any = null;
  let pendingResolve: (() => void) | null = null;
  s.__worksphereState = ConnectionState.CLOSED;
  s.__lastCloseCode = null;
  s.__lastCloseReason = null;

  const resyncQueue = new SessionResyncQueue();
  s.__worksphereResyncQueue = resyncQueue;
  s.__offlineActionsQueue = resyncQueue.getOfflineActions();
  s.__offlineCrdtQueue = resyncQueue.getOfflineCrdt();

  s._getNextDelay = function (this: DelaySocket) {
    return jitteredReconnectDelay(this._retryCount);
  };

  s._wait = function (this: any) {
    if (pendingTimeoutId) {
      clearTimeout(pendingTimeoutId);
    }
    return new Promise<void>((resolve) => {
      pendingResolve = resolve;
      pendingTimeoutId = setTimeout(() => {
        pendingTimeoutId = null;
        pendingResolve = null;
        resolve();
      }, this._getNextDelay());
    });
  };

  /** Skip any pending backoff sleep and reconnect right now. */
  s.__worksphereForceReconnect = function (this: any) {
    if (pendingTimeoutId) {
      clearTimeout(pendingTimeoutId);
      pendingTimeoutId = null;
    }
    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve();
    } else if (typeof this._connect === "function") {
      this._connect();
    }
  };
  const originalClearTimeouts = s._clearTimeouts;
  s._clearTimeouts = function (this: any) {
    if (pendingTimeoutId) {
      clearTimeout(pendingTimeoutId);
      pendingTimeoutId = null;
    }
    pendingResolve = null;
    if (originalClearTimeouts) {
      originalClearTimeouts.call(this);
    }
  };
  const originalDisconnect = s._disconnect;
  s._disconnect = function (this: any, code?: number, reason?: string) {
    s.__worksphereState = ConnectionState.CLOSED;
    resyncQueue.isCatchingUp = false;
    if (pendingTimeoutId) {
      clearTimeout(pendingTimeoutId);
      pendingTimeoutId = null;
    }
    pendingResolve = null;
    if (originalDisconnect) {
      originalDisconnect.call(this, code, reason);
    }
  };
  const originalConnect = s._connect;
  if (originalConnect) {
    s._connect = function (this: any) {
      if (
        s.__worksphereState === ConnectionState.CONNECTING ||
        s.__worksphereState === ConnectionState.CONNECTED
      ) {
        return;
      }
      s.__worksphereState = ConnectionState.CONNECTING;
      if (pendingTimeoutId) {
        clearTimeout(pendingTimeoutId);
        pendingTimeoutId = null;
      }
      originalConnect.call(this);
    };
  }

  const originalSend = s.send;
  if (originalSend) {
    s.send = function (this: any, data: any) {
      if (s.__worksphereState === ConnectionState.CONNECTED) {
        originalSend.call(this, data);
      } else {
        resyncQueue.enqueue(data);
      }
    };
  }

  const messageListeners = new Set<(event: any) => void>();

  const dispatchToListeners = (payload: any) => {
    const rawData = typeof payload === "string" ? payload : JSON.stringify(payload);
    const mockEvent = {
      type: "message",
      data: rawData,
      target: s,
    };
    for (const listener of messageListeners) {
      try {
        listener(mockEvent);
      } catch (err) {
        console.error("[PartySocketResync] Listener error:", err);
      }
    }
    if (typeof s.onmessage === "function") {
      try {
        s.onmessage(mockEvent);
      } catch (err) {
        console.error("[PartySocketResync] onmessage error:", err);
      }
    }
  };

  const flushQueues = () => {
    if (originalSend && resyncQueue.hasPending()) {
      resyncQueue.flush((msg) => {
        originalSend.call(s, msg);
      });
    }
  };

  const handleIncomingMessage = (event: any) => {
    const raw = typeof event?.data === "string" ? event.data : null;
    if (!raw) {
      dispatchToListeners(event?.data ?? event);
      return;
    }

    try {
      const parsed = JSON.parse(raw);

      if (parsed.type === "sync_replay" && Array.isArray(parsed.events)) {
        const eventsToApply = resyncQueue.handleSyncReplay(parsed.events);
        flushQueues();
        for (const ev of eventsToApply) {
          dispatchToListeners(ev);
        }
        return;
      }

      if (parsed.type === "sync_ack") {
        if (typeof parsed.latestSeq === "number") {
          resyncQueue.lastSeq = parsed.latestSeq;
        }
        if (typeof parsed.epoch === "number") {
          resyncQueue.lastEpoch = parsed.epoch;
        }
        flushQueues();
        const drained = resyncQueue.drainPendingLiveEvents();
        for (const ev of drained) {
          dispatchToListeners(ev);
        }
        return;
      }

      if (parsed.type === "sync_fallback") {
        if (typeof parsed.latestSeq === "number") {
          resyncQueue.lastSeq = parsed.latestSeq;
        }
        if (typeof parsed.epoch === "number") {
          resyncQueue.lastEpoch = parsed.epoch;
        }
        flushQueues();
        dispatchToListeners(parsed);
        return;
      }

      const { shouldApply, event: filteredEvent } = resyncQueue.handleLiveEvent(parsed);
      if (shouldApply) {
        dispatchToListeners(filteredEvent);
        const drained = resyncQueue.drainPendingLiveEvents();
        for (const ev of drained) {
          dispatchToListeners(ev);
        }
      }
    } catch {
      dispatchToListeners(raw);
    }
  };

  const originalAddEventListener = s.addEventListener;
  if (typeof originalAddEventListener === "function") {
    s.addEventListener = function (event: string, callback: (...args: any[]) => void) {
      if (event === "message") {
        messageListeners.add(callback);
        return;
      }
      originalAddEventListener.call(this, event, callback);
    };

    const originalRemoveEventListener = s.removeEventListener;
    s.removeEventListener = function (event: string, callback: (...args: any[]) => void) {
      if (event === "message") {
        messageListeners.delete(callback);
        return;
      }
      if (typeof originalRemoveEventListener === "function") {
        originalRemoveEventListener.call(this, event, callback);
      }
    };

    // Attach internal message listener to process incoming frames
    originalAddEventListener.call(s, "message", handleIncomingMessage);

    s.addEventListener("open", () => {
      s.__worksphereState = ConnectionState.CONNECTED;
      s._retryCount = 0;

      // If reconnecting with previous sequence history, request delta resync
      if (resyncQueue.lastSeq > 0 && originalSend) {
        originalSend.call(s, resyncQueue.createSyncRequest());
      } else {
        flushQueues();
      }
    });

    s.addEventListener("close", (event?: any) => {
      s.__worksphereState = ConnectionState.CLOSED;
      resyncQueue.isCatchingUp = false;
      s.__lastCloseCode = event?.code ?? null;
      s.__lastCloseReason = event?.reason ?? null;
    });

    s.addEventListener("error", () => {
      s.__worksphereState = ConnectionState.CLOSED;
      resyncQueue.isCatchingUp = false;
    });
  }

  if (typeof window !== "undefined") {
    const onlineHandler = () => {
      s._retryCount = 0;
      if (s.__worksphereState !== ConnectionState.CONNECTED) {
        (s as any).__worksphereForceReconnect?.();
      }
    };
    window.addEventListener("online", onlineHandler);

    const prevDisconnect = s._disconnect;
    s._disconnect = function (this: any, code?: number, reason?: string) {
      window.removeEventListener("online", onlineHandler);
      prevDisconnect?.call(this, code, reason);
    };
  }
  s.__worksphereJitter = true;
  return socket;
}

export interface RegionProbeConfig {
  regions: string[];
  pingTimeoutMs?: number;
}

export class PartySocketReconnectManager {
  private retryCount = 0;
  private config: PartyReconnectOptions & RegionProbeConfig;
  public currentRegion: string | null = null;
  public lastCloseCode: number | null = null;
  public lastCloseReason: string | null = null;

  constructor(config: Partial<PartyReconnectOptions> & RegionProbeConfig) {
    this.config = {
      ...PARTY_SOCKET_RECONNECT_OPTIONS,
      ...config,
      pingTimeoutMs: config.pingTimeoutMs ?? 3000,
    };
  }

  async probeRegion(region: string): Promise<number> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.pingTimeoutMs,
    );
    const start = Date.now();
    try {
      const url = region.startsWith("http") ? region : `https://${region}`;
      await fetch(url, {
        method: "HEAD",
        signal: controller.signal,
        mode: "no-cors",
      });
      return Date.now() - start;
    } catch {
      return Infinity;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getBestRegion(): Promise<string | null> {
    if (this.config.regions.length === 0) return null;
    if (this.config.regions.length === 1) return this.config.regions[0];

    const latencies = await Promise.all(
      this.config.regions.map(async (r) => {
        const lat = await this.probeRegion(r);
        return { region: r, lat };
      }),
    );

    const healthy = latencies.filter((l) => l.lat < Infinity);
    if (healthy.length === 0) return null;

    healthy.sort((a, b) => a.lat - b.lat);
    return healthy[0].region;
  }

  async onDisconnect(code?: number, reason?: string): Promise<string | null> {
    this.retryCount++;
    this.lastCloseCode = code ?? null;
    this.lastCloseReason = reason ?? null;

    if (code === 1008 || code === 1000) {
      return null;
    }

    if (this.retryCount > this.config.maxRetries) {
      return null;
    }

    const delay = jitteredReconnectDelay(this.retryCount, this.config);
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const bestRegion = await this.getBestRegion();
    if (bestRegion) {
      this.currentRegion = bestRegion;
    }
    return bestRegion;
  }

  onConnect(): void {
    this.retryCount = 0;
  }
}
