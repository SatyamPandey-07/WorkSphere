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

export class HeartbeatMonitor {
  private nodes: Map<string, RegionNode>;
  private intervalId: NodeJS.Timeout | null;
  private timeoutThresholdMs: number;
  private listeners: ((event: HeartbeatEvent) => void)[];

  constructor(timeoutThresholdMs: number = 10000) {
    this.nodes = new Map();
    this.intervalId = null;
    this.timeoutThresholdMs = timeoutThresholdMs;
    this.listeners = [];
  }

  public addNode(node: RegionNode): void {
    this.nodes.set(node.id, { ...node, lastSeen: Date.now() });
    if (this.nodes.size === 1) {
      this.startMonitoring();
    }
  }

  public removeNode(nodeId: string): void {
    this.nodes.delete(nodeId);
    if (this.nodes.size === 0) {
      this.stopMonitoring();
    }
  }

  public recordHeartbeat(nodeId: string, latencyMs: number): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.lastSeen = Date.now();
      node.latencyMs = latencyMs;
      this.notifyListeners({ nodeId, status: 'alive', latencyMs, timestamp: Date.now() });
    }
  }

  private startMonitoring(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      this.checkHealth();
    }, 5000);
  }

  private stopMonitoring(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private checkHealth(): void {
    const now = Date.now();
    for (const [id, node] of this.nodes.entries()) {
      if (now - node.lastSeen > this.timeoutThresholdMs) {
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
