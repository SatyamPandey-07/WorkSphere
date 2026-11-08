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

import {
  PARTY_SOCKET_RECONNECT_OPTIONS,
  PartyReconnectOptions,
  jitteredReconnectDelay,
  DEFAULT_BACKOFF_OPTIONS,
  BackoffOptions,
  calculateJitteredBackoff,
} from "@/lib/utils/backoff";
import {
  ConnectionLifecycleState,
  ConnectionState,
  mapPartySocketToLifecycleState,
  isConnectionAlive,
  isConnectionTransitioning,
} from "@/lib/realtime/connectionState";

export {
  PARTY_SOCKET_RECONNECT_OPTIONS,
  type PartyReconnectOptions,
  jitteredReconnectDelay,
  DEFAULT_BACKOFF_OPTIONS,
  type BackoffOptions,
  calculateJitteredBackoff,
  ConnectionLifecycleState,
  ConnectionState,
  mapPartySocketToLifecycleState,
  isConnectionAlive,
  isConnectionTransitioning,
};

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

/** Minimum wait before re-asking the server to fill the same sequence gap. */
const SYNC_RETRY_MS = 5_000;

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
  /** Sequence slots the server acknowledged to us that carry no payload for us. */
  private skippedSeqs = new Set<number>();
  private syncRequestedAt: number | null = null;
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

  /** True at most once per gap: the caller should then send `createSyncRequest()`. */
  private claimSyncRequest(now: number = Date.now()): boolean {
    if (this.syncRequestedAt !== null && now - this.syncRequestedAt < SYNC_RETRY_MS) {
      return false;
    }
    this.syncRequestedAt = now;
    return true;
  }

  /** Record that a sync_request is on the wire (e.g. the one sent on reconnect). */
  markSyncRequested(now: number = Date.now()): void {
    this.syncRequestedAt = now;
  }

  /** Forget an outstanding sync_request (socket closed, so no answer will come). */
  resetSyncRequest(): void {
    this.syncRequestedAt = null;
  }

  /**
   * Adopt `(epoch, seq)` as the ordering baseline. Used when this client has no
   * baseline yet (it just joined) or the server restarted (new epoch, sequence
   * numbers restarted). There is nothing earlier to wait for in either case.
   */
  private adoptBaseline(epoch: number, seq: number): void {
    if (this.lastEpoch !== null) {
      // Numbers buffered under the previous epoch mean nothing in the new one.
      this.pendingLiveEvents.clear();
      this.skippedSeqs.clear();
    }
    this.lastEpoch = epoch;
    this.lastSeq = seq;
    this.syncRequestedAt = null;
  }

  /**
   * Fast-forward to the server's reported position (sync_ack / sync_fallback)
   * and release anything that was buffered behind it.
   */
  settle(latestSeq?: number, epoch?: number): any[] {
    if (typeof epoch === "number" && epoch !== this.lastEpoch) {
      this.pendingLiveEvents.clear();
      this.skippedSeqs.clear();
      this.lastEpoch = epoch;
    }
    if (typeof latestSeq === "number") {
      this.lastSeq = latestSeq;
    }
    this.syncRequestedAt = null;
    this.isCatchingUp = false;
    return this.drainPendingLiveEvents();
  }

  handleSyncReplay(events: any[], toSeq?: number, epoch?: number): any[] {
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

    // The replay covers everything up to `toSeq`. Numbers in that range that
    // were not replayed (events this client sent itself, or ones that were
    // never part of the shared stream) are settled too; without this, a
    // trailing hole would block every live event buffered behind it.
    if (
      typeof toSeq === "number" &&
      toSeq > this.lastSeq &&
      (typeof epoch !== "number" || epoch === this.lastEpoch)
    ) {
      this.lastSeq = toSeq;
    }

    this.syncRequestedAt = null;
    this.isCatchingUp = false;
    const drained = this.drainPendingLiveEvents();
    return [...eventsToApply, ...drained];
  }

  handleLiveEvent(data: any): { shouldApply: boolean; event: any; needsSync?: boolean } {
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

    const epoch = typeof parsed.epoch === "number" ? parsed.epoch : null;
    if (epoch !== null && epoch !== this.lastEpoch) {
      // An older epoch is a straggler from a previous server instance.
      if (this.lastEpoch !== null && epoch < this.lastEpoch) {
        return { shouldApply: false, event: parsed };
      }
      // First event ever seen, or the server restarted and its sequence
      // numbers started over: there is no earlier event to wait for.
      this.adoptBaseline(epoch, seq);
      if (msgId) {
        this.markProcessed(msgId);
      }
      return { shouldApply: true, event: parsed };
    }

    if (seq <= this.lastSeq) {
      return { shouldApply: false, event: parsed };
    }

    if (this.isCatchingUp || seq > this.lastSeq + 1) {
      this.pendingLiveEvents.set(seq, parsed);
      // A real gap (not a replay already in flight): ask the server to fill it
      // instead of waiting for numbers that may never arrive.
      return {
        shouldApply: false,
        event: parsed,
        needsSync: !this.isCatchingUp && this.claimSyncRequest(),
      };
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

  /**
   * Handle the server's per-message acknowledgement. A `processed` ack tells the
   * sender where its own message landed in the shared stream. The sender is
   * excluded from the broadcast of its own event, so without this its in-order
   * tracking would see that number as a permanent gap.
   */
  handleAck(ack: any): { needsSync: boolean; drained: any[] } {
    const msgId = ack?.messageId;
    if (msgId) {
      // Our own message: never apply it again if a replay echoes it back.
      this.markProcessed(msgId);
    }

    const seq = ack?.sequenceId;
    if (ack?.status !== "processed" || typeof seq !== "number") {
      // A "duplicate" ack carries the server's current position, not a slot.
      return { needsSync: false, drained: [] };
    }

    const epoch = typeof ack.epoch === "number" ? ack.epoch : null;
    if (epoch !== null && epoch !== this.lastEpoch) {
      if (this.lastEpoch !== null && epoch < this.lastEpoch) {
        return { needsSync: false, drained: [] };
      }
      this.adoptBaseline(epoch, seq);
      return { needsSync: false, drained: this.drainPendingLiveEvents() };
    }

    if (seq <= this.lastSeq) {
      return { needsSync: false, drained: [] };
    }

    if (this.isCatchingUp || seq > this.lastSeq + 1) {
      this.skippedSeqs.add(seq);
      return { needsSync: !this.isCatchingUp && this.claimSyncRequest(), drained: [] };
    }

    this.lastSeq = seq;
    return { needsSync: false, drained: this.drainPendingLiveEvents() };
  }

  drainPendingLiveEvents(): any[] {
    // Anything at or below the current position is already settled.
    for (const seq of this.pendingLiveEvents.keys()) {
      if (seq <= this.lastSeq) this.pendingLiveEvents.delete(seq);
    }
    for (const seq of this.skippedSeqs) {
      if (seq <= this.lastSeq) this.skippedSeqs.delete(seq);
    }

    const drained: any[] = [];
    for (;;) {
      const nextSeq = this.lastSeq + 1;
      const nextEvent = this.pendingLiveEvents.get(nextSeq);

      if (nextEvent !== undefined) {
        this.pendingLiveEvents.delete(nextSeq);
        // The slot is consumed whether or not the event is a duplicate, so the
        // position must advance either way or the stream stalls on it.
        this.lastSeq = nextSeq;
        if (typeof nextEvent.epoch === "number") {
          this.lastEpoch = nextEvent.epoch;
        }

        const msgId = nextEvent.messageId || nextEvent.message?.id;
        if (msgId && this.hasProcessed(msgId)) {
          continue;
        }
        if (msgId) {
          this.markProcessed(msgId);
        }
        drained.push(nextEvent);
      } else if (this.skippedSeqs.delete(nextSeq)) {
        this.lastSeq = nextSeq;
      } else {
        break;
      }
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

  /** Ask the server to fill a sequence gap we detected (at most one in flight). */
  const requestSync = () => {
    if (originalSend && s.__worksphereState === ConnectionState.CONNECTED) {
      originalSend.call(s, resyncQueue.createSyncRequest());
    } else {
      resyncQueue.resetSyncRequest();
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
        const eventsToApply = resyncQueue.handleSyncReplay(
          parsed.events,
          parsed.toSeq,
          parsed.epoch,
        );
        flushQueues();
        for (const ev of eventsToApply) {
          dispatchToListeners(ev);
        }
        return;
      }

      if (parsed.type === "sync_ack") {
        const drained = resyncQueue.settle(parsed.latestSeq, parsed.epoch);
        flushQueues();
        for (const ev of drained) {
          dispatchToListeners(ev);
        }
        return;
      }

      if (parsed.type === "sync_fallback") {
        const drained = resyncQueue.settle(parsed.latestSeq, parsed.epoch);
        flushQueues();
        dispatchToListeners(parsed);
        for (const ev of drained) {
          dispatchToListeners(ev);
        }
        return;
      }

      // Per-message acknowledgement: tells the sender which sequence number its
      // own message took (it is excluded from the broadcast of that event).
      if (parsed.type === "msg_ack") {
        const { needsSync, drained } = resyncQueue.handleAck(parsed);
        if (needsSync) requestSync();
        for (const ev of drained) {
          dispatchToListeners(ev);
        }
        return;
      }

      const {
        shouldApply,
        event: filteredEvent,
        needsSync,
      } = resyncQueue.handleLiveEvent(parsed);
      if (needsSync) requestSync();
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
      resyncQueue.resetSyncRequest();
      if (resyncQueue.lastSeq > 0 && originalSend) {
        originalSend.call(s, resyncQueue.createSyncRequest());
        resyncQueue.markSyncRequested();
      } else {
        flushQueues();
      }
    });

    s.addEventListener("close", (event?: any) => {
      s.__worksphereState = ConnectionState.CLOSED;
      resyncQueue.isCatchingUp = false;
      resyncQueue.resetSyncRequest();
      s.__lastCloseCode = event?.code ?? null;
      s.__lastCloseReason = event?.reason ?? null;
    });

    s.addEventListener("error", () => {
      s.__worksphereState = ConnectionState.CLOSED;
      resyncQueue.isCatchingUp = false;
      resyncQueue.resetSyncRequest();
    });
  }

  if (typeof window !== "undefined") {
    let reconnectAbortController: AbortController | null = null;
    let onlineDebounceTimer: NodeJS.Timeout | null = null;
    let isTransitionLocked = false;

    const onlineHandler = () => {
      // 1. Cancel existing scheduled reconnection timers and abort previous controller
      if (onlineDebounceTimer) {
        clearTimeout(onlineDebounceTimer);
        onlineDebounceTimer = null;
      }
      if (reconnectAbortController) {
        reconnectAbortController.abort();
      }
      reconnectAbortController = new AbortController();
      const signal = reconnectAbortController.signal;

      // 2. Debounced connection state transition lock to coalesce rapid network flapping
      onlineDebounceTimer = setTimeout(() => {
        onlineDebounceTimer = null;
        if (signal.aborted) return;

        if (isTransitionLocked) return;
        isTransitionLocked = true;

        s._retryCount = 0;
        if (s.__worksphereState !== ConnectionState.CONNECTED) {
          (s as any).__worksphereForceReconnect?.();
        }

        setTimeout(() => {
          isTransitionLocked = false;
        }, 300);
      }, 150);
    };

    window.addEventListener("online", onlineHandler);

    const prevDisconnect = s._disconnect;
    s._disconnect = function (this: any, code?: number, reason?: string) {
      if (onlineDebounceTimer) {
        clearTimeout(onlineDebounceTimer);
        onlineDebounceTimer = null;
      }
      if (reconnectAbortController) {
        reconnectAbortController.abort();
        reconnectAbortController = null;
      }
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
