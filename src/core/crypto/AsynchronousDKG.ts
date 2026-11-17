/**
 * @file AsynchronousDKG.ts
 * @description Asynchronous Distributed Key Generation (A-DKG) Engine.
 * Implements non-interactive, leaderless threshold key generation without a trusted dealer over BN254.
 * Nodes run independent verifiable secret sharing instances, verify incoming shares, aggregate
 * a qualified core set Q of size >= n - f, and derive a master public key and consistent threshold shares.
 */

import { createHash, randomBytes } from 'crypto';

/**
 * Prime modulus for Alt-bn128 / BN254.
 */
export const ADKG_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field arithmetic helper functions.
 */
export class ADKGFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = ADKG_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = ADKG_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = ADKG_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = ADKG_PRIME): bigint {
    let res = 1n;
    let b = ((base % p) + p) % p;
    let e = exponent < 0n ? (exponent % (p - 1n)) + (p - 1n) : exponent % (p - 1n);
    while (e > 0n) {
      if (e & 1n) {
        res = (res * b) % p;
      }
      b = (b * b) % p;
      e >>= 1n;
    }
    return res;
  }

  public static inv(val: bigint, p: bigint = ADKG_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('ADKGFieldMath: Cannot invert zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = ADKG_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }

  public static randomScalar(p: bigint = ADKG_PRIME): bigint {
    const b = randomBytes(32);
    let val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

export interface DKGShare {
  dealerId: number;
  recipientId: number;
  shareS: bigint;
  shareR: bigint;
}

export interface DKGContribution {
  dealerId: number;
  commitments: bigint[];
  shares: DKGShare[];
}

export interface CombinedKeyShare {
  nodeId: number;
  combinedSecretShare: bigint;
  combinedBlindingShare: bigint;
  coreDealers: number[];
}

export interface DKGResult {
  masterPublicKey: bigint;
  threshold: number;
  totalNodes: number;
  coreDealers: number[];
  nodeShares: Map<number, CombinedKeyShare>;
}

/**
 * An individual participant in the A-DKG protocol.
 */
export class AsynchronousDKGNode {
  public readonly nodeId: number;
  public readonly totalNodes: number;
  public readonly threshold: number;
  public readonly prime: bigint;
  public readonly g: bigint;
  public readonly h: bigint;

  private receivedShares: Map<number, DKGShare> = new Map();
  private dealerCommitments: Map<number, bigint[]> = new Map();

  constructor(nodeId: number, totalNodes: number, threshold: number, prime: bigint = ADKG_PRIME) {
    this.nodeId = nodeId;
    this.totalNodes = totalNodes;
    this.threshold = threshold;
    this.prime = prime;
    this.g = ADKGFieldMath.hashToScalar('WorkSphere_ADKG_G', this.prime);
    this.h = ADKGFieldMath.hashToScalar('WorkSphere_ADKG_H', this.prime);
  }

  public commit(a: bigint, b: bigint): bigint {
    const ga = ADKGFieldMath.mul(a, this.g, this.prime);
    const hb = ADKGFieldMath.mul(b, this.h, this.prime);
    return ADKGFieldMath.add(ga, hb, this.prime);
  }

  private evaluatePolynomial(coeffs: bigint[], x: bigint): bigint {
    let result = 0n;
    let power = 1n;
    for (let k = 0; k < coeffs.length; k++) {
      const term = ADKGFieldMath.mul(coeffs[k], power, this.prime);
      result = ADKGFieldMath.add(result, term, this.prime);
      power = ADKGFieldMath.mul(power, x, this.prime);
    }
    return result;
  }

  /**
   * Generates polynomial contribution and commitments as dealer.
   */
  public generateContribution(): DKGContribution {
    const polyA: bigint[] = [];
    const polyB: bigint[] = [];

    for (let k = 0; k < this.threshold; k++) {
      polyA.push(ADKGFieldMath.randomScalar(this.prime));
      polyB.push(ADKGFieldMath.randomScalar(this.prime));
    }

    const commitments: bigint[] = new Array(this.threshold);
    for (let k = 0; k < this.threshold; k++) {
      commitments[k] = this.commit(polyA[k], polyB[k]);
    }

    const shares: DKGShare[] = [];
    for (let j = 1; j <= this.totalNodes; j++) {
      const x = BigInt(j);
      shares.push({
        dealerId: this.nodeId,
        recipientId: j,
        shareS: this.evaluatePolynomial(polyA, x),
        shareR: this.evaluatePolynomial(polyB, x),
      });
    }

    return {
      dealerId: this.nodeId,
      commitments,
      shares,
    };
  }

  /**
   * Verifies an incoming share from a dealer.
   */
  public verifyShare(share: DKGShare, commitments: bigint[]): boolean {
    if (share.recipientId !== this.nodeId) return false;

    const lhs = this.commit(share.shareS, share.shareR);

    let rhs = 0n;
    let power = 1n;
    const x = BigInt(this.nodeId);

    for (let k = 0; k < commitments.length; k++) {
      const term = ADKGFieldMath.mul(commitments[k], power, this.prime);
      rhs = ADKGFieldMath.add(rhs, term, this.prime);
      power = ADKGFieldMath.mul(power, x, this.prime);
    }

    return lhs === rhs;
  }

  /**
   * Records a validated share from dealer.
   */
  public receiveShare(share: DKGShare, commitments: bigint[]): boolean {
    if (!this.verifyShare(share, commitments)) {
      return false;
    }
    this.receivedShares.set(share.dealerId, share);
    this.dealerCommitments.set(share.dealerId, commitments);
    return true;
  }

  /**
   * Combines shares across the agreed core set Q of dealers.
   */
  public deriveCombinedKeyShare(coreDealers: number[]): CombinedKeyShare {
    let combinedSecretShare = 0n;
    let combinedBlindingShare = 0n;

    for (const dealerId of coreDealers) {
      const share = this.receivedShares.get(dealerId);
      if (!share) {
        throw new Error(`Node ${this.nodeId} missing valid share from core dealer ${dealerId}`);
      }
      combinedSecretShare = ADKGFieldMath.add(combinedSecretShare, share.shareS, this.prime);
      combinedBlindingShare = ADKGFieldMath.add(combinedBlindingShare, share.shareR, this.prime);
    }

    return {
      nodeId: this.nodeId,
      combinedSecretShare,
      combinedBlindingShare,
      coreDealers,
    };
  }
}

/**
 * Cluster simulation coordinator for A-DKG execution.
 */
export class AsynchronousDKGCluster {
  public readonly totalNodes: number;
  public readonly threshold: number;
  public readonly nodes: Map<number, AsynchronousDKGNode> = new Map();

  constructor(totalNodes: number, threshold: number) {
    this.totalNodes = totalNodes;
    this.threshold = threshold;
    for (let i = 1; i <= totalNodes; i++) {
      this.nodes.set(i, new AsynchronousDKGNode(i, totalNodes, threshold));
    }
  }

  public runDKG(): DKGResult {
    // Phase 1: All nodes generate dealer contributions
    const contributions: DKGContribution[] = [];
    for (const node of this.nodes.values()) {
      contributions.push(node.generateContribution());
    }

    // Phase 2: Disseminate and verify shares
    for (const contrib of contributions) {
      for (const share of contrib.shares) {
        const recipient = this.nodes.get(share.recipientId);
        if (recipient) {
          recipient.receiveShare(share, contrib.commitments);
        }
      }
    }

    // Phase 3: Core set agreement (first n - f honest dealers)
    const f = Math.floor((this.totalNodes - 1) / 3);
    const coreSize = this.totalNodes - f;
    const coreDealers: number[] = contributions.slice(0, coreSize).map(c => c.dealerId);

    // Compute master public key Y = sum_{i in Core} C_{i, 0}
    let masterPublicKey = 0n;
    for (const dealerId of coreDealers) {
      const contrib = contributions.find(c => c.dealerId === dealerId)!;
      masterPublicKey = ADKGFieldMath.add(masterPublicKey, contrib.commitments[0], ADKG_PRIME);
    }

    // Phase 4: Derive combined key shares for each participant
    const nodeShares = new Map<number, CombinedKeyShare>();
    for (const [id, node] of this.nodes) {
      nodeShares.set(id, node.deriveCombinedKeyShare(coreDealers));
    }

    return {
      masterPublicKey,
      threshold: this.threshold,
      totalNodes: this.totalNodes,
      coreDealers,
      nodeShares,
    };
  }

  /**
   * Reconstructs the master secret from any threshold combined shares using Lagrange interpolation.
   */
  public reconstructMasterSecret(
    shares: CombinedKeyShare[],
    threshold: number
  ): { secret: bigint; blinding: bigint } {
    if (shares.length < threshold) {
      throw new Error(`Insufficient shares for reconstruction: need ${threshold}, got ${shares.length}`);
    }

    const active = shares.slice(0, threshold);
    let secret = 0n;
    let blinding = 0n;

    for (let i = 0; i < threshold; i++) {
      const xi = BigInt(active[i].nodeId);
      let num = 1n;
      let den = 1n;

      for (let j = 0; j < threshold; j++) {
        if (i === j) continue;
        const xj = BigInt(active[j].nodeId);
        num = ADKGFieldMath.mul(num, ADKGFieldMath.sub(0n, xj, ADKG_PRIME), ADKG_PRIME);
        const diff = ADKGFieldMath.sub(xi, xj, ADKG_PRIME);
        den = ADKGFieldMath.mul(den, diff, ADKG_PRIME);
      }

      const lambda_i = ADKGFieldMath.mul(num, ADKGFieldMath.inv(den, ADKG_PRIME), ADKG_PRIME);

      secret = ADKGFieldMath.add(secret, ADKGFieldMath.mul(lambda_i, active[i].combinedSecretShare, ADKG_PRIME), ADKG_PRIME);
      blinding = ADKGFieldMath.add(blinding, ADKGFieldMath.mul(lambda_i, active[i].combinedBlindingShare, ADKG_PRIME), ADKG_PRIME);
    }

    return { secret, blinding };
  }
}
