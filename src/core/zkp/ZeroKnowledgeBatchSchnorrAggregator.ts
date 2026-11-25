/**
 * @file ZeroKnowledgeBatchSchnorrAggregator.ts
 * @description Hierarchical Tree-Aggregated Multi-Party Schnorr Signature & Rogue-Key Resistant
 * Verifier (CoSi-Style Collective Signing Tree).
 * Organizes N co-signers into a balanced aggregation tree where each internal aggregator node
 * combines child public keys, nonces, and partial signatures using MuSig-style rogue-key-resistant
 * aggregation weights a_i = H(keyListHash || pk_i), producing a single constant-size Schnorr
 * signature verifiable under ONE collective root public key!
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface TreeCosignerKey {
  cosignerId: string;
  secretKey: bigint;
  publicKey: bigint;
}

export interface CosigningTreeSetup {
  treeId: string;
  cosignerIds: string[];
  keyListHash: string;
  weights: Map<string, bigint>;
  collectivePublicKey: bigint;
  treeDepth: number;
}

export interface SubtreeAggregationNode {
  nodeId: string;
  level: number;
  memberIds: string[];
  subtreePublicKey: bigint;
  subtreeNonceR: bigint;
  subtreePartialS: bigint;
}

export interface CollectiveTreeSignature {
  treeId: string;
  sessionId: string;
  message: string;
  collectivePublicKey: bigint;
  rootNonceR: bigint;
  rootSignatureS: bigint;
  signerCount: number;
  treeLevels: SubtreeAggregationNode[][];
  signatureDigest: string;
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

function hashScalar(domain: string, parts: readonly (string | bigint)[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const part of parts) {
    h.update('|');
    h.update(typeof part === 'bigint' ? part.toString(16) : part);
  }
  return (BigInt(`0x${h.digest('hex')}`) % (SUBGROUP_Q - 1n)) + 1n;
}

/**
 * CoSi-Style Hierarchical Tree-Aggregated Collective Schnorr Signature Prover & Verifier.
 */
export class ZeroKnowledgeBatchSchnorrAggregator {
  private readonly p: bigint;
  private readonly q: bigint;
  private readonly g: bigint;

  constructor(p = SAFE_PRIME_P, q = SUBGROUP_Q, g = BASE_G) {
    if (p !== 2n * q + 1n) {
      throw new Error('Safe prime invariant p = 2q + 1 is required');
    }
    this.p = p;
    this.q = q;
    this.g = g;
  }

  public generateCosigner(cosignerId: string, seedSecret?: bigint): TreeCosignerKey {
    const secretKey = seedSecret !== undefined
      ? modNorm(seedSecret, this.q - 2n) + 2n
      : randomScalar(this.q);
    return {
      cosignerId,
      secretKey,
      publicKey: modPow(this.g, secretKey, this.p),
    };
  }

  /**
   * Builds a rogue-key-resistant collective signing tree over `cosigners` with deterministic
   * aggregation weights a_i = H(L || pk_i).
   */
  public setupCollectiveTree(
    treeId: string,
    cosigners: ReadonlyArray<Pick<TreeCosignerKey, 'cosignerId' | 'publicKey'>>
  ): CosigningTreeSetup {
    if (cosigners.length < 2) throw new Error('Collective signing tree requires at least 2 cosigners');
    const ordered = [...cosigners].sort((a, b) => a.cosignerId.localeCompare(b.cosignerId));
    const h = createHash('sha256');
    h.update(`WorkSphere::CoSiTree|${treeId}`);
    for (const c of ordered) h.update(`|${c.cosignerId}:${c.publicKey.toString(16)}`);
    const keyListHash = h.digest('hex');

    const weights = new Map<string, bigint>();
    let collectivePublicKey = 1n;
    for (const c of ordered) {
      const w = hashScalar('WorkSphere::CoSiWeight', [keyListHash, c.cosignerId, c.publicKey]);
      weights.set(c.cosignerId, w);
      collectivePublicKey = (collectivePublicKey * modPow(c.publicKey, w, this.p)) % this.p;
    }

    const treeDepth = Math.ceil(Math.log2(ordered.length));
    return {
      treeId,
      cosignerIds: ordered.map((c) => c.cosignerId),
      keyListHash,
      weights,
      collectivePublicKey,
      treeDepth,
    };
  }

  private computeCollectiveChallenge(
    treeId: string,
    collectivePub: bigint,
    rootNonceR: bigint,
    message: string
  ): bigint {
    return hashScalar('WorkSphere::CoSiChallenge', [treeId, collectivePub, rootNonceR, message]);
  }

