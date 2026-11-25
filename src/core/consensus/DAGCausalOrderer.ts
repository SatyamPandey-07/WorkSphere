/**
 * @file DAGCausalOrderer.ts
 * @description Deterministic DAG Causal Broadcast Linearizer (Narwhal / Bullshark / Mysticeti).
 * Validates certified DAG vertices with 2f + 1 parent quorum links, enforces single-vertex
 * per-round equivocation prevention, and deterministically linearizes uncommitted causal
 * histories upon leader anchor commits so all honest replicas execute identical total orders.
 */

import { createHash } from 'crypto';

export interface DAGVertex {
  digest: string;
  authorId: string;
  round: number;
  payload: string;
  parents: string[];
  timestamp: number;
}

export interface OrderedBatchOutput {
  anchorDigest: string;
  anchorRound: number;
  newlyCommitted: DAGVertex[];
  totalCommittedCount: number;
}

export interface CausalConsistencyReport {
  isConsistent: boolean;
  causalOrderPreserved: boolean;
  reason?: string;
}

export class DAGCausalOrderer {
  public readonly validators: Set<string>;
  public readonly n: number;
  public readonly f: number;
  public readonly quorumSize: number;

  private vertices: Map<string, DAGVertex> = new Map();
  // round -> authorId -> digest (detects equivocation)
  private authorRoundIndex: Map<number, Map<string, string>> = new Map();
  private committedDigests: Set<string> = new Set();
  private committedLog: DAGVertex[] = [];

  constructor(validatorIds: string[]) {
    if (validatorIds.length < 4) {
      throw new Error(`DAG causal orderer requires at least 4 validators (3f + 1); got ${validatorIds.length}`);
    }
    this.validators = new Set(validatorIds);
    this.n = this.validators.size;
    this.f = Math.floor((this.n - 1) / 3);
    this.quorumSize = 2 * this.f + 1;
  }

  /**
   * Deterministically computes SHA-256 vertex digest.
   */
  public static computeDigest(
    authorId: string,
    round: number,
    payload: string,
    parents: string[]
  ): string {
    const canonicalParents = [...parents].sort().join(',');
    return createHash('sha256')
      .update(`${authorId}:${round}:${payload}:${canonicalParents}`)
      .digest('hex');
  }

  /**
   * Constructs a well-formed DAG vertex.
   */
  public createVertex(
    authorId: string,
    round: number,
    payload: string,
    parents: string[]
  ): DAGVertex {
    const uniqueParents = Array.from(new Set(parents)).sort();
    const digest = DAGCausalOrderer.computeDigest(authorId, round, payload, uniqueParents);
    return {
      digest,
      authorId,
      round,
      payload,
      parents: uniqueParents,
      timestamp: Date.now(),
    };
  }

  /**
   * Validates and inserts a vertex into the local DAG store.
   */
  public insertVertex(vertex: DAGVertex): { accepted: boolean; reason?: string } {
    if (!this.validators.has(vertex.authorId)) {
      return { accepted: false, reason: `Unknown validator ${vertex.authorId}` };
    }
    if (vertex.round < 1) {
      return { accepted: false, reason: `Round must be >= 1; got ${vertex.round}` };
    }

    const expectedDigest = DAGCausalOrderer.computeDigest(
      vertex.authorId,
      vertex.round,
      vertex.payload,
      vertex.parents
    );
    if (vertex.digest !== expectedDigest) {
      return { accepted: false, reason: 'Vertex digest verification failed' };
    }

    // Duplicate check
    if (this.vertices.has(vertex.digest)) {
      return { accepted: true };
    }

    // Equivocation check: one vertex per author per round
    if (!this.authorRoundIndex.has(vertex.round)) {
      this.authorRoundIndex.set(vertex.round, new Map());
    }
    const roundMap = this.authorRoundIndex.get(vertex.round)!;
    const existingByAuthor = roundMap.get(vertex.authorId);
    if (existingByAuthor && existingByAuthor !== vertex.digest) {
      return {
        accepted: false,
        reason: `Equivocation detected: validator ${vertex.authorId} already authored vertex in round ${vertex.round}`,
      };
    }

    // Parent quorum & causal monotonicity validation for rounds > 1
    if (vertex.round > 1) {
      if (vertex.parents.length < this.quorumSize) {
        return {
          accepted: false,
          reason: `Insufficient parent references for round ${vertex.round}: have ${vertex.parents.length}, need ${this.quorumSize}`,
        };
      }

      const parentAuthors = new Set<string>();
      for (const pDigest of vertex.parents) {
        const parent = this.vertices.get(pDigest);
        if (!parent) {
          return { accepted: false, reason: `Missing parent vertex ${pDigest}` };
        }
        if (parent.round >= vertex.round) {
          return {
            accepted: false,
            reason: `Causal violation: parent round ${parent.round} >= child round ${vertex.round}`,
          };
        }
        parentAuthors.add(parent.authorId);
      }

      if (parentAuthors.size < this.quorumSize) {
        return {
          accepted: false,
          reason: `Parents must originate from at least ${this.quorumSize} distinct validators`,
        };
      }
    }

    this.vertices.set(vertex.digest, vertex);
    roundMap.set(vertex.authorId, vertex.digest);
    return { accepted: true };
  }

