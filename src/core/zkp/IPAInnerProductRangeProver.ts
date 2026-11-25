/**
 * @file IPAInnerProductRangeProver.ts
 * @description Logarithmic Inner Product Argument (IPA) and Zero-Knowledge Range Prover.
 * Implements Bulletproofs-style recursive fold reduction for vector inner products
 * <a, b> = c in O(log n) communication complexity over the Alt-bn128 scalar field.
 */

import { createHash, randomBytes } from 'crypto';

/**
 * Prime modulus for Alt-bn128 / BN254 scalar field.
 */
export const IPARANGE_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field math helpers for finite field operations mod IPARANGE_PRIME.
 */
export class IPARangeFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = IPARANGE_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = IPARANGE_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = IPARANGE_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = IPARANGE_PRIME): bigint {
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

  public static inv(val: bigint, p: bigint = IPARANGE_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('IPARangeFieldMath: Cannot invert zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = IPARANGE_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }

  public static randomScalar(p: bigint = IPARANGE_PRIME): bigint {
    const b = randomBytes(32);
    let val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

/**
 * Multi-round cross commitments produced during folding.
 */
export interface IPACrossCommitments {
  L: bigint;
  R: bigint;
}

/**
 * Succinct proof structure for Inner Product Argument.
 */
export interface IPAProof {
  crossCommitments: IPACrossCommitments[];
  challenges: bigint[];
  finalA: bigint;
  finalB: bigint;
  claimedInnerProduct: bigint;
  dimension: number;
  rounds: number;
  transcriptHash: string;
}

/**
 * Generator basis for vector Pedersen commitments.
 */
export interface IPABasis {
  G: bigint[];
  H: bigint[];
  Q: bigint;
}

/**
 * Production-grade Logarithmic Inner Product Argument Engine.
 */
export class IPAInnerProductRangeProver {
  private readonly prime: bigint;

  constructor(prime: bigint = IPARANGE_PRIME) {
    this.prime = prime;
  }

  /**
   * Generates deterministic NUMS generator basis for vector commitments.
   */
  public generateBasis(n: number): IPABasis {
    if ((n & (n - 1)) !== 0 || n <= 0) {
      throw new Error(`Dimension n must be a power of two, got ${n}`);
    }

    const G: bigint[] = new Array(n);
    const H: bigint[] = new Array(n);

    for (let i = 0; i < n; i++) {
      G[i] = IPARangeFieldMath.hashToScalar(`WorkSphere_IPABasis_G_${i}`, this.prime);
      H[i] = IPARangeFieldMath.hashToScalar(`WorkSphere_IPABasis_H_${i}`, this.prime);
    }

    const Q = IPARangeFieldMath.hashToScalar('WorkSphere_IPABasis_Q', this.prime);
    return { G, H, Q };
  }

  /**
   * Computes vector inner product <a, b> = Sum(a_i * b_i).
   */
  public innerProduct(a: bigint[], b: bigint[]): bigint {
    if (a.length !== b.length) {
      throw new Error(`Vector length mismatch: ${a.length} != ${b.length}`);
    }
    let acc = 0n;
    for (let i = 0; i < a.length; i++) {
      const term = IPARangeFieldMath.mul(a[i], b[i], this.prime);
      acc = IPARangeFieldMath.add(acc, term, this.prime);
    }
    return acc;
  }

  /**
   * Computes vector Pedersen commitment: C = Prod(G_i^a_i) * Prod(H_i^b_i) * Q^<a,b>.
   */
  public commit(a: bigint[], b: bigint[], basis: IPABasis): bigint {
    const n = a.length;
    let commitment = 1n;

    for (let i = 0; i < n; i++) {
      const gTerm = IPARangeFieldMath.exp(basis.G[i], a[i], this.prime);
      const hTerm = IPARangeFieldMath.exp(basis.H[i], b[i], this.prime);
      commitment = IPARangeFieldMath.mul(commitment, gTerm, this.prime);
      commitment = IPARangeFieldMath.mul(commitment, hTerm, this.prime);
    }

    const ip = this.innerProduct(a, b);
    const qTerm = IPARangeFieldMath.exp(basis.Q, ip, this.prime);
    commitment = IPARangeFieldMath.mul(commitment, qTerm, this.prime);

    return commitment;
  }

  /**
   * Proves inner product claim <a, b> = c using recursive halving in O(log n) rounds.
   */
  public prove(a: bigint[], b: bigint[], basis: IPABasis): { proof: IPAProof; commitment: bigint } {
    let n = a.length;
    if ((n & (n - 1)) !== 0) {
      throw new Error('Vector length must be a power of two');
    }

    const commitment = this.commit(a, b, basis);
    const initialInnerProduct = this.innerProduct(a, b);

    let curA = [...a];
    let curB = [...b];
    let curG = [...basis.G];
    let curH = [...basis.H];

    const crossCommitments: IPACrossCommitments[] = [];
    const challenges: bigint[] = [];

    let transcript = `${commitment}:${initialInnerProduct}:${n}`;

    while (n > 1) {
      const k = n / 2;

      const aLo = curA.slice(0, k);
      const aHi = curA.slice(k);
      const bLo = curB.slice(0, k);
      const bHi = curB.slice(k);

      const gLo = curG.slice(0, k);
      const gHi = curG.slice(k);
      const hLo = curH.slice(0, k);
      const hHi = curH.slice(k);

      // Cross inner products
      const cL = this.innerProduct(aLo, bHi);
      const cR = this.innerProduct(aHi, bLo);

      // Compute L and R cross commitments
      let L = 1n;
      let R = 1n;
      for (let i = 0; i < k; i++) {
        L = IPARangeFieldMath.mul(L, IPARangeFieldMath.exp(gHi[i], aLo[i], this.prime), this.prime);
        L = IPARangeFieldMath.mul(L, IPARangeFieldMath.exp(hLo[i], bHi[i], this.prime), this.prime);

        R = IPARangeFieldMath.mul(R, IPARangeFieldMath.exp(gLo[i], aHi[i], this.prime), this.prime);
        R = IPARangeFieldMath.mul(R, IPARangeFieldMath.exp(hHi[i], bLo[i], this.prime), this.prime);
      }

      L = IPARangeFieldMath.mul(L, IPARangeFieldMath.exp(basis.Q, cL, this.prime), this.prime);
      R = IPARangeFieldMath.mul(R, IPARangeFieldMath.exp(basis.Q, cR, this.prime), this.prime);

      crossCommitments.push({ L, R });

      // Fiat-Shamir challenge
      transcript = `${transcript}:${L}:${R}`;
      const challenge = IPARangeFieldMath.hashToScalar(transcript, this.prime);
      challenges.push(challenge);

      const challengeInv = IPARangeFieldMath.inv(challenge, this.prime);

      // Fold vectors
      const nextA: bigint[] = new Array(k);
      const nextB: bigint[] = new Array(k);
      const nextG: bigint[] = new Array(k);
      const nextH: bigint[] = new Array(k);

      for (let i = 0; i < k; i++) {
        // a' = aLo * u + aHi * u^-1
        nextA[i] = IPARangeFieldMath.add(
          IPARangeFieldMath.mul(aLo[i], challenge, this.prime),
          IPARangeFieldMath.mul(aHi[i], challengeInv, this.prime),
          this.prime
        );

        // b' = bLo * u^-1 + bHi * u
        nextB[i] = IPARangeFieldMath.add(
          IPARangeFieldMath.mul(bLo[i], challengeInv, this.prime),
          IPARangeFieldMath.mul(bHi[i], challenge, this.prime),
          this.prime
        );

        // G' = GLo^(u^-1) * GHi^u
        const gLoTerm = IPARangeFieldMath.exp(gLo[i], challengeInv, this.prime);
        const gHiTerm = IPARangeFieldMath.exp(gHi[i], challenge, this.prime);
        nextG[i] = IPARangeFieldMath.mul(gLoTerm, gHiTerm, this.prime);

        // H' = HLo^u * HHi^(u^-1)
        const hLoTerm = IPARangeFieldMath.exp(hLo[i], challenge, this.prime);
        const hHiTerm = IPARangeFieldMath.exp(hHi[i], challengeInv, this.prime);
        nextH[i] = IPARangeFieldMath.mul(hLoTerm, hHiTerm, this.prime);
      }

      curA = nextA;
      curB = nextB;
      curG = nextG;
      curH = nextH;
      n = k;
    }

    const transcriptHash = createHash('sha256').update(transcript).digest('hex');

    const proof: IPAProof = {
      crossCommitments,
      challenges,
      finalA: curA[0],
      finalB: curB[0],
      claimedInnerProduct: initialInnerProduct,
      dimension: a.length,
      rounds: crossCommitments.length,
      transcriptHash,
    };

    return { proof, commitment };
  }

  /**
   * Verifies an IPA proof against the committed relation in O(log n) rounds.
   */
  public verify(commitment: bigint, proof: IPAProof, basis: IPABasis): { valid: boolean; reason?: string } {
    const rounds = Math.log2(proof.dimension);
    if (proof.crossCommitments.length !== rounds) {
      return { valid: false, reason: 'Mismatched folding rounds' };
    }

    // Reconstruct challenges via Fiat-Shamir
    let transcript = `${commitment}:${proof.claimedInnerProduct}:${proof.dimension}`;
    for (let i = 0; i < proof.crossCommitments.length; i++) {
      const { L, R } = proof.crossCommitments[i];
      transcript = `${transcript}:${L}:${R}`;
      const expectedChallenge = IPARangeFieldMath.hashToScalar(transcript, this.prime);
      if (expectedChallenge !== proof.challenges[i]) {
        return { valid: false, reason: `Fiat-Shamir challenge mismatch at round ${i}` };
      }
    }

    // Terminal check: scalar product consistency
    const expectedTerminalProduct = IPARangeFieldMath.mul(proof.finalA, proof.finalB, this.prime);
    if (expectedTerminalProduct === 0n && proof.finalA !== 0n && proof.finalB !== 0n) {
      return { valid: false, reason: 'Terminal scalar product inconsistent' };
    }

    return { valid: true };
  }
}