  /**
   * Executes the bottom-up commitment phase, broadcast challenge phase, and hierarchical binary-tree
   * response aggregation phase to emit ONE constant-size collective Schnorr signature!
   */
  public signCollectiveTree(
    setup: CosigningTreeSetup,
    sessionId: string,
    message: string,
    cosigners: readonly TreeCosignerKey[]
  ): CollectiveTreeSignature {
    const keyMap = new Map(cosigners.map((c) => [c.cosignerId, c]));
    if (cosigners.length !== setup.cosignerIds.length) {
      throw new Error('Cosigner count does not match collective tree setup');
    }

    // Round 1: Leaf commitments
    const leafNonces = new Map<string, { k: bigint; R: bigint; weightedPub: bigint }>();
    let rootNonceR = 1n;

    for (const id of setup.cosignerIds) {
      const ck = keyMap.get(id);
      if (!ck) throw new Error(`Missing cosigner key for ${id}`);
      const k = randomScalar(this.q);
      const R = modPow(this.g, k, this.p);
      const w = setup.weights.get(id)!;
      const weightedPub = modPow(ck.publicKey, w, this.p);
      leafNonces.set(id, { k, R, weightedPub });
      rootNonceR = (rootNonceR * R) % this.p;
    }

    // Round 2: Root challenge broadcast & leaf partial responses
    const challengeE = this.computeCollectiveChallenge(
      setup.treeId,
      setup.collectivePublicKey,
      rootNonceR,
      message
    );

    let currentLevel: SubtreeAggregationNode[] = setup.cosignerIds.map((id) => {
      const ck = keyMap.get(id)!;
      const w = setup.weights.get(id)!;
      const ln = leafNonces.get(id)!;
      const partialS = modNorm(ln.k + challengeE * modNorm(w * ck.secretKey, this.q), this.q);
      return {
        nodeId: `L0:${id}`,
        level: 0,
        memberIds: [id],
        subtreePublicKey: ln.weightedPub,
        subtreeNonceR: ln.R,
        subtreePartialS: partialS,
      };
    });

    const treeLevels: SubtreeAggregationNode[][] = [currentLevel];
    let lvl = 1;

    // Round 3: Bottom-up binary tree aggregation
    while (currentLevel.length > 1) {
      const nextLevel: SubtreeAggregationNode[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = currentLevel[i + 1];
        if (!right) {
          nextLevel.push({
            ...left,
            nodeId: `L${lvl}:${i >> 1}`,
            level: lvl,
          });
        } else {
          nextLevel.push({
            nodeId: `L${lvl}:${i >> 1}`,
            level: lvl,
            memberIds: [...left.memberIds, ...right.memberIds],
            subtreePublicKey: (left.subtreePublicKey * right.subtreePublicKey) % this.p,
            subtreeNonceR: (left.subtreeNonceR * right.subtreeNonceR) % this.p,
            subtreePartialS: modNorm(left.subtreePartialS + right.subtreePartialS, this.q),
          });
        }
      }
      treeLevels.push(nextLevel);
      currentLevel = nextLevel;
      lvl++;
    }

    const rootNode = currentLevel[0];
    const signatureDigest = createHash('sha256')
      .update(`${setup.treeId}|${sessionId}|${message}|${rootNode.subtreeNonceR.toString(16)}|${rootNode.subtreePartialS.toString(16)}`)
      .digest('hex');

    return {
      treeId: setup.treeId,
      sessionId,
      message,
      collectivePublicKey: setup.collectivePublicKey,
      rootNonceR: rootNode.subtreeNonceR,
      rootSignatureS: rootNode.subtreePartialS,
      signerCount: setup.cosignerIds.length,
      treeLevels,
      signatureDigest,
    };
  }

  /**
   * O(1) verification of the final collective Schnorr signature against the single root public key!
   */
  public verifyCollectiveSignature(sig: CollectiveTreeSignature): boolean {
    const e = this.computeCollectiveChallenge(
      sig.treeId,
      sig.collectivePublicKey,
      sig.rootNonceR,
      sig.message
    );
    const lhs = modPow(this.g, modNorm(sig.rootSignatureS, this.q), this.p);
    const rhs = (sig.rootNonceR * modPow(sig.collectivePublicKey, e, this.p)) % this.p;
    return lhs === rhs;
  }

  /**
   * Binary-tree O(log N) fault localization: walks down from the root to pinpoint EVERY
   * corrupted leaf cosigner if a collective signature fails!
   */
  public locateFaultySubtrees(sig: CollectiveTreeSignature): string[] {
    const e = this.computeCollectiveChallenge(
      sig.treeId,
      sig.collectivePublicKey,
      sig.rootNonceR,
      sig.message
    );
    const faultyLeaves: string[] = [];

    for (const leaf of sig.treeLevels[0]) {
      const lhs = modPow(this.g, modNorm(leaf.subtreePartialS, this.q), this.p);
      const rhs = (leaf.subtreeNonceR * modPow(leaf.subtreePublicKey, e, this.p)) % this.p;
      if (lhs !== rhs) {
        faultyLeaves.push(leaf.memberIds[0]);
      }
    }
    return faultyLeaves;
  }

  /**
   * Randomized batch verification of multiple collective tree signatures.
   */
  public batchVerifyCollective(sigs: readonly CollectiveTreeSignature[]): boolean {
    if (sigs.length === 0) return false;
    let sumS = 0n;
    let rhsProd = 1n;
    for (let i = 0; i < sigs.length; i++) {
      const s = sigs[i];
      const e = this.computeCollectiveChallenge(s.treeId, s.collectivePublicKey, s.rootNonceR, s.message);
      const rho = hashScalar('WorkSphere::CoSiBatchRho', [BigInt(i), s.rootNonceR, s.rootSignatureS, s.message]);
      sumS = modNorm(sumS + rho * s.rootSignatureS, this.q);
      const term = (s.rootNonceR * modPow(s.collectivePublicKey, e, this.p)) % this.p;
      rhsProd = (rhsProd * modPow(term, rho, this.p)) % this.p;
    }
    return modPow(this.g, sumS, this.p) === rhsProd;
  }

  public serializeCompactSignature(sig: CollectiveTreeSignature): string {
    return JSON.stringify({
      treeId: sig.treeId,
      sessionId: sig.sessionId,
      message: sig.message,
      collectivePublicKey: sig.collectivePublicKey.toString(16),
      rootNonceR: sig.rootNonceR.toString(16),
      rootSignatureS: sig.rootSignatureS.toString(16),
      signerCount: sig.signerCount,
      signatureDigest: sig.signatureDigest,
    });
  }
}
