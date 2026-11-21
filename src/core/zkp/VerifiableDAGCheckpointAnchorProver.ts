import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable DAG Consensus Checkpoint Anchor Prover.
 *
 * Implements a cryptographic Directed Acyclic Graph (DAG) consensus verifier (Narwhal/Bullshark-style):
 *  - Vertices belong to rounds r >= 0 and reference >= quorum parent vertices from round r - 1
 *    (except genesis round 0).
 *  - Each vertex is signed by its author validator using Schnorr signatures over the canonical
 *    digest binding (dagId, round, authorId, payloadHash, sorted parentDigests).
 *  - Computes deterministic causal history closures (sub-DAG reachable from an anchor vertex)
 *    with canonical topological ordering and certifies supermajority checkpoint anchors!
 */

export const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
export const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
export const BASE_G = 4n;

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

function modScalar(v: bigint): bigint {
  return ((v % SUBGROUP_Q) + SUBGROUP_Q) % SUBGROUP_Q;
}

function randomScalar(): bigint {
  const bytes = randomBytes(16);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return (v % (SUBGROUP_Q - 2n)) + 1n;
}

function sha256Hex(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return h.digest('hex');
}

function hashToScalar(...parts: string[]): bigint {
  return modScalar(BigInt('0x' + sha256Hex(...parts).slice(0, 32)));
}

export interface DAGValidator {
  id: string;
  publicKey: bigint;
  secretKey: bigint;
}

export interface DAGVertex {
  dagId: string;
  round: number;
  authorId: string;
  payloadHash: string;
  parents: string[]; // digests of parent vertices from round - 1
  digest: string;
  sigR: bigint;
  sigS: bigint;
}

export interface DAGCheckpointAnchor {
  dagId: string;
  anchorRound: number;
  anchorVertexDigest: string;
  orderedHistoryDigests: string[];
  historyMerkleRoot: string;
  endorsements: Array<{ validatorId: string; sigR: bigint; sigS: bigint }>;
}

export class VerifiableDAGCheckpointAnchorProver {
  private readonly dagId: string;
  private validators = new Map<string, { id: string; publicKey: bigint }>();
  private vertices = new Map<string, DAGVertex>();

  constructor(dagId: string) {
    this.dagId = dagId;
  }

  public registerValidator(id: string): DAGValidator {
    if (this.validators.has(id)) throw new Error(`Validator "${id}" already registered`);
    const secretKey = randomScalar();
    const publicKey = modPow(BASE_G, secretKey, SAFE_PRIME_P);
    this.validators.set(id, { id, publicKey });
    return { id, publicKey, secretKey };
  }

  public getQuorumSize(): number {
    const n = this.validators.size;
    return Math.floor((2 * n) / 3) + 1;
  }

  private signDigest(val: DAGValidator, digest: string): { sigR: bigint; sigS: bigint } {
    const k = randomScalar();
    const sigR = modPow(BASE_G, k, SAFE_PRIME_P);
    const c = hashToScalar('DAG-SIG-V1', sigR.toString(16), val.publicKey.toString(16), digest);
    return { sigR, sigS: modScalar(k + c * val.secretKey) };
  }

