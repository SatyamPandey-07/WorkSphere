export type WsHealthState =
  | 'connecting'
  | 'healthy'
  | 'stalled'
  | 'reconnecting'
  | 'closed';

export type BackpressureDropPolicy = 'drop_oldest' | 'drop_newest';

export interface WsSocketLike {
  readyState: number;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
}

export interface OutboundFrame {
  id: string;
  data: string;
  enqueuedAtMs: number;
}

export interface WsLatencyStats {
  min: number | null;
  max: number | null;
  average: number | null;
  jitter: number | null;
  sampleCount: number;
}

export interface WsHeartbeatOptions {
  heartbeatIntervalMs?: number;
  pongTimeoutMs?: number;
  maxQueueSize?: number;
  dropPolicy?: BackpressureDropPolicy;
  baseReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  maxReconnectAttempts?: number;
  createSocket: () => WsSocketLike;
  onStateChange?: (state: WsHealthState, detail?: string) => void;
  onPing?: (socket: WsSocketLike) => void;
  isPongMessage?: (rawData: string) => boolean;
  onMessage?: (rawData: string) => void;
  nowFn?: () => number;
}

export class WsHeartbeatController {
  private readonly heartbeatIntervalMs: number;
  private readonly pongTimeoutMs: number;
  private readonly maxQueueSize: number;
  private readonly dropPolicy: BackpressureDropPolicy;
  private readonly baseReconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly maxReconnectAttempts: number;
  private readonly createSocket: () => WsSocketLike;
  private readonly onStateChange?: (state: WsHealthState, detail?: string) => void;
  private readonly onPing?: (socket: WsSocketLike) => void;
  private readonly isPongMessage: (rawData: string) => boolean;
  private readonly onMessage?: (rawData: string) => void;
  private readonly nowFn: () => number;

  private state: WsHealthState = 'closed';
  private socket: WsSocketLike | null = null;
  private outboundQueue: OutboundFrame[] = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private awaitingPong = false;
  private lastPingSentAtMs: number | null = null;
  private readonly rttHistory: number[] = [];
  private static readonly MAX_RTT_SAMPLES = 10;
  private reconnectAttempts = 0;
  private manuallyClosed = false;
  private disposed = false;

  constructor(options: WsHeartbeatOptions) {
    this.heartbeatIntervalMs = Math.max(100, options.heartbeatIntervalMs ?? 5_000);
    this.pongTimeoutMs = Math.max(100, options.pongTimeoutMs ?? 3_000);
    this.maxQueueSize = Math.max(1, Math.floor(options.maxQueueSize ?? 100));
    this.dropPolicy = options.dropPolicy ?? 'drop_oldest';
    this.baseReconnectDelayMs = Math.max(50, options.baseReconnectDelayMs ?? 500);
    this.maxReconnectDelayMs = Math.max(
      this.baseReconnectDelayMs,
      options.maxReconnectDelayMs ?? 10_000
    );
    this.maxReconnectAttempts = Math.max(0, options.maxReconnectAttempts ?? 8);
    this.createSocket = options.createSocket;
    this.onStateChange = options.onStateChange;
    this.onPing = options.onPing;
    this.isPongMessage =
      options.isPongMessage ?? ((raw) => raw === 'pong' || raw === '{"type":"pong"}');
    this.onMessage = options.onMessage;
    this.nowFn = options.nowFn ?? Date.now;
  }

  public getState(): WsHealthState {
    return this.state;
  }

  public getQueuedCount(): number {
    return this.outboundQueue.length;
  }

  public getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  /**
   * Returns a snapshot of rolling ping-pong RTT latency stats (over the last 10 samples).
   */
  public getLatencyStats(): WsLatencyStats {
    if (this.rttHistory.length === 0) {
      return {
        min: null,
        max: null,
        average: null,
        jitter: null,
        sampleCount: 0,
      };
    }

    const count = this.rttHistory.length;
    let min = this.rttHistory[0];
    let max = this.rttHistory[0];
    let sum = 0;

    for (let i = 0; i < count; i++) {
      const val = this.rttHistory[i];
      if (val < min) min = val;
      if (val > max) max = val;
      sum += val;
    }

    const average = Math.round((sum / count) * 100) / 100;

    let jitter: number;
    if (count <= 1) {
      jitter = 0;
    } else {
      let diffSum = 0;
      for (let i = 1; i < count; i++) {
        diffSum += Math.abs(this.rttHistory[i] - this.rttHistory[i - 1]);
      }
      jitter = Math.round((diffSum / (count - 1)) * 100) / 100;
    }

    return {
      min,
      max,
      average,
      jitter,
      sampleCount: count,
    };
  }

  private resetLatencyStats(): void {
    this.rttHistory.length = 0;
    this.lastPingSentAtMs = null;
  }

  private recordRtt(rttMs: number): void {
    const safeRtt = Math.max(0, Math.round(rttMs));
    this.rttHistory.push(safeRtt);
    if (this.rttHistory.length > WsHeartbeatController.MAX_RTT_SAMPLES) {
      this.rttHistory.shift();
    }
  }

  private setState(next: WsHealthState, detail?: string): void {
    if (this.state !== next) {
      this.state = next;
      this.onStateChange?.(next, detail);
    }
  }

