/**
 * @file RaftConsensusEngine.ts
 * @description Advanced Raft Distributed Consensus Engine with cluster topology management,
 * dynamic membership changes, linearizable client proposal pipelining, and health monitoring.
 *
 * Coordinates RaftClusterNodes with leader discovery, split-vote mitigation,
 * and majority commit verification across distributed workspace peers.
 */

import {
  RaftClusterNode,
  RaftTransport,
  type RaftRole,
  type RequestVoteRequest,
  type RequestVoteResponse,
  type AppendEntriesRequest,
  type AppendEntriesResponse,
  type RaftCommandResult,
} from './RaftClusterNode';
import { RaftLogStorage } from './RaftLogStorage';

export interface ClusterConfig {
  clusterId: string;
  peerIds: string[];
  heartbeatIntervalMs?: number;
  electionTimeoutMinMs?: number;
  electionTimeoutMaxMs?: number;
  proposalTimeoutMs?: number;
}

export interface ProposeResult {
  success: boolean;
  term?: number;
  leaderId?: string | null;
  result?: RaftCommandResult;
  error?: string;
}

export interface ClusterNodeStatus {
  nodeId: string;
  role: RaftRole;
  currentTerm: number;
  commitIndex: number;
  lastLogIndex: number;
  isLeader: boolean;
}

export interface ClusterHealth {
  clusterId: string;
  leaderId: string | null;
  currentTerm: number;
  activeNodes: number;
  totalNodes: number;
  hasQuorum: boolean;
  nodes: ClusterNodeStatus[];
}

/**
 * In-memory simulated network transport for multi-node Raft clusters
 */
export class InMemoryRaftTransport implements RaftTransport {
  private readonly nodes = new Map<string, RaftClusterNode>();
  private networkPartition = new Set<string>(); // Disconnected node IDs

  registerNode(nodeId: string, node: RaftClusterNode): void {
    this.nodes.set(nodeId, node);
  }

  unregisterNode(nodeId: string): void {
    this.nodes.delete(nodeId);
  }

  setPartition(isolatedNodeIds: string[]): void {
    this.networkPartition = new Set(isolatedNodeIds);
  }

  clearPartition(): void {
    this.networkPartition.clear();
  }

  async sendRequestVote(
    peerId: string,
    req: RequestVoteRequest
  ): Promise<RequestVoteResponse> {
    if (this.networkPartition.has(req.candidateId) || this.networkPartition.has(peerId)) {
      throw new Error(`Network partition between ${req.candidateId} and ${peerId}`);
    }

    const target = this.nodes.get(peerId);
    if (!target) {
      throw new Error(`Peer node ${peerId} unreachable`);
    }

    return target.handleRequestVote(req);
  }

  async sendAppendEntries(
    peerId: string,
    req: AppendEntriesRequest
  ): Promise<AppendEntriesResponse> {
    if (this.networkPartition.has(req.leaderId) || this.networkPartition.has(peerId)) {
      throw new Error(`Network partition between ${req.leaderId} and ${peerId}`);
    }

    const target = this.nodes.get(peerId);
    if (!target) {
      throw new Error(`Peer node ${peerId} unreachable`);
    }

    return target.handleAppendEntries(req);
  }
}

/**
 * Enterprise Raft Consensus Engine
 */
export class RaftConsensusEngine {
  readonly clusterId: string;
  private readonly config: ClusterConfig;
  private readonly transport: InMemoryRaftTransport;
  private readonly nodes = new Map<string, RaftClusterNode>();
  private readonly storages = new Map<string, RaftLogStorage>();
  private peerList: string[] = [];

  private constructor(
    config: ClusterConfig,
    transport: InMemoryRaftTransport
  ) {
    this.clusterId = config.clusterId;
    this.config = config;
    this.transport = transport;
    this.peerList = [...config.peerIds];
  }

  /**
   * Asynchronously initializes a multi-node Raft consensus cluster
   */
  public static async create(
    config: ClusterConfig,
    transport?: InMemoryRaftTransport
  ): Promise<RaftConsensusEngine> {
    const netTransport = transport ?? new InMemoryRaftTransport();
    const engine = new RaftConsensusEngine(config, netTransport);

    for (const nodeId of config.peerIds) {
      await engine.initNode(nodeId);
    }

    return engine;
  }

  private async initNode(nodeId: string): Promise<RaftClusterNode> {
    const storage = await RaftLogStorage.open({ namespace: `engine-${this.clusterId}-${nodeId}` });
    const peers = this.peerList.filter((id) => id !== nodeId);

    const node = await RaftClusterNode.create({
      id: nodeId,
      peers,
      transport: this.transport,
      storage,
      heartbeatIntervalMs: this.config.heartbeatIntervalMs ?? 50,
      electionTimeoutMinMs: this.config.electionTimeoutMinMs ?? 150,
      electionTimeoutMaxMs: this.config.electionTimeoutMaxMs ?? 300,
      proposalTimeoutMs: this.config.proposalTimeoutMs ?? 500,
    });

    this.nodes.set(nodeId, node);
    this.storages.set(nodeId, storage);
    this.transport.registerNode(nodeId, node);

    return node;
  }

