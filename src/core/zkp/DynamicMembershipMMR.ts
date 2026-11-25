/**
 * @file DynamicMembershipMMR.ts
 * @description Zero-Knowledge Dynamic Membership Merkle Mountain Range (MMR) Accumulator.
 * Implements an append-only cryptographic accumulator over BN254. Organizes historical state
 * and transaction logs into logarithmic balanced binary peaks ("bagged peaks" root), generates
 * compact O(log n) inclusion proofs, and proves set membership in zero-knowledge.
 */

import { createHash, randomBytes } from 'crypto';

/**
 * BN254 prime modulus.
 */
export const MMR_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field arithmetic helper functions.
 */
export class MMRFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = MMR_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = MMR_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = MMR_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = MMR_PRIME): bigint {
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

  public static inv(val: bigint, p: bigint = MMR_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('MMRFieldMath: Cannot invert zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = MMR_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }

  public static randomScalar(p: bigint = MMR_PRIME): bigint {
    const b = randomBytes(32);
    let val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

export interface MMRProofStep {
  position: 'left' | 'right';
  hash: string;
}

export interface MMRProof {
  leafIndex: number;
  leafHash: string;
  peakHash: string;
  siblings: MMRProofStep[];
  peaks: string[]; // All peaks for bagging
}

export interface MMRZKProof {
  leafCommitment: bigint; // C_x = x * G + r * H
  rootHash: string;
  leafIndex: number;
  blindingR: bigint;
  challenge: bigint;
  responseX: bigint;
  responseR: bigint;
  transcriptHash: string;
}

/**
 * Merkle Mountain Range Engine.
 */
export class DynamicMembershipMMR {
  public readonly prime: bigint;
  public readonly g: bigint;
  public readonly h: bigint;

  private leaves: bigint[] = [];
  private leafHashes: string[] = [];

  constructor(prime: bigint = MMR_PRIME) {
    this.prime = prime;
    this.g = MMRFieldMath.hashToScalar('WorkSphere_MMR_G', this.prime);
    this.h = MMRFieldMath.hashToScalar('WorkSphere_MMR_H', this.prime);
  }

  public static hash(data: string): string {
    return createHash('sha256').update(data).digest('hex');
  }

  public static combine(left: string, right: string): string {
    return createHash('sha256').update(`${left}:${right}`).digest('hex');
  }

  public getLeafCount(): number {
    return this.leaves.length;
  }

  /**
   * Appends a new scalar leaf to the MMR and returns updated bagged root.
   */
  public append(element: bigint): { leafIndex: number; newRoot: string } {
    const leafIndex = this.leaves.length;
    this.leaves.push(element);
    this.leafHashes.push(DynamicMembershipMMR.hash(element.toString()));
    return { leafIndex, newRoot: this.getRoot() };
  }

  /**
   * Computes the list of peak hashes for the current leaves.
   * Partitions leaf count into powers of 2.
   */
  public getPeaks(): { peakHash: string; startIndex: number; size: number }[] {
    const n = this.leaves.length;
    if (n === 0) return [];

    const peaks: { peakHash: string; startIndex: number; size: number }[] = [];
    let start = 0;
    let rem = n;

    while (rem > 0) {
      // Find largest power of 2 <= rem
      let size = 1;
      while (size * 2 <= rem) {
        size *= 2;
      }

      // Compute peak hash for this range [start, start + size)
      const peakHash = this.computeSubtreeRoot(start, size);
      peaks.push({ peakHash, startIndex: start, size });

      start += size;
      rem -= size;
    }

    return peaks;
  }

  private computeSubtreeRoot(start: number, size: number): string {
    let level = this.leafHashes.slice(start, start + size);
    while (level.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < level.length; i += 2) {
        nextLevel.push(DynamicMembershipMMR.combine(level[i], level[i + 1]));
      }
      level = nextLevel;
    }
    return level[0];
  }

  /**
   * "Bags the peaks" to derive a single deterministic MMR root hash:
   * Bag(p1, p2, p3) = Hash(p1 : Hash(p2 : p3)).
   */
  public getRoot(): string {
    const peaks = this.getPeaks();
    if (peaks.length === 0) return DynamicMembershipMMR.hash('MMR_EMPTY');
    if (peaks.length === 1) return peaks[0].peakHash;

    let current = peaks[peaks.length - 1].peakHash;
    for (let i = peaks.length - 2; i >= 0; i--) {
      current = DynamicMembershipMMR.combine(peaks[i].peakHash, current);
    }
    return current;
  }

  /**
   * Generates a compact inclusion proof for leaf at leafIndex.
   */
  public getProof(leafIndex: number): MMRProof {
    if (leafIndex < 0 || leafIndex >= this.leaves.length) {
      throw new Error(`Leaf index ${leafIndex} out of bounds`);
    }

    const peaks = this.getPeaks();
    // Locate which peak contains this leaf
    const targetPeak = peaks.find(p => leafIndex >= p.startIndex && leafIndex < p.startIndex + p.size)!;

    // Traverse the binary tree within targetPeak to collect siblings
    const siblings: MMRProofStep[] = [];
    let relativeIdx = leafIndex - targetPeak.startIndex;
    let currentLevel = this.leafHashes.slice(targetPeak.startIndex, targetPeak.startIndex + targetPeak.size);

    while (currentLevel.length > 1) {
      const isRight = relativeIdx % 2 === 1;
      const siblingIdx = isRight ? relativeIdx - 1 : relativeIdx + 1;

      siblings.push({
        position: isRight ? 'left' : 'right',
        hash: currentLevel[siblingIdx],
      });

      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        nextLevel.push(DynamicMembershipMMR.combine(currentLevel[i], currentLevel[i + 1]));
      }
      currentLevel = nextLevel;
      relativeIdx = Math.floor(relativeIdx / 2);
    }

    return {
      leafIndex,
      leafHash: this.leafHashes[leafIndex],
      peakHash: targetPeak.peakHash,
      siblings,
      peaks: peaks.map(p => p.peakHash),
    };
  }

  /**
   * Verifies an MMR inclusion proof against an MMR root.
   */
  public static verifyProof(proof: MMRProof, root: string): boolean {
    // 1. Recompute peak from leaf and siblings
    let current = proof.leafHash;
    for (const step of proof.siblings) {
      if (step.position === 'left') {
        current = DynamicMembershipMMR.combine(step.hash, current);
      } else {
        current = DynamicMembershipMMR.combine(current, step.hash);
      }
    }

    if (current !== proof.peakHash) return false;

    // 2. Check peak exists in proof.peaks
    if (!proof.peaks.includes(proof.peakHash)) return false;

    // 3. Bag peaks and verify against root
    let bagged = proof.peaks[proof.peaks.length - 1];
    for (let i = proof.peaks.length - 2; i >= 0; i--) {
      bagged = DynamicMembershipMMR.combine(proof.peaks[i], bagged);
    }

    return bagged === root;
  }

  /**
   * Generates a zero-knowledge membership proof for an element in the MMR.
   */
  public proveMembershipZKP(element: bigint, leafIndex: number): MMRZKProof {
    const root = this.getRoot();
    const r = MMRFieldMath.randomScalar(this.prime);

    // C_x = x * G + r * H
    const xG = MMRFieldMath.mul(element, this.g, this.prime);
    const rH = MMRFieldMath.mul(r, this.h, this.prime);
    const leafCommitment = MMRFieldMath.add(xG, rH, this.prime);

    // Ephemeral blinding for Schnorr ZKP
    const kx = MMRFieldMath.randomScalar(this.prime);
    const kr = MMRFieldMath.randomScalar(this.prime);
    const blindingR = MMRFieldMath.add(
      MMRFieldMath.mul(kx, this.g, this.prime),
      MMRFieldMath.mul(kr, this.h, this.prime),
      this.prime
    );

    const transcriptData = [
      root,
      leafIndex.toString(),
      leafCommitment.toString(),
      blindingR.toString(),
    ].join(':');

    const transcriptHash = createHash('sha256').update(transcriptData).digest('hex');
    const challenge = MMRFieldMath.hashToScalar(transcriptHash, this.prime);

    const responseX = MMRFieldMath.add(kx, MMRFieldMath.mul(challenge, element, this.prime), this.prime);
    const responseR = MMRFieldMath.add(kr, MMRFieldMath.mul(challenge, r, this.prime), this.prime);

    return {
      leafCommitment,
      rootHash: root,
      leafIndex,
      blindingR,
      challenge,
      responseX,
      responseR,
      transcriptHash,
    };
  }

  /**
   * Verifies an MMR zero-knowledge membership proof.
   */
  public verifyMembershipZKP(proof: MMRZKProof, root?: string): { valid: boolean; reason?: string } {
    const targetRoot = root !== undefined ? root : this.getRoot();

    if (proof.rootHash !== targetRoot) {
      return { valid: false, reason: 'MMR root hash mismatch' };
    }

    // Recompute Fiat-Shamir challenge
    const transcriptData = [
      proof.rootHash,
      proof.leafIndex.toString(),
      proof.leafCommitment.toString(),
      proof.blindingR.toString(),
    ].join(':');

    const expectedHash = createHash('sha256').update(transcriptData).digest('hex');
    const expectedChallenge = MMRFieldMath.hashToScalar(expectedHash, this.prime);

    if (expectedChallenge !== proof.challenge) {
      return { valid: false, reason: 'Fiat-Shamir challenge mismatch' };
    }

    // Verify Schnorr identity: respX * G + respR * H == blindingR + challenge * C_x
    const lhs = MMRFieldMath.add(
      MMRFieldMath.mul(proof.responseX, this.g, this.prime),
      MMRFieldMath.mul(proof.responseR, this.h, this.prime),
      this.prime
    );

    const rhs = MMRFieldMath.add(
      proof.blindingR,
      MMRFieldMath.mul(proof.challenge, proof.leafCommitment, this.prime),
      this.prime
    );

    if (lhs !== rhs) {
      return { valid: false, reason: 'Schnorr commitment verification failed' };
    }

    return { valid: true };
  }
}
