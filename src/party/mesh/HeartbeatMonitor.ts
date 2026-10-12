/**
 * HeartbeatMonitor.ts
 * Tracks the health and availability of sibling regional nodes.
 * Sends periodic pings and marks nodes as offline if they fail to respond within the threshold.
 */

import { RegionNode } from './RegionRouter';

export interface HeartbeatEvent {
  nodeId: string;
  status: 'alive' | 'dead';
  latencyMs: number;
  timestamp: number;
}

export interface NodeRttStats {
  srtt: number;
  rttvar: number;
  rto: number;
  heartbeatIntervalMs: number;
}

export interface HeartbeatMonitorOptions {
  timeoutThresholdMs?: number;
  minIntervalMs?: number;
  maxIntervalMs?: number;
  minTimeoutMs?: number;
  maxTimeoutMs?: number;
  defaultIntervalMs?: number;
  clockGranularityMs?: number;
  alpha?: number;
  beta?: number;
  k?: number;
}

export class HeartbeatMonitor {
  private nodes: Map<string, RegionNode>;
  private rttStats: Map<string, NodeRttStats>;
  private intervalId: NodeJS.Timeout | null;
  private scheduledInterval: number;
  private lastScheduleTime: number;
  private timeoutThresholdMs: number;
  private defaultIntervalMs: number;
  private minIntervalMs: number;
  private maxIntervalMs: number;
  private minTimeoutMs: number;
  private maxTimeoutMs: number;
  private clockGranularityMs: number;
  private alpha: number;
  private beta: number;
  private k: number;
  private listeners: ((event: HeartbeatEvent) => void)[];

  constructor(
    timeoutOrOptions?: number | HeartbeatMonitorOptions,
    options?: HeartbeatMonitorOptions
  ) {
    this.nodes = new Map();
    this.rttStats = new Map();
    this.intervalId = null;
    this.scheduledInterval = 5000;
    this.lastScheduleTime = 0;
    this.listeners = [];

    const opts: HeartbeatMonitorOptions =
      typeof timeoutOrOptions === 'object' && timeoutOrOptions !== null
        ? timeoutOrOptions
        : { ...options, timeoutThresholdMs: typeof timeoutOrOptions === 'number' ? timeoutOrOptions : undefined };

    this.timeoutThresholdMs = opts.timeoutThresholdMs ?? 10000;
    this.defaultIntervalMs = opts.defaultIntervalMs ?? 5000;
    this.minIntervalMs = opts.minIntervalMs ?? 250;
    this.maxIntervalMs = opts.maxIntervalMs ?? 15000;
    this.minTimeoutMs = opts.minTimeoutMs ?? 500;
    this.maxTimeoutMs = opts.maxTimeoutMs ?? 30000;
    this.clockGranularityMs = opts.clockGranularityMs ?? 0;
    this.alpha = opts.alpha ?? 0.125;
    this.beta = opts.beta ?? 0.25;
    this.k = opts.k ?? 4;
  }

  public addNode(node: RegionNode): void {
    this.nodes.set(node.id, { ...node, lastSeen: Date.now(), isActive: true });
    if (!this.intervalId) {
      this.startMonitoring();
    } else {
      this.rescheduleIfNeeded();
    }
  }

  public removeNode(nodeId: string): void {
    this.nodes.delete(nodeId);
    this.rttStats.delete(nodeId);
    if (this.nodes.size === 0) {
      this.stopMonitoring();
    } else {
      this.rescheduleIfNeeded();
    }
  }

  public recordHeartbeat(nodeId: string, latencyMs: number): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.lastSeen = Date.now();
      node.latencyMs = latencyMs;
      node.isActive = true;

      // Jacobson-Karels RTT and jitter adaptation (RFC 6298)
      this.updateRttEstimator(nodeId, latencyMs);

