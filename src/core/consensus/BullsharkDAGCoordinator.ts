/**
 * @file BullsharkDAGCoordinator.ts
 * @description DAG-Based Asynchronous Atomic Broadcast Engine (Narwhal / Bullshark Architecture).
 * Implements high-throughput zero-bottleneck consensus where transactions are structured into
 * a certified Directed Acyclic Graph (DAG) across rounds. Deterministic anchor vertices in even
 * rounds commit entire causal subgraphs upon quorum support in odd rounds, yielding a total linear order.
 */

import { createHash } from 'crypto';

export type NodeId = string;
export type VertexId = string;

export interface DAGVertex {
  id: VertexId;
  round: number;
  author: NodeId;
  transactions: string[];
  parents: VertexId[];
  timestamp: number;
}

export interface DAGCertificate {
  vertexId: VertexId;
  vertex: DAGVertex;
  signers: NodeId[];
}

export interface DAGVote {
  vertexId: VertexId;
  voter: NodeId;
  signature: string;
}

/**
 * Bullshark DAG Consensus Node.
 */
export class BullsharkDAGCoordinator {
  public readonly nodeId: NodeId;
  public readonly clusterSize: number;
  public readonly f: number;
  public readonly quorum: number;

  // DAG storage: round -> (vertexId -> Certificate)
  private dag: Map<number, Map<VertexId, DAGCertificate>> = new Map();
  private committedAnchors: Set<VertexId> = new Set();
  private orderedTransactions: string[] = [];
  private committedVertices: Set<VertexId> = new Set();

  constructor(nodeId: NodeId, clusterSize: number) {
    this.nodeId = nodeId;
    this.clusterSize = clusterSize;
    this.f = Math.floor((clusterSize - 1) / 3);
    this.quorum = 2 * this.f + 1;
  }

  public static hashVertex(round: number, author: NodeId, transactions: string[], parents: VertexId[]): VertexId {
    const raw = [round.toString(), author, transactions.join(','), parents.sort().join(',')].join('|');
    return createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Creates a new vertex for the specified round referencing at least 2f + 1 parent certificates.
   */
  public createVertex(round: number, transactions: string[], parents: VertexId[]): DAGVertex {
    if (round > 0 && parents.length < this.quorum) {
      throw new Error(`Cannot create vertex at round ${round}: need at least ${this.quorum} parents, got ${parents.length}`);
    }

    const id = BullsharkDAGCoordinator.hashVertex(round, this.nodeId, transactions, parents);
    return {
      id,
      round,
      author: this.nodeId,
      transactions,
      parents,
      timestamp: Date.now(),
    };
  }

  /**
   * Validates and casts a vote on a proposed vertex.
   */
  public vote(vertex: DAGVertex): DAGVote | null {
    // Round 0 (genesis) requires no parents
    if (vertex.round > 0) {
      const prevRoundCerts = this.dag.get(vertex.round - 1);
      if (!prevRoundCerts) return null;

      // Verify all parents exist in previous round
      for (const p of vertex.parents) {
        if (!prevRoundCerts.has(p)) return null;
      }
    }

    const expectedId = BullsharkDAGCoordinator.hashVertex(vertex.round, vertex.author, vertex.transactions, vertex.parents);
    if (expectedId !== vertex.id) return null;

    const signature = createHash('sha256').update(`${vertex.id}:${this.nodeId}`).digest('hex');
    return {
      vertexId: vertex.id,
      voter: this.nodeId,
      signature,
    };
  }

  /**
   * Aggregates votes to certify a vertex.
   */
  public certifyVertex(vertex: DAGVertex, votes: DAGVote[]): DAGCertificate | null {
    const uniqueSigners = new Set(votes.filter(v => v.vertexId === vertex.id).map(v => v.voter));
    if (uniqueSigners.size < this.quorum) {
      return null;
    }

    return {
      vertexId: vertex.id,
      vertex,
      signers: Array.from(uniqueSigners),
    };
  }

  /**
   * Adds a valid certificate to the DAG.
   */
  public addCertificate(cert: DAGCertificate): void {
    let roundMap = this.dag.get(cert.vertex.round);
    if (!roundMap) {
      roundMap = new Map();
      this.dag.set(cert.vertex.round, roundMap);
    }
    roundMap.set(cert.vertexId, cert);
  }

  /**
   * Deterministic leader selection for wave w. Anchor is located at round 2w.
   */
  public getLeaderForWave(wave: number, allNodes: NodeId[]): NodeId {
    const sorted = [...allNodes].sort();
    return sorted[wave % sorted.length];
  }

  /**
   * Checks if an anchor vertex is causally reachable from a child vertex.
   */
  public isReachable(childId: VertexId, targetId: VertexId): boolean {
    if (childId === targetId) return true;

    const visited = new Set<VertexId>();
    const queue = [childId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      if (current === targetId) return true;

      // Find vertex in DAG
      let cert: DAGCertificate | undefined;
      for (const roundMap of this.dag.values()) {
        if (roundMap.has(current)) {
          cert = roundMap.get(current);
          break;
        }
      }

      if (cert) {
        for (const parent of cert.vertex.parents) {
          if (!visited.has(parent)) {
            queue.push(parent);
          }
        }
      }
    }

    return false;
  }

  /**
   * Attempts to commit wave w:
   * Anchor A is at round 2w from the wave leader.
   * Voting round is round 2w + 1. If >= 2f + 1 vertices in 2w + 1 reference A, commit!
   */
  public tryCommitWave(wave: number, allNodes: NodeId[]): string[] {
    const anchorRound = 2 * wave;
    const votingRound = anchorRound + 1;

    const leader = this.getLeaderForWave(wave, allNodes);
    const anchorRoundCerts = this.dag.get(anchorRound);
    if (!anchorRoundCerts) return [];

    // Find anchor vertex by leader
    let anchorCert: DAGCertificate | undefined;
    for (const cert of anchorRoundCerts.values()) {
      if (cert.vertex.author === leader) {
        anchorCert = cert;
        break;
      }
    }
    if (!anchorCert || this.committedAnchors.has(anchorCert.vertexId)) return [];

    // Check support in voting round (2w + 1)
    const votingRoundCerts = this.dag.get(votingRound);
    if (!votingRoundCerts) return [];

    let supportingVotes = 0;
    for (const cert of votingRoundCerts.values()) {
      if (this.isReachable(cert.vertexId, anchorCert.vertexId)) {
        supportingVotes++;
      }
    }

    if (supportingVotes >= this.quorum) {
      this.committedAnchors.add(anchorCert.vertexId);
      return this.orderCausalHistory(anchorCert.vertexId);
    }

    return [];
  }

  /**
   * Traverses causal history of committed anchor in topological order and extracts transactions.
   */
  private orderCausalHistory(anchorId: VertexId): string[] {
    const uncommittedVertices: DAGVertex[] = [];
    const visited = new Set<VertexId>();
    const queue = [anchorId];

    while (queue.length > 0) {
      const vid = queue.shift()!;
      if (visited.has(vid) || this.committedVertices.has(vid)) continue;
      visited.add(vid);

      let cert: DAGCertificate | undefined;
      for (const roundMap of this.dag.values()) {
        if (roundMap.has(vid)) {
          cert = roundMap.get(vid);
          break;
        }
      }

      if (cert) {
        uncommittedVertices.push(cert.vertex);
        for (const p of cert.vertex.parents) {
          if (!this.committedVertices.has(p)) {
            queue.push(p);
          }
        }
      }
    }

    // Sort uncommitted vertices by round ascending, then ID deterministic tie-breaker
    uncommittedVertices.sort((a, b) => {
      if (a.round !== b.round) return a.round - b.round;
      return a.id.localeCompare(b.id);
    });

    const newTransactions: string[] = [];
    for (const v of uncommittedVertices) {
      this.committedVertices.add(v.id);
      for (const tx of v.transactions) {
        this.orderedTransactions.push(tx);
        newTransactions.push(tx);
      }
    }

    return newTransactions;
  }

  public getOrderedTransactions(): string[] {
    return [...this.orderedTransactions];
  }

  public getDAGSize(): number {
    let count = 0;
    for (const roundMap of this.dag.values()) {
      count += roundMap.size;
    }
    return count;
  }
}

/**
 * Multi-node Bullshark DAG cluster test runner.
 */
export class BullsharkDAGCluster {
  public readonly nodes: Map<NodeId, BullsharkDAGCoordinator> = new Map();
  public readonly nodeIds: NodeId[];

