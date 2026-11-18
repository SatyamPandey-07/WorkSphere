/**
 * @file MeshTopologyCoordinator.ts
 * @description WebRTC Mesh Topology Self-Healing and Shortest-Path Routing Coordinator
 * for WorkSphere peer-to-peer real-time workspace collaboration.
 * Implements adaptive degree-constrained mesh formation, Tarjan's bridge detection,
 * Dijkstra latency-weighted routing, failure detection, and automatic partition self-healing.
 */

export interface PeerNode {
  id: string;
  isSupernode?: boolean;
  rttMs: number;
  lastHeartbeat: number;
  connectedAt: number;
  status: 'active' | 'degraded' | 'unresponsive';
}

export interface MeshLink {
  from: string;
  to: string;
  latencyMs: number;
  establishedAt: number;
}

export interface TopologyConfig {
  localPeerId: string;
  minDegree?: number;
  targetDegree?: number;
  maxDegree?: number;
  heartbeatTimeoutMs?: number;
  degradedThresholdMs?: number;
}

export interface ShortestPathResult {
  path: string[];
  totalLatencyMs: number;
  hopCount: number;
}

export interface TopologyHealth {
  totalPeers: number;
  activeLinks: number;
  localDegree: number;
  connectedComponents: number;
  bridges: [string, string][];
  graphDiameter: number;
  isPartitioned: boolean;
}

/**
 * WebRTC Mesh Topology Self-Healing Coordinator
 */
export class MeshTopologyCoordinator {
  private localPeerId: string;
  private minDegree: number;
  private targetDegree: number;
  private maxDegree: number;
  private heartbeatTimeoutMs: number;
  private degradedThresholdMs: number;

  // Known peer nodes in the workspace mesh
  private peers: Map<string, PeerNode> = new Map();

  // Adjacency graph: peerId -> Map<neighborId, latencyMs>
  private adjacency: Map<string, Map<string, number>> = new Map();

  constructor(config: TopologyConfig) {
    this.localPeerId = config.localPeerId;
    this.minDegree = config.minDegree ?? 3;
    this.targetDegree = config.targetDegree ?? 5;
    this.maxDegree = config.maxDegree ?? 8;
    this.heartbeatTimeoutMs = config.heartbeatTimeoutMs ?? 10000;
    this.degradedThresholdMs = config.degradedThresholdMs ?? 5000;

    // Register local peer node
    this.addPeerNode({
      id: this.localPeerId,
      isSupernode: false,
      rttMs: 0,
      lastHeartbeat: Date.now(),
      connectedAt: Date.now(),
      status: 'active'
    });
  }

  public getLocalPeerId(): string {
    return this.localPeerId;
  }

  public addPeerNode(node: PeerNode): void {
    this.peers.set(node.id, { ...node });
    if (!this.adjacency.has(node.id)) {
      this.adjacency.set(node.id, new Map());
    }
  }

  public removePeerNode(peerId: string): void {
    if (peerId === this.localPeerId) return; // Cannot remove local node

    this.peers.delete(peerId);
    this.adjacency.delete(peerId);

    // Remove all edges referencing this peer
    for (const neighbors of this.adjacency.values()) {
      neighbors.delete(peerId);
    }
  }

  public getPeer(peerId: string): PeerNode | undefined {
    return this.peers.get(peerId);
  }

  public getAllPeers(): PeerNode[] {
    return Array.from(this.peers.values());
  }

  /**
   * Adds or updates a bidirectional WebRTC mesh link between two peers
   */
  public addLink(from: string, to: string, latencyMs: number = 25): void {
    if (from === to) return;

    if (!this.adjacency.has(from)) this.adjacency.set(from, new Map());
    if (!this.adjacency.has(to)) this.adjacency.set(to, new Map());

    this.adjacency.get(from)!.set(to, Math.max(1, latencyMs));
    this.adjacency.get(to)!.set(from, Math.max(1, latencyMs));
  }

  /**
   * Removes a mesh link between two peers
   */
  public removeLink(from: string, to: string): void {
    this.adjacency.get(from)?.delete(to);
    this.adjacency.get(to)?.delete(from);
  }

  public getNeighbors(peerId: string): string[] {
    const map = this.adjacency.get(peerId);
    return map ? Array.from(map.keys()) : [];
  }

  public getLocalDegree(): number {
    return this.getNeighbors(this.localPeerId).length;
  }