  public connect(): void {
    if (this.disposed) return;
    this.manuallyClosed = false;
    this.awaitingPong = false;
    this.resetLatencyStats();
    this.stopHeartbeatLoop();
    this.clearPongTimer();
    this.clearReconnectTimer();
    this.setState('connecting');
    try {
      this.socket = this.createSocket();
    } catch (err) {
      if (this.disposed || this.manuallyClosed) return;
      this.setState('stalled', err instanceof Error ? err.message : 'Socket creation failed');
      this.scheduleReconnect();
    }
  }

  public handleOpen(): void {
    if (this.disposed || this.manuallyClosed) return;
    this.reconnectAttempts = 0;
    this.awaitingPong = false;
    this.clearPongTimer();
    this.setState('healthy');
    this.startHeartbeatLoop();
    this.flushQueue();
  }

  public handleIncomingMessage(rawData: string): void {
    if (this.disposed) return;
    if (this.isPongMessage(rawData)) {
      if (this.lastPingSentAtMs !== null) {
        const rtt = Math.max(0, this.nowFn() - this.lastPingSentAtMs);
        this.recordRtt(rtt);
        this.lastPingSentAtMs = null;
      }
      this.awaitingPong = false;
      this.clearPongTimer();
      if (this.state === 'stalled' || this.state === 'connecting') {
        this.setState('healthy');
      }
      return;
    }
    this.onMessage?.(rawData);
  }

  public handleSocketClose(reason = 'socket closed'): void {
    this.stopHeartbeatLoop();
    this.clearPongTimer();
    this.awaitingPong = false;
    this.lastPingSentAtMs = null;
    this.socket = null;
    if (this.disposed || this.manuallyClosed) {
      this.setState('closed', reason);
      return;
    }
    this.scheduleReconnect(reason);
  }

  public send(data: string, id?: string): boolean {
    if (this.disposed) return false;
    if (
      this.socket &&
      this.socket.readyState === 1 &&
      (this.state === 'healthy' || this.state === 'stalled')
    ) {
      try {
        this.socket.send(data);
        return true;
      } catch {
        this.enqueueFrame(data, id);
        this.handleSocketClose('send failure');
        return false;
      }
    }
    this.enqueueFrame(data, id);
    return false;
  }

  private enqueueFrame(data: string, id?: string): void {
    const frame: OutboundFrame = {
      id: id ?? `frame-${this.nowFn()}-${this.outboundQueue.length}`,
      data,
      enqueuedAtMs: this.nowFn(),
    };
    if (this.outboundQueue.length >= this.maxQueueSize) {
      if (this.dropPolicy === 'drop_oldest') {
        this.outboundQueue.shift();
        this.outboundQueue.push(frame);
      }
    } else {
      this.outboundQueue.push(frame);
    }
  }

  public flushQueue(): number {
    if (!this.socket || this.socket.readyState !== 1) return 0;
    let sent = 0;
    while (this.outboundQueue.length > 0) {
      const next = this.outboundQueue.shift();
      if (!next) break;
      try {
        this.socket.send(next.data);
        sent += 1;
      } catch {
        this.outboundQueue.unshift(next);
        break;
      }
    }
    return sent;
  }

  private startHeartbeatLoop(): void {
    this.stopHeartbeatLoop();
    this.heartbeatTimer = setInterval(() => {
      if (
        !this.socket ||
        this.socket.readyState !== 1 ||
        this.disposed ||
        this.manuallyClosed
      ) {
        return;
      }
      this.awaitingPong = true;
      this.lastPingSentAtMs = this.nowFn();
      try {
        if (this.onPing) {
          this.onPing(this.socket);
        } else {
          this.socket.send(JSON.stringify({ type: 'ping', ts: this.lastPingSentAtMs }));
        }
      } catch {
        this.handleSocketClose('ping send failed');
        return;
      }
      if (this.disposed || this.manuallyClosed) {
        return;
      }
      this.clearPongTimer();
      this.pongTimer = setTimeout(() => {
        this.pongTimer = null;
        if (this.awaitingPong && !this.disposed && !this.manuallyClosed) {
          this.awaitingPong = false;
          this.lastPingSentAtMs = null;
          this.setState('stalled', 'Missed pong heartbeat');
          this.scheduleReconnect('Pong timeout');
        }
      }, this.pongTimeoutMs);
    }, this.heartbeatIntervalMs);
  }

  private scheduleReconnect(reason = 'reconnecting'): void {
    if (this.disposed || this.manuallyClosed) return;
    this.clearReconnectTimer();
    this.stopHeartbeatLoop();
    this.clearPongTimer();
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setState('closed', 'Max reconnect attempts reached');
      return;
    }
    const delayMs = Math.min(
      this.maxReconnectDelayMs,
      this.baseReconnectDelayMs * Math.pow(2, this.reconnectAttempts)
    );
    this.reconnectAttempts += 1;
    this.setState('reconnecting', reason);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.disposed && !this.manuallyClosed) this.connect();
    }, delayMs);
  }

  private stopHeartbeatLoop(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearPongTimer(): void {
    if (this.pongTimer !== null) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  public disconnect(code = 1000, reason = 'manual disconnect'): void {
    this.manuallyClosed = true;
    this.awaitingPong = false;
    this.resetLatencyStats();
    this.stopHeartbeatLoop();
    this.clearPongTimer();
    this.clearReconnectTimer();
    if (this.socket) {
      try {
        this.socket.close(code, reason);
      } catch {}
      this.socket = null;
    }
    this.setState('closed', reason);
  }

  public dispose(): void {
    this.disposed = true;
    this.disconnect(1000, 'controller disposed');
    this.outboundQueue = [];
  }
}