  constructor(clusterSize: number) {
    this.nodeIds = [];
    for (let i = 0; i < clusterSize; i++) {
      const id = `node_${i}`;
      this.nodeIds.push(id);
      this.nodes.set(id, new BullsharkDAGCoordinator(id, clusterSize));
    }
  }

  /**
   * Simulates full wave execution (round 0 genesis -> round 1 voting -> commit wave 0).
   */
  public runWave0(): string[] {
    // Round 0: Each node creates a genesis vertex
    const round0Certs: DAGCertificate[] = [];
    for (const [id, node] of this.nodes) {
      const vertex = node.createVertex(0, [`tx_${id}_r0`], []);
      const votes: DAGVote[] = [];
      for (const voter of this.nodes.values()) {
        const vote = voter.vote(vertex);
        if (vote) votes.push(vote);
      }
      const cert = node.certifyVertex(vertex, votes);
      if (cert) round0Certs.push(cert);
    }

    // Broadcast round 0 certs to all nodes
    for (const cert of round0Certs) {
      for (const node of this.nodes.values()) {
        node.addCertificate(cert);
      }
    }

    // Round 1: Each node creates round 1 vertex referencing round 0 certs
    const r0ParentIds = round0Certs.map(c => c.vertexId);
    const round1Certs: DAGCertificate[] = [];
    for (const [id, node] of this.nodes) {
      const vertex = node.createVertex(1, [`tx_${id}_r1`], r0ParentIds);
      const votes: DAGVote[] = [];
      for (const voter of this.nodes.values()) {
        const vote = voter.vote(vertex);
        if (vote) votes.push(vote);
      }
      const cert = node.certifyVertex(vertex, votes);
      if (cert) round1Certs.push(cert);
    }

    // Broadcast round 1 certs
    for (const cert of round1Certs) {
      for (const node of this.nodes.values()) {
        node.addCertificate(cert);
      }
    }

    // Attempt commit wave 0 on node_0
    const node0 = this.nodes.get('node_0')!;
    return node0.tryCommitWave(0, this.nodeIds);
  }
}