  /**
   * Records a heartbeat reception from a peer, updating responsiveness and latency
   */
  public recordHeartbeat(peerId: string, rttMs: number, timestampMs: number = Date.now()): void {
    const peer = this.peers.get(peerId);
    if (!peer) {
      this.addPeerNode({
        id: peerId,
        rttMs,
        lastHeartbeat: timestampMs,
        connectedAt: timestampMs,
        status: 'active'
      });
      return;
    }

    // Smooth RTT with moving average (alpha = 0.3)
    peer.rttMs = Math.round(peer.rttMs * 0.7 + rttMs * 0.3);
    peer.lastHeartbeat = timestampMs;
    peer.status = 'active';

    // If edge exists, update edge latency
    if (this.adjacency.get(this.localPeerId)?.has(peerId)) {
      this.addLink(this.localPeerId, peerId, peer.rttMs);
    }
  }

  /**
   * Sweeps heartbeat timestamps, flagging degraded peers and evicting dead peers
   */
  public sweepHeartbeats(timestampMs: number = Date.now()): string[] {
    const evicted: string[] = [];

    for (const [id, peer] of this.peers.entries()) {
      if (id === this.localPeerId) continue;

      const elapsed = timestampMs - peer.lastHeartbeat;

      if (elapsed > this.heartbeatTimeoutMs) {
        peer.status = 'unresponsive';
        evicted.push(id);
      } else if (elapsed > this.degradedThresholdMs) {
        peer.status = 'degraded';
      } else {
        peer.status = 'active';
      }
    }

    for (const deadId of evicted) {
      this.removePeerNode(deadId);
    }

    return evicted;
  }

  /**
   * Finds shortest latency path between source and target using Dijkstra's algorithm
   */
  public findShortestPath(sourceId: string, targetId: string): ShortestPathResult | null {
    if (!this.adjacency.has(sourceId) || !this.adjacency.has(targetId)) {
      return null;
    }
    if (sourceId === targetId) {
      return { path: [sourceId], totalLatencyMs: 0, hopCount: 0 };
    }

    const dist: Map<string, number> = new Map();
    const prev: Map<string, string> = new Map();
    const visited: Set<string> = new Set();

    for (const id of this.adjacency.keys()) {
      dist.set(id, Infinity);
    }
    dist.set(sourceId, 0);

    while (visited.size < this.adjacency.size) {
      // Find unvisited node with smallest distance
      let minDist = Infinity;
      let u: string | null = null;

      for (const [id, d] of dist.entries()) {
        if (!visited.has(id) && d < minDist) {
          minDist = d;
          u = id;
        }
      }

      if (u === null || minDist === Infinity) break;
      if (u === targetId) break;

      visited.add(u);

      const neighbors = this.adjacency.get(u)!;
      for (const [v, weight] of neighbors.entries()) {
        if (!visited.has(v)) {
          const alt = minDist + weight;
          if (alt < dist.get(v)!) {
            dist.set(v, alt);
            prev.set(v, u);
          }
        }
      }
    }

    if (dist.get(targetId) === Infinity) {
      return null; // No path found (partitioned)
    }

    // Reconstruct path
    const path: string[] = [];
    let curr: string | undefined = targetId;
    while (curr) {
      path.unshift(curr);
      curr = prev.get(curr);
    }

    return {
      path,
      totalLatencyMs: dist.get(targetId)!,
      hopCount: path.length - 1
    };
  }

  /**
   * Finds all bridge edges in the graph using Tarjan's bridge-finding algorithm
   * A bridge is an edge whose removal increases the number of connected components.
   */
  public findBridges(): [string, string][] {
    const bridges: [string, string][] = [];
    const tin: Map<string, number> = new Map();
    const low: Map<string, number> = new Map();
    const visited: Set<string> = new Set();
    let timer = 0;

    const dfs = (u: string, p: string | null = null) => {
      visited.add(u);
      tin.set(u, timer);
      low.set(u, timer);
      timer++;

      const neighbors = this.adjacency.get(u) || new Map();
      for (const v of neighbors.keys()) {
        if (v === p) continue;
        if (visited.has(v)) {
          low.set(u, Math.min(low.get(u)!, tin.get(v)!));
        } else {
          dfs(v, u);
          low.set(u, Math.min(low.get(u)!, low.get(v)!));
          if (low.get(v)! > tin.get(u)!) {
            bridges.push([u, v]);
          }
        }
      }
    };

    for (const node of this.adjacency.keys()) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    return bridges;
  }