  getNode(nodeId: string): RaftClusterNode | undefined {
    return this.nodes.get(nodeId);
  }

  getStorage(nodeId: string): RaftLogStorage | undefined {
    return this.storages.get(nodeId);
  }

  getTransport(): InMemoryRaftTransport {
    return this.transport;
  }

  /**
   * Discovers the current leader of the cluster, if one exists
   */
  getLeader(): RaftClusterNode | undefined {
    for (const node of this.nodes.values()) {
      if (node.isLeader()) {
        return node;
      }
    }
    return undefined;
  }

  getLeaderId(): string | null {
    return this.getLeader()?.id ?? null;
  }

  /**
   * Submits a desk reservation command to the cluster with automatic leader routing
   */
  async reserveDesk(
    deskId: string,
    userId: string,
    durationMs: number = 3600000,
    targetNodeId?: string
  ): Promise<ProposeResult> {
    let target = targetNodeId ? this.nodes.get(targetNodeId) : this.getLeader();

    if (!target || !target.isLeader()) {
      target = this.getLeader();
    }

    if (!target) {
      return {
        success: false,
        error: 'No active leader elected in cluster',
      };
    }

    try {
      // The node takes the reservation as one command object. The cluster is the
      // scope of the desks it locks, so its id is recorded as the venue.
      const result = await target.reserveDesk({
        deskId,
        venueId: this.clusterId,
        memberId: userId,
        expiresAt: Date.now() + durationMs,
      });
      return {
        success: result.status === 'committed',
        term: target.getCurrentTerm(),
        leaderId: target.id,
        result,
        ...(result.status === 'committed'
          ? {}
          : { error: result.reason ?? 'Reservation rejected' }),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        leaderId: target.id,
        error: msg,
      };
    }
  }

  /**
   * Submits a desk release command to the cluster with automatic leader routing
   */
  async releaseDesk(
    deskId: string,
    userId: string,
    targetNodeId?: string
  ): Promise<ProposeResult> {
    let target = targetNodeId ? this.nodes.get(targetNodeId) : this.getLeader();

    if (!target || !target.isLeader()) {
      target = this.getLeader();
    }

    if (!target) {
      return {
        success: false,
        error: 'No active leader elected in cluster',
      };
    }

    // The node releases by reservation id, so find the lock held on this desk.
    const lock = target.getDeskReservation(deskId);
    if (!lock) {
      return {
        success: false,
        leaderId: target.id,
        error: `No reservation is held on desk ${deskId}`,
      };
    }
    if (lock.memberId !== userId) {
      return {
        success: false,
        leaderId: target.id,
        error: `Desk ${deskId} is reserved by another member`,
      };
    }

    try {
      const result = await target.releaseDesk(lock.reservationId);
      return {
        success: result.status === 'committed',
        term: target.getCurrentTerm(),
        leaderId: target.id,
        result,
        ...(result.status === 'committed'
          ? {}
          : { error: result.reason ?? 'Release rejected' }),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        leaderId: target.id,
        error: msg,
      };
    }
  }

  /**
   * Dynamically adds a new peer node to the cluster
   */
  async addPeer(nodeId: string): Promise<RaftClusterNode | undefined> {
    if (this.nodes.has(nodeId)) return this.nodes.get(nodeId);

    this.peerList.push(nodeId);
    return this.initNode(nodeId);
  }

  /**
   * Gracefully removes a peer node from the cluster
   */
  async removePeer(nodeId: string): Promise<boolean> {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    node.stop();
    await node.close();
    this.transport.unregisterNode(nodeId);
    this.nodes.delete(nodeId);
    this.storages.delete(nodeId);
    this.peerList = this.peerList.filter((id) => id !== nodeId);

    return true;
  }

  /**
   * Returns a real-time status snapshot of the entire cluster
   */
  getClusterHealth(): ClusterHealth {
    const nodeStatuses: ClusterNodeStatus[] = [];
    let leaderId: string | null = null;
    let maxTerm = 0;
    let activeCount = 0;

    for (const [id, node] of this.nodes.entries()) {
      const role = node.getRole();
      const term = node.getCurrentTerm();
      if (term > maxTerm) maxTerm = term;
      const isLeader = node.isLeader();
      if (isLeader) leaderId = id;

      activeCount++;
      nodeStatuses.push({
        nodeId: id,
        role,
        currentTerm: term,
        commitIndex: node.getCommitIndex(),
        lastLogIndex: node.getLastLogIndex(),
        isLeader,
      });
    }

    const quorumSize = Math.floor(this.peerList.length / 2) + 1;
    const hasQuorum = activeCount >= quorumSize;

    return {
      clusterId: this.clusterId,
      leaderId,
      currentTerm: maxTerm,
      activeNodes: activeCount,
      totalNodes: this.peerList.length,
      hasQuorum,
      nodes: nodeStatuses,
    };
  }

  /**
   * Stops all nodes and halts all timers
   */
  stopAll(): void {
    for (const node of this.nodes.values()) {
      node.stop();
    }
  }

  /**
   * Closes all storages and releases all resources
   */
  async closeAll(): Promise<void> {
    this.stopAll();
    for (const node of this.nodes.values()) {
      await node.close();
    }
  }
}