  private verifySig(pubKey: bigint, digest: string, sigR: bigint, sigS: bigint): boolean {
    const c = hashToScalar('DAG-SIG-V1', sigR.toString(16), pubKey.toString(16), digest);
    return modPow(BASE_G, sigS, SAFE_PRIME_P) === (sigR * modPow(pubKey, c, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  public computeVertexDigest(round: number, authorId: string, payloadHash: string, parents: string[]): string {
    const sortedParents = [...parents].sort();
    return sha256Hex('DAG-VERTEX-V1', this.dagId, String(round), authorId, payloadHash, ...sortedParents);
  }

  public createVertex(author: DAGValidator, round: number, payload: string, parentDigests: string[]): DAGVertex {
    if (round < 0) throw new RangeError('Round must be >= 0');
    const payloadHash = sha256Hex('DAG-PAYLOAD-V1', payload);
    const sortedParents = [...new Set(parentDigests)].sort();
    const digest = this.computeVertexDigest(round, author.id, payloadHash, sortedParents);
    const { sigR, sigS } = this.signDigest(author, digest);
    return {
      dagId: this.dagId,
      round,
      authorId: author.id,
      payloadHash,
      parents: sortedParents,
      digest,
      sigR,
      sigS,
    };
  }

  public verifyAndInsertVertex(v: DAGVertex): { accepted: boolean; reason?: string } {
    if (v.dagId !== this.dagId) return { accepted: false, reason: 'DAG ID mismatch' };
    const val = this.validators.get(v.authorId);
    if (!val) return { accepted: false, reason: 'Unknown author validator' };

    const expectedDigest = this.computeVertexDigest(v.round, v.authorId, v.payloadHash, v.parents);
    if (expectedDigest !== v.digest) return { accepted: false, reason: 'Vertex digest mismatch' };
    if (!this.verifySig(val.publicKey, v.digest, v.sigR, v.sigS)) {
      return { accepted: false, reason: 'Invalid author signature' };
    }

    if (v.round === 0) {
      if (v.parents.length !== 0) return { accepted: false, reason: 'Genesis round 0 vertex cannot have parents' };
    } else {
      const uniqueAuthors = new Set<string>();
      for (const pDigest of v.parents) {
        const parent = this.vertices.get(pDigest);
        if (!parent) return { accepted: false, reason: `Missing parent vertex ${pDigest}` };
        if (parent.round !== v.round - 1) return { accepted: false, reason: 'Parent round must equal round - 1' };
        uniqueAuthors.add(parent.authorId);
      }
      if (uniqueAuthors.size < this.getQuorumSize()) {
        return { accepted: false, reason: `Insufficient distinct parent authors: ${uniqueAuthors.size} < ${this.getQuorumSize()}` };
      }
    }

    this.vertices.set(v.digest, v);
    return { accepted: true };
  }

  public computeCausalHistory(anchorDigest: string): string[] {
    if (!this.vertices.has(anchorDigest)) throw new Error(`Anchor vertex ${anchorDigest} not in DAG`);
    const visited = new Set<string>();
    const stack = [anchorDigest];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      const vertex = this.vertices.get(cur)!;
      for (const p of vertex.parents) stack.push(p);
    }

    // Canonical deterministic topological order: ascending (round, authorId, digest)
    return [...visited].sort((a, b) => {
      const va = this.vertices.get(a)!;
      const vb = this.vertices.get(b)!;
      if (va.round !== vb.round) return va.round - vb.round;
      if (va.authorId !== vb.authorId) return va.authorId.localeCompare(vb.authorId);
      return a.localeCompare(b);
    });
  }

  private computeMerkleRoot(items: string[]): string {
    if (items.length === 0) return sha256Hex('DAG-EMPTY-HISTORY');
    let lvl = items.map((d) => sha256Hex('DAG-HIST-LEAF', d));
    while (lvl.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < lvl.length; i += 2) {
        next.push(sha256Hex('DAG-HIST-NODE', lvl[i], i + 1 < lvl.length ? lvl[i + 1] : lvl[i]));
      }
      lvl = next;
    }
    return lvl[0];
  }

  public createCheckpointAnchor(anchorDigest: string, endorsers: DAGValidator[]): DAGCheckpointAnchor {
    const anchor = this.vertices.get(anchorDigest);
    if (!anchor) throw new Error('Anchor vertex not found');
    const orderedHistoryDigests = this.computeCausalHistory(anchorDigest);
    const historyMerkleRoot = this.computeMerkleRoot(orderedHistoryDigests);
    const cpDigest = sha256Hex('DAG-CHECKPOINT-V1', this.dagId, String(anchor.round), anchorDigest, historyMerkleRoot);

    const seen = new Set<string>();
    const endorsements: Array<{ validatorId: string; sigR: bigint; sigS: bigint }> = [];
    for (const val of endorsers) {
      if (!this.validators.has(val.id) || seen.has(val.id)) continue;
      seen.add(val.id);
      const sig = this.signDigest(val, cpDigest);
      endorsements.push({ validatorId: val.id, ...sig });
    }

    if (endorsements.length < this.getQuorumSize()) {
      throw new Error('Insufficient quorum endorsements for DAG checkpoint anchor');
    }

    return {
      dagId: this.dagId,
      anchorRound: anchor.round,
      anchorVertexDigest: anchorDigest,
      orderedHistoryDigests,
      historyMerkleRoot,
      endorsements,
    };
  }

  public verifyCheckpointAnchor(cp: DAGCheckpointAnchor): boolean {
    if (cp.dagId !== this.dagId || cp.orderedHistoryDigests.length === 0) return false;
    if (this.computeMerkleRoot(cp.orderedHistoryDigests) !== cp.historyMerkleRoot) return false;
    if (cp.orderedHistoryDigests[cp.orderedHistoryDigests.length - 1] !== cp.anchorVertexDigest) return false;

    // Verify topological causality: every parent of every vertex appears earlier in orderedHistoryDigests
    const pos = new Map<string, number>();
    cp.orderedHistoryDigests.forEach((d, idx) => pos.set(d, idx));
    for (let idx = 0; idx < cp.orderedHistoryDigests.length; idx++) {
      const v = this.vertices.get(cp.orderedHistoryDigests[idx]);
      if (!v) return false;
      for (const p of v.parents) {
        const pIdx = pos.get(p);
        if (pIdx === undefined || pIdx >= idx) return false;
      }
    }

    const cpDigest = sha256Hex('DAG-CHECKPOINT-V1', this.dagId, String(cp.anchorRound), cp.anchorVertexDigest, cp.historyMerkleRoot);
    const seen = new Set<string>();
    for (const end of cp.endorsements) {
      const rec = this.validators.get(end.validatorId);
      if (!rec || seen.has(end.validatorId)) return false;
      if (!this.verifySig(rec.publicKey, cpDigest, end.sigR, end.sigS)) return false;
      seen.add(end.validatorId);
    }
    return seen.size >= this.getQuorumSize();
  }

  public serializeCheckpoint(cp: DAGCheckpointAnchor): string {
    return JSON.stringify({
      dagId: cp.dagId,
      anchorRound: cp.anchorRound,
      historyCount: cp.orderedHistoryDigests.length,
      endorsementCount: cp.endorsements.length,
      historyMerkleRoot: cp.historyMerkleRoot,
    });
  }
}