  /**
   * Returns all uncommitted vertices in the transitive causal past of anchorDigest,
   * sorted deterministically by (round ASC, digest ASC).
   */
  public getUncommittedCausalHistory(anchorDigest: string): DAGVertex[] {
    const anchor = this.vertices.get(anchorDigest);
    if (!anchor) {
      throw new Error(`Anchor vertex ${anchorDigest} not found in DAG`);
    }

    const visited = new Set<string>();
    const collected: DAGVertex[] = [];
    const stack: string[] = [anchorDigest];

    while (stack.length > 0) {
      const curDigest = stack.pop()!;
      if (visited.has(curDigest) || this.committedDigests.has(curDigest)) {
        continue;
      }
      visited.add(curDigest);

      const node = this.vertices.get(curDigest);
      if (!node) continue;
      collected.push(node);

      for (const parentDigest of node.parents) {
        if (!visited.has(parentDigest) && !this.committedDigests.has(parentDigest)) {
          stack.push(parentDigest);
        }
      }
    }

    // Deterministic topological sort: ascending round, then lexicographical digest tie-break
    collected.sort((a, b) => {
      if (a.round !== b.round) return a.round - b.round;
      return a.digest.localeCompare(b.digest);
    });

    return collected;
  }

  /**
   * Commits a leader anchor vertex and deterministically linearizes its uncommitted causal past.
   */
  public commitAnchor(anchorDigest: string): OrderedBatchOutput {
    const anchor = this.vertices.get(anchorDigest);
    if (!anchor) {
      throw new Error(`Cannot commit unknown anchor ${anchorDigest}`);
    }

    const newlyCommitted = this.getUncommittedCausalHistory(anchorDigest);
    for (const v of newlyCommitted) {
      this.committedDigests.add(v.digest);
      this.committedLog.push(v);
    }

    return {
      anchorDigest,
      anchorRound: anchor.round,
      newlyCommitted,
      totalCommittedCount: this.committedLog.length,
    };
  }

  public getCommittedLog(): DAGVertex[] {
    return [...this.committedLog];
  }

  /**
   * Verifies two replicas' committed logs are byte-for-byte identical AND preserve causal ordering.
   */
  public static verifyTotalOrderConsistency(
    logA: DAGVertex[],
    logB: DAGVertex[]
  ): CausalConsistencyReport {
    if (logA.length !== logB.length) {
      return {
        isConsistent: false,
        causalOrderPreserved: false,
        reason: `Length mismatch: replica A has ${logA.length}, replica B has ${logB.length}`,
      };
    }

    const seenIndex = new Map<string, number>();

    for (let i = 0; i < logA.length; i++) {
      if (logA[i].digest !== logB[i].digest) {
        return {
          isConsistent: false,
          causalOrderPreserved: false,
          reason: `Divergence at index ${i}: ${logA[i].digest} != ${logB[i].digest}`,
        };
      }

      // Check causal ordering: every referenced parent must appear at an earlier index
      for (const pDigest of logA[i].parents) {
        const parentPos = seenIndex.get(pDigest);
        if (parentPos === undefined || parentPos >= i) {
          return {
            isConsistent: true,
            causalOrderPreserved: false,
            reason: `Causal order violation at index ${i}: parent ${pDigest} not committed before child`,
          };
        }
      }

      seenIndex.set(logA[i].digest, i);
    }

    return {
      isConsistent: true,
      causalOrderPreserved: true,
    };
  }
}