  /**
   * Computes connected components using BFS traversal
   */
  public getConnectedComponents(): string[][] {
    const components: string[][] = [];
    const visited: Set<string> = new Set();

    for (const node of this.adjacency.keys()) {
      if (!visited.has(node)) {
        const comp: string[] = [];
        const queue: string[] = [node];
        visited.add(node);

        while (queue.length > 0) {
          const curr = queue.shift()!;
          comp.push(curr);

          const neighbors = this.adjacency.get(curr) || new Map();
          for (const neighbor of neighbors.keys()) {
            if (!visited.has(neighbor)) {
              visited.add(neighbor);
              queue.push(neighbor);
            }
          }
        }

        components.push(comp);
      }
    }

    return components;
  }

  /**
   * Computes the diameter (longest shortest-path between any two connected nodes)
   */
  public computeGraphDiameter(): number {
    let maxShortestPath = 0;
    const nodes = Array.from(this.adjacency.keys());

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const path = this.findShortestPath(nodes[i], nodes[j]);
        if (path && path.hopCount > maxShortestPath) {
          maxShortestPath = path.hopCount;
        }
      }
    }

    return maxShortestPath;
  }

  /**
   * Assesses comprehensive graph topology health and detects partitions
   */
  public assessTopologyHealth(): TopologyHealth {
    const components = this.getConnectedComponents();
    const bridges = this.findBridges();
    const graphDiameter = this.computeGraphDiameter();

    let activeLinks = 0;
    for (const neighbors of this.adjacency.values()) {
      activeLinks += neighbors.size;
    }
    // Each undirected link is stored twice
    activeLinks = Math.floor(activeLinks / 2);

    return {
      totalPeers: this.peers.size,
      activeLinks,
      localDegree: this.getLocalDegree(),
      connectedComponents: components.length,
      bridges,
      graphDiameter,
      isPartitioned: components.length > 1
    };
  }

  /**
   * Self-Healing Engine: Suggests optimal link additions or prunings to maintain target degree
   * and heal single-point-of-failure bridge links.
   */
  public computeSelfHealingActions(): {
    connectCandidates: string[];
    pruneCandidates: string[];
    bridgeMitigations: [string, string][];
  } {
    const localDegree = this.getLocalDegree();
    const localNeighbors = new Set(this.getNeighbors(this.localPeerId));
    const connectCandidates: string[] = [];
    const pruneCandidates: string[] = [];
    const bridgeMitigations: [string, string][] = [];

    // 1. Need more connections if localDegree < minDegree
    if (localDegree < this.targetDegree) {
      // Find candidate peers not currently linked to local node
      const candidates = Array.from(this.peers.keys())
        .filter((id) => id !== this.localPeerId && !localNeighbors.has(id))
        .sort((a, b) => {
          const peerA = this.peers.get(a)!;
          const peerB = this.peers.get(b)!;
          // Prefer supernodes or lowest RTT
          if (peerA.isSupernode && !peerB.isSupernode) return -1;
          if (!peerA.isSupernode && peerB.isSupernode) return 1;
          return peerA.rttMs - peerB.rttMs;
        });

      const needed = this.targetDegree - localDegree;
      connectCandidates.push(...candidates.slice(0, needed));
    }

    // 2. Prune excess connections if localDegree > maxDegree
    if (localDegree > this.maxDegree) {
      const bridges = this.findBridges();
      const bridgeSet = new Set(
        bridges.map(([u, v]) => `${u}:${v}`).concat(bridges.map(([u, v]) => `${v}:${u}`))
      );

      // Candidate links for pruning: non-bridge edges with highest latency
      const excess = localDegree - this.targetDegree;
      const pruneList = Array.from(localNeighbors)
        .filter((neighborId) => !bridgeSet.has(`${this.localPeerId}:${neighborId}`))
        .sort((a, b) => {
          const latA = this.adjacency.get(this.localPeerId)!.get(a) || 0;
          const latB = this.adjacency.get(this.localPeerId)!.get(b) || 0;
          return latB - latA; // Highest latency first
        });

      pruneCandidates.push(...pruneList.slice(0, excess));
    }

    // 3. Bridge mitigations: for bridges incident to local node or nearby, propose shortcut
    const bridges = this.findBridges();
    for (const [u, v] of bridges) {
      if (u === this.localPeerId || v === this.localPeerId) {
        // Find a second-degree neighbor to bypass the bridge
        const otherEnd = u === this.localPeerId ? v : u;
        const otherNeighbors = this.getNeighbors(otherEnd);
        for (const on of otherNeighbors) {
          if (on !== this.localPeerId && !localNeighbors.has(on)) {
            bridgeMitigations.push([this.localPeerId, on]);
            break;
          }
        }
      }
    }

    return {
      connectCandidates,
      pruneCandidates,
      bridgeMitigations
    };
  }
}
