/**
 * @file ZeroKnowledgeGraphColoringProver.ts
 * @description Non-Interactive Fiat-Shamir Goldreich-Micali-Wigderson (GMW) Zero-Knowledge Graph
 * 3-Coloring Prover & Verifier for Conflict-Free Resource Scheduling.
 * Models workspace room/slot conflict graphs G = (V, E) where a valid 3-coloring corresponds to
 * a conflict-free 3-slot assignment. Proves a valid coloring exists WITHOUT disclosing the schedule:
 *   1. In each soundness round r = 1..R, prover picks a random permutation pi_r of {0, 1, 2} and
 *      commits to every vertex v via a hiding Pedersen commitment C_{r,v} = g^{pi_r(c(v))} h^{b_{r,v}}.
 *   2. Fiat-Shamir hash of all round commitments selects a challenge edge e_r = (u_r, v_r) in E.
 *   3. Prover opens ONLY the two endpoints (u_r, v_r), proving their committed colors are valid
 *      elements of {0, 1, 2} and strictly distinct (color_u != color_v).
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export type VertexColor = 0 | 1 | 2;

export interface ConflictGraph {
  graphId: string;
  vertexCount: number;
  edges: Array<[number, number]>;
}

export interface GMWColoringRound {
  roundIndex: number;
  vertexCommitments: bigint[];
  challengedEdgeIndex: number;
  endpointU: number;
  endpointV: number;
  colorU: VertexColor;
  blindingU: bigint;
  colorV: VertexColor;
  blindingV: bigint;
}

export interface Graph3ColoringProof {
  graphId: string;
  vertexCount: number;
  edgeCount: number;
  graphDigest: string;
  rounds: GMWColoringRound[];
  soundnessErrorUpperBound: number;
  proofDigest: string;
}

function modNorm(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = modNorm(base, mod);
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function randomScalar(q: bigint): bigint {
  return (BigInt(`0x${randomBytes(16).toString('hex')}`) % (q - 2n)) + 2n;
}

function deriveH(p: bigint, g: bigint): bigint {
  const digest = createHash('sha256').update(`WorkSphere::GMWColorH|${p.toString(16)}|${g.toString(16)}`).digest('hex');
  const raw = BigInt(`0x${digest}`) % (p - 2n) + 2n;
  return (raw * raw) % p;
}

const COLOR_PERMUTATIONS: ReadonlyArray<readonly [VertexColor, VertexColor, VertexColor]> = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

/**
 * Non-Interactive Fiat-Shamir Zero-Knowledge Graph 3-Coloring Prover & Verifier.
 */
export class ZeroKnowledgeGraphColoringProver {
  private readonly p: bigint;
  private readonly q: bigint;
  private readonly g: bigint;
  private readonly h: bigint;

  constructor(p = SAFE_PRIME_P, q = SUBGROUP_Q, g = BASE_G) {
    if (p !== 2n * q + 1n) {
      throw new Error('Safe prime invariant p = 2q + 1 is required');
    }
    this.p = p;
    this.q = q;
    this.g = g;
    this.h = deriveH(p, g);
  }

  public commitColor(color: VertexColor, blinding: bigint): bigint {
    return (
      modPow(this.g, BigInt(color), this.p) * modPow(this.h, modNorm(blinding, this.q), this.p)
    ) % this.p;
  }

  /**
   * Computes a canonical SHA-256 fingerprint binding graphId, vertexCount, and all edges.
   */
  public computeGraphDigest(graph: ConflictGraph): string {
    const h = createHash('sha256');
    h.update(`WorkSphere::Graph3Col|${graph.graphId}|V:${graph.vertexCount}`);
    for (const [u, v] of graph.edges) {
      h.update(`|${u}-${v}`);
    }
    return h.digest('hex');
  }

  /**
   * Validates that a coloring witness is a proper 3-coloring of `graph`.
   */
  public validateColoringWitness(
    graph: ConflictGraph,
    coloring: readonly VertexColor[]
  ): { valid: boolean; conflicts: Array<[number, number]> } {
    if (coloring.length !== graph.vertexCount) {
      throw new Error('Coloring length must equal graph.vertexCount');
    }
    for (const c of coloring) {
      if (c !== 0 && c !== 1 && c !== 2) {
        throw new RangeError(`Invalid color ${String(c)}; must be 0, 1, or 2`);
      }
    }
    const conflicts: Array<[number, number]> = [];
    for (const [u, v] of graph.edges) {
      if (u < 0 || u >= graph.vertexCount || v < 0 || v >= graph.vertexCount || u === v) {
        throw new RangeError(`Invalid graph edge (${u}, ${v})`);
      }
      if (coloring[u] === coloring[v]) {
        conflicts.push([u, v]);
      }
    }
    return { valid: conflicts.length === 0, conflicts };
  }