      this.notifyListeners({ nodeId, status: 'alive', latencyMs, timestamp: Date.now() });
      this.rescheduleIfNeeded();
    }
  }

  private updateRttEstimator(nodeId: string, latencyMs: number): void {
    const prev = this.rttStats.get(nodeId);
    let srtt: number;
    let rttvar: number;

    if (!prev) {
      // First measurement: SRTT = R', RTTVAR = R' / 2
      srtt = latencyMs;
      rttvar = latencyMs / 2;
    } else {
      // Subsequent measurements:
      // RTTVAR = (1 - beta) * RTTVAR + beta * |SRTT - R'|
      // SRTT = (1 - alpha) * SRTT + alpha * R'
      const delta = Math.abs(prev.srtt - latencyMs);
      rttvar = (1 - this.beta) * prev.rttvar + this.beta * delta;
      srtt = (1 - this.alpha) * prev.srtt + this.alpha * latencyMs;
    }

    // RTO = SRTT + max(G, K * RTTVAR)
    const rawRto = srtt + Math.max(this.clockGranularityMs, this.k * rttvar);
    const rto = Math.min(Math.max(rawRto, this.minTimeoutMs), this.maxTimeoutMs);

    // ponytail: interval scaled to RTO / 2, clamped within bounds
    const rawInterval = Math.round(rto / 2);
    const heartbeatIntervalMs = Math.min(Math.max(rawInterval, this.minIntervalMs), this.maxIntervalMs);

    this.rttStats.set(nodeId, {
      srtt,
      rttvar,
      rto,
      heartbeatIntervalMs,
    });
  }

  public getHeartbeatInterval(nodeId?: string): number {
    if (nodeId) {
      return this.rttStats.get(nodeId)?.heartbeatIntervalMs ?? this.defaultIntervalMs;
    }
    if (this.nodes.size === 0) {
      return this.defaultIntervalMs;
    }
    let minInterval = Infinity;
    for (const id of this.nodes.keys()) {
      const stats = this.rttStats.get(id);
      const interval = stats ? stats.heartbeatIntervalMs : this.defaultIntervalMs;
      if (interval < minInterval) {
        minInterval = interval;
      }
    }
    return minInterval === Infinity ? this.defaultIntervalMs : minInterval;
  }

  public getTimeoutThreshold(nodeId?: string): number {
    if (nodeId) {
      return this.rttStats.get(nodeId)?.rto ?? this.timeoutThresholdMs;
    }
    return this.timeoutThresholdMs;
  }

  public getNodeRttStats(nodeId: string): NodeRttStats | undefined {
    const stats = this.rttStats.get(nodeId);
    if (!stats) return undefined;
    return { ...stats };
  }

  public startMonitoring(): void {
    if (this.intervalId) return;
    this.scheduleCheck();
  }

  public stopMonitoring(): void {
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }
  }

  private scheduleCheck(): void {
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }
    if (this.nodes.size === 0) return;

    const interval = this.getHeartbeatInterval();
    this.scheduledInterval = interval;
    this.lastScheduleTime = Date.now();

    this.intervalId = setTimeout(() => {
      this.checkHealth();
      this.scheduleCheck();
    }, interval);
  }

  private rescheduleIfNeeded(): void {
    if (!this.intervalId || this.nodes.size === 0) return;
    const currentInterval = this.getHeartbeatInterval();
    const elapsed = Date.now() - this.lastScheduleTime;
    const remaining = Math.max(0, this.scheduledInterval - elapsed);
    if (currentInterval < remaining) {
      this.scheduleCheck();
    }
  }

  public checkHealth(): void {
    const now = Date.now();
    for (const [id, node] of this.nodes.entries()) {
      const timeout = this.getTimeoutThreshold(id);
      if (now - node.lastSeen >= timeout) {
        if (node.isActive !== false) {
          node.isActive = false;
          this.notifyListeners({ nodeId: id, status: 'dead', latencyMs: node.latencyMs, timestamp: now });
        }
      }
    }
  }

  public onHeartbeat(callback: (event: HeartbeatEvent) => void): void {
    this.listeners.push(callback);
  }

  private notifyListeners(event: HeartbeatEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