  /**
   * Backtracking solver for finding a valid 3-coloring witness of a workspace conflict graph.
   */
  public findValid3Coloring(graph: ConflictGraph): VertexColor[] | null {
    const adj: number[][] = Array.from({ length: graph.vertexCount }, () => []);
    for (const [u, v] of graph.edges) {
      if (u === v) return null;
      adj[u].push(v);
      adj[v].push(u);
    }

    const colors: Array<VertexColor | -1> = new Array(graph.vertexCount).fill(-1);
    const dfs = (v: number): boolean => {
      if (v === graph.vertexCount) return true;
      for (const c of [0, 1, 2] as const) {
        let ok = true;
        for (const nbr of adj[v]) {
          if (colors[nbr] === c) {
            ok = false;
            break;
          }
        }
        if (ok) {
          colors[v] = c;
          if (dfs(v + 1)) return true;
          colors[v] = -1;
        }
      }
      return false;
    };

    return dfs(0) ? (colors as VertexColor[]) : null;
  }

  private deriveChallengedEdgeIndex(
    graphDigest: string,
    roundIndex: number,
    commitments: readonly bigint[],
    edgeCount: number
  ): number {
    const h = createHash('sha256');
    h.update(`WorkSphere::GMWChallenge|${graphDigest}|r:${roundIndex}`);
    for (const c of commitments) {
      h.update('|');
      h.update(c.toString(16));
    }
    const val = h.digest().readUInt32BE(0);
    return val % edgeCount;
  }

  /**
   * Generates a non-interactive Fiat-Shamir GMW zero-knowledge proof of 3-colorability
   * across `roundsCount` independent permuted commitment rounds.
   */
  public prove3Coloring(
    graph: ConflictGraph,
    coloring: readonly VertexColor[],
    roundsCount = 24
  ): Graph3ColoringProof {
    if (graph.edges.length === 0) {
      throw new Error('Conflict graph must contain at least one edge');
    }
    if (!Number.isInteger(roundsCount) || roundsCount < 1) {
      throw new RangeError('roundsCount must be a positive integer');
    }

    const witnessCheck = this.validateColoringWitness(graph, coloring);
    if (!witnessCheck.valid) {
      throw new Error(
        `Provided coloring has ${witnessCheck.conflicts.length} conflicting edge(s)`
      );
    }

    const graphDigest = this.computeGraphDigest(graph);
    const rounds: GMWColoringRound[] = [];

    for (let r = 0; r < roundsCount; r++) {
      const permIdx = randomBytes(1)[0] % COLOR_PERMUTATIONS.length;
      const perm = COLOR_PERMUTATIONS[permIdx];

      const permutedColors: VertexColor[] = coloring.map((c) => perm[c]);
      const blindings: bigint[] = [];
      const vertexCommitments: bigint[] = [];

      for (let v = 0; v < graph.vertexCount; v++) {
        const b = randomScalar(this.q);
        blindings.push(b);
        vertexCommitments.push(this.commitColor(permutedColors[v], b));
      }

      const challengedEdgeIndex = this.deriveChallengedEdgeIndex(
        graphDigest,
        r,
        vertexCommitments,
        graph.edges.length
      );
      const [endpointU, endpointV] = graph.edges[challengedEdgeIndex];

      rounds.push({
        roundIndex: r,
        vertexCommitments,
        challengedEdgeIndex,
        endpointU,
        endpointV,
        colorU: permutedColors[endpointU],
        blindingU: blindings[endpointU],
        colorV: permutedColors[endpointV],
        blindingV: blindings[endpointV],
      });
    }

    const m = graph.edges.length;
    const soundnessErrorUpperBound = Math.pow(1 - 1 / m, roundsCount);

    const proofDigest = createHash('sha256')
      .update(
        `${graphDigest}|rounds:${roundsCount}|${rounds.map((rd) => `${rd.challengedEdgeIndex}:${rd.colorU}${rd.colorV}`).join(',')}`
      )
      .digest('hex');

    return {
      graphId: graph.graphId,
      vertexCount: graph.vertexCount,
      edgeCount: graph.edges.length,
      graphDigest,
      rounds,
      soundnessErrorUpperBound,
      proofDigest,
    };
  }

  /**
   * Publicly verifies a non-interactive GMW 3-coloring proof against `graph`.
   */
  public verify3ColoringProof(
    graph: ConflictGraph,
    proof: Graph3ColoringProof
  ): { valid: boolean; failedRound?: number; reason?: string } {
    if (proof.rounds.length === 0) {
      return { valid: false, reason: 'Proof contains zero rounds' };
    }
    const expectedDigest = this.computeGraphDigest(graph);
    if (expectedDigest !== proof.graphDigest) {
      return { valid: false, reason: 'Graph digest mismatch' };
    }
    if (proof.vertexCount !== graph.vertexCount || proof.edgeCount !== graph.edges.length) {
      return { valid: false, reason: 'Graph dimensions mismatch' };
    }

    for (let r = 0; r < proof.rounds.length; r++) {
      const rd = proof.rounds[r];
      if (rd.roundIndex !== r || rd.vertexCommitments.length !== graph.vertexCount) {
        return { valid: false, failedRound: r, reason: 'Malformed round structure' };
      }

      const expectedEdgeIdx = this.deriveChallengedEdgeIndex(
        expectedDigest,
        r,
        rd.vertexCommitments,
        graph.edges.length
      );
      if (expectedEdgeIdx !== rd.challengedEdgeIndex) {
        return { valid: false, failedRound: r, reason: 'Fiat-Shamir edge challenge mismatch' };
      }

      const [u, v] = graph.edges[expectedEdgeIdx];
      if (rd.endpointU !== u || rd.endpointV !== v) {
        return { valid: false, failedRound: r, reason: 'Challenged edge endpoint mismatch' };
      }

      if (
        (rd.colorU !== 0 && rd.colorU !== 1 && rd.colorU !== 2) ||
        (rd.colorV !== 0 && rd.colorV !== 1 && rd.colorV !== 2)
      ) {
        return { valid: false, failedRound: r, reason: 'Opened endpoint color outside {0, 1, 2}' };
      }
      if (rd.colorU === rd.colorV) {
        return { valid: false, failedRound: r, reason: 'Challenged edge endpoints share identical color' };
      }

      if (this.commitColor(rd.colorU, rd.blindingU) !== rd.vertexCommitments[u]) {
        return { valid: false, failedRound: r, reason: 'Endpoint U Pedersen opening mismatch' };
      }
      if (this.commitColor(rd.colorV, rd.blindingV) !== rd.vertexCommitments[v]) {
        return { valid: false, failedRound: r, reason: 'Endpoint V Pedersen opening mismatch' };
      }
    }

    return { valid: true };
  }

  public serializeProof(proof: Graph3ColoringProof): string {
    return JSON.stringify({
      graphId: proof.graphId,
      vertexCount: proof.vertexCount,
      edgeCount: proof.edgeCount,
      graphDigest: proof.graphDigest,
      soundnessErrorUpperBound: proof.soundnessErrorUpperBound,
      proofDigest: proof.proofDigest,
      rounds: proof.rounds.map((rd) => ({
        roundIndex: rd.roundIndex,
        vertexCommitments: rd.vertexCommitments.map((c) => c.toString(16)),
        challengedEdgeIndex: rd.challengedEdgeIndex,
        endpointU: rd.endpointU,
        endpointV: rd.endpointV,
        colorU: rd.colorU,
        blindingU: rd.blindingU.toString(16),
        colorV: rd.colorV,
        blindingV: rd.blindingV.toString(16),
      })),
    });
  }

  public deserializeProof(payload: string): Graph3ColoringProof {
    const raw = JSON.parse(payload) as Record<string, any>;
    return {
      graphId: raw.graphId,
      vertexCount: Number(raw.vertexCount),
      edgeCount: Number(raw.edgeCount),
      graphDigest: raw.graphDigest,
      soundnessErrorUpperBound: Number(raw.soundnessErrorUpperBound),
      proofDigest: raw.proofDigest,
      rounds: raw.rounds.map((rd: Record<string, any>) => ({
        roundIndex: Number(rd.roundIndex),
        vertexCommitments: rd.vertexCommitments.map((c: string) => BigInt(`0x${c}`)),
        challengedEdgeIndex: Number(rd.challengedEdgeIndex),
        endpointU: Number(rd.endpointU),
        endpointV: Number(rd.endpointV),
        colorU: Number(rd.colorU) as VertexColor,
        blindingU: BigInt(`0x${rd.blindingU}`),
        colorV: Number(rd.colorV) as VertexColor,
        blindingV: BigInt(`0x${rd.blindingV}`),
      })),
    };
  }
}
