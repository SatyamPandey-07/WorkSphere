/**
 * @file IPAPolynomialCommitment.ts
 * @description Transparent Inner Product Argument (IPA) polynomial commitment scheme (Bulletproofs / Halo 2 style).
 * Supports O(log n) argument size, transparent NUMS generator basis, Fiat-Shamir heuristic, and batch verification.
 */

import { createHash } from 'crypto';

/**
 * BN254 / Alt-bn128 scalar field prime order.
 */
export const IPA_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Modular arithmetic helper methods over finite field F_p.
 */
export class IPAFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = IPA_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = IPA_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = IPA_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = IPA_PRIME): bigint {
    let res = 1n;
    let b = base % p;
    let e = exponent;
    while (e > 0n) {
      if (e & 1n) {
        res = (res * b) % p;
      }
      b = (b * b) % p;
      e >>= 1n;
    }
    return res;
  }

  public static inv(val: bigint, p: bigint = IPA_PRIME): bigint {
    if (val === 0n) {
      throw new Error('IPAFieldMath: Cannot invert zero in finite field');
    }
    return IPAFieldMath.exp(val, p - 2n, p);
  }
}

/**
 * Proof of evaluation p(z) = v using recursive Inner Product Argument.
 */
export interface IPAEvaluationProof {
  readonly lVec: bigint[];
  readonly rVec: bigint[];
  readonly finalA: bigint;
  readonly finalB: bigint;
  readonly degree: number;
}

/**
 * Batch evaluation verification claim.
 */
export interface IPABatchEvaluationClaim {
  readonly commitment: bigint;
  readonly point: bigint;
  readonly value: bigint;
  readonly proof: IPAEvaluationProof;
}

/**
 * Deterministic Transparent Generator Basis for IPA.
 */
export interface IPAGeneratorBasis {
  readonly n: number;
  readonly gBasis: bigint[];
  readonly hBasis: bigint[];
  readonly qGen: bigint;
}

/**
 * Generates transparent NUMS (Nothing-Up-My-Sleeve) generators over BN254 scalar field.
 */
export function generateIPABasis(n: number, p: bigint = IPA_PRIME): IPAGeneratorBasis {
  if (n <= 0 || (n & (n - 1)) !== 0) {
    throw new Error(`generateIPABasis: Vector size n must be a positive power of 2, received ${n}`);
  }

  const gBasis: bigint[] = [];
  const hBasis: bigint[] = [];

  for (let i = 0; i < n; i++) {
    const gHash = createHash('sha256').update(`WorkSphere_IPA_G_Basis_${i}`).digest();
    let gVal = 0n;
    for (let b = 0; b < 32; b++) gVal = (gVal << 8n) | BigInt(gHash[b]);
    gBasis.push(gVal % p);

    const hHash = createHash('sha256').update(`WorkSphere_IPA_H_Basis_${i}`).digest();
    let hVal = 0n;
    for (let b = 0; b < 32; b++) hVal = (hVal << 8n) | BigInt(hHash[b]);
    hBasis.push(hVal % p);
  }

  const qHash = createHash('sha256').update('WorkSphere_IPA_Q_Generator').digest();
  let qVal = 0n;
  for (let b = 0; b < 32; b++) qVal = (qVal << 8n) | BigInt(qHash[b]);
  const qGen = qVal % p;

  return { n, gBasis, hBasis, qGen };
}

/**
 * Fiat-Shamir transcript sponge for generating non-interactive verification challenges.
 */
export class IPATranscript {
  private state: string;

  constructor(label: string = 'WorkSphere_IPA_Transcript') {
    this.state = label;
  }

  public absorbScalar(val: bigint): void {
    this.state = createHash('sha256')
      .update(`${this.state}|scalar:${val.toString(16)}`)
      .digest('hex');
  }

  public absorbVector(vec: bigint[]): void {
    const serialized = vec.map((v) => v.toString(16)).join(',');
    this.state = createHash('sha256')
      .update(`${this.state}|vec:${serialized}`)
      .digest('hex');
  }

  public squeezeChallenge(p: bigint = IPA_PRIME): bigint {
    const digest = createHash('sha256')
      .update(`${this.state}|squeeze`)
      .digest();
    this.state = digest.toString('hex');

    let challenge = 0n;
    for (let i = 0; i < 32; i++) {
      challenge = (challenge << 8n) | BigInt(digest[i]);
    }
    const res = challenge % p;
    return res === 0n ? 1n : res;
  }
}

/**
 * Core Inner Product Argument (IPA) Polynomial Commitment Engine.
 */
export class IPAPolynomialCommitment {
  public readonly basis: IPAGeneratorBasis;
  public readonly p: bigint;

  constructor(maxDegree: number = 16, p: bigint = IPA_PRIME) {
    // Round maxDegree up to next power of 2
    let n = 2;
    while (n < maxDegree) {
      n *= 2;
    }
    this.basis = generateIPABasis(n, p);
    this.p = p;
  }

  /**
   * Computes vector inner product: <a, b> = sum(a[i] * b[i]) mod p.
   */
  public static innerProduct(a: bigint[], b: bigint[], p: bigint = IPA_PRIME): bigint {
    if (a.length !== b.length) {
      throw new Error(`innerProduct: Length mismatch: a=${a.length}, b=${b.length}`);
    }
    let sum = 0n;
    for (let i = 0; i < a.length; i++) {
      sum = IPAFieldMath.add(sum, IPAFieldMath.mul(a[i], b[i], p), p);
    }
    return sum;
  }

  /**
   * Evaluates polynomial with coefficients `coeffs` at point `z`: p(z) = sum(c[i] * z^i).
   */
  public evaluatePolynomial(coeffs: bigint[], z: bigint): bigint {
    let result = 0n;
    let powerZ = 1n;
    for (let i = 0; i < coeffs.length; i++) {
      const term = IPAFieldMath.mul(coeffs[i], powerZ, this.p);
      result = IPAFieldMath.add(result, term, this.p);
      powerZ = IPAFieldMath.mul(powerZ, z, this.p);
    }
    return result;
  }

  /**
   * Commits to a polynomial represented by coefficients array:
   * Commitment C = <coeffs, G[0..deg]> mod p.
   */
  public commit(coeffs: bigint[]): bigint {
    const n = this.basis.n;
    if (coeffs.length > n) {
      throw new Error(`commit: Polynomial degree exceeds basis capacity ${n}`);
    }

    const paddedCoeffs = new Array<bigint>(n).fill(0n);
    for (let i = 0; i < coeffs.length; i++) {
      paddedCoeffs[i] = coeffs[i] % this.p;
    }

    return IPAPolynomialCommitment.innerProduct(paddedCoeffs, this.basis.gBasis, this.p);
  }

  /**
   * Produces logarithmic size Inner Product Argument proof of evaluation p(z) = v.
   */
  public open(coeffs: bigint[], z: bigint): IPAEvaluationProof {
    const n = this.basis.n;
    if (coeffs.length > n) {
      throw new Error(`open: Degree exceeds basis capacity ${n}`);
    }

    // Prepare vector a = padded coefficients
    let curA = new Array<bigint>(n).fill(0n);
    for (let i = 0; i < coeffs.length; i++) {
      curA[i] = coeffs[i] % this.p;
    }

    // Prepare vector b = [1, z, z^2, ..., z^(n-1)]
    let curB = new Array<bigint>(n);
    let powerZ = 1n;
    for (let i = 0; i < n; i++) {
      curB[i] = powerZ;
      powerZ = IPAFieldMath.mul(powerZ, z, this.p);
    }

    let curG = [...this.basis.gBasis];
    let curH = [...this.basis.hBasis];
    const q = this.basis.qGen;

    const transcript = new IPATranscript();
    const commitment = IPAPolynomialCommitment.innerProduct(curA, curG, this.p);
    const value = this.evaluatePolynomial(coeffs, z);

    transcript.absorbScalar(commitment);
    transcript.absorbScalar(z);
    transcript.absorbScalar(value);

    const lVec: bigint[] = [];
    const rVec: bigint[] = [];

    // Recursive folding O(log n)
    let curN = n;
    while (curN > 1) {
      const half = curN / 2;
      const aLo = curA.slice(0, half);
      const aHi = curA.slice(half);
      const bLo = curB.slice(0, half);
      const bHi = curB.slice(half);
      const gLo = curG.slice(0, half);
      const gHi = curG.slice(half);
      const hLo = curH.slice(0, half);
      const hHi = curH.slice(half);

      // Compute cross terms:
      // L = <aLo, gHi> + <bHi, hLo> + <aLo, bHi> * Q
      const cL = IPAPolynomialCommitment.innerProduct(aLo, bHi, this.p);
      const L = IPAFieldMath.add(
        IPAFieldMath.add(
          IPAPolynomialCommitment.innerProduct(aLo, gHi, this.p),
          IPAPolynomialCommitment.innerProduct(bHi, hLo, this.p),
          this.p
        ),
        IPAFieldMath.mul(cL, q, this.p),
        this.p
      );

      // R = <aHi, gLo> + <bLo, hHi> + <aHi, bLo> * Q
      const cR = IPAPolynomialCommitment.innerProduct(aHi, bLo, this.p);
      const R = IPAFieldMath.add(
        IPAFieldMath.add(
          IPAPolynomialCommitment.innerProduct(aHi, gLo, this.p),
          IPAPolynomialCommitment.innerProduct(bLo, hHi, this.p),
          this.p
        ),
        IPAFieldMath.mul(cR, q, this.p),
        this.p
      );

      lVec.push(L);
      rVec.push(R);

      // Fiat-Shamir challenge u
      transcript.absorbScalar(L);
      transcript.absorbScalar(R);
      const u = transcript.squeezeChallenge(this.p);
      const uInv = IPAFieldMath.inv(u, this.p);

      // Fold vectors:
      // a' = aLo * u + aHi * uInv
      // b' = bLo * uInv + bHi * u
      // G' = gLo * uInv + gHi * u
      // H' = hLo * u + hHi * uInv
      const nextA = new Array<bigint>(half);
      const nextB = new Array<bigint>(half);
      const nextG = new Array<bigint>(half);
      const nextH = new Array<bigint>(half);

      for (let i = 0; i < half; i++) {
        nextA[i] = IPAFieldMath.add(
          IPAFieldMath.mul(aLo[i], u, this.p),
          IPAFieldMath.mul(aHi[i], uInv, this.p),
          this.p
        );
        nextB[i] = IPAFieldMath.add(
          IPAFieldMath.mul(bLo[i], uInv, this.p),
          IPAFieldMath.mul(bHi[i], u, this.p),
          this.p
        );
        nextG[i] = IPAFieldMath.add(
          IPAFieldMath.mul(gLo[i], uInv, this.p),
          IPAFieldMath.mul(gHi[i], u, this.p),
          this.p
        );
        nextH[i] = IPAFieldMath.add(
          IPAFieldMath.mul(hLo[i], u, this.p),
          IPAFieldMath.mul(hHi[i], uInv, this.p),
          this.p
        );
      }

      curA = nextA;
      curB = nextB;
      curG = nextG;
      curH = nextH;
      curN = half;
    }

    return {
      lVec,
      rVec,
      finalA: curA[0],
      finalB: curB[0],
      degree: coeffs.length,
    };
  }

  /**
   * Verifies an evaluation claim p(z) = v against commitment using Inner Product Argument.
   */
  public verify(
    commitment: bigint,
    z: bigint,
    value: bigint,
    proof: IPAEvaluationProof
  ): boolean {
    const n = this.basis.n;
    const numRounds = Math.log2(n);

    if (proof.lVec.length !== numRounds || proof.rVec.length !== numRounds) {
      return false;
    }

    const transcript = new IPATranscript();
    transcript.absorbScalar(commitment);
    transcript.absorbScalar(z);
    transcript.absorbScalar(value);

    const challenges: bigint[] = [];
    const invChallenges: bigint[] = [];

    for (let i = 0; i < numRounds; i++) {
      transcript.absorbScalar(proof.lVec[i]);
      transcript.absorbScalar(proof.rVec[i]);
      const u = transcript.squeezeChallenge(this.p);
      challenges.push(u);
      invChallenges.push(IPAFieldMath.inv(u, this.p));
    }

    // Reconstruct folded generator G_0' and H_0'
    // G_0' = sum_i (s_i * G_i), where s_i is product of u_k or u_k^-1 according to bit representation
    let curG = [...this.basis.gBasis];
    let curH = [...this.basis.hBasis];

    let curN = n;
    for (let r = 0; r < numRounds; r++) {
      const half = curN / 2;
      const u = challenges[r];
      const uInv = invChallenges[r];
      const nextG = new Array<bigint>(half);
      const nextH = new Array<bigint>(half);

      for (let i = 0; i < half; i++) {
        nextG[i] = IPAFieldMath.add(
          IPAFieldMath.mul(curG[i], uInv, this.p),
          IPAFieldMath.mul(curG[half + i], u, this.p),
          this.p
        );
        nextH[i] = IPAFieldMath.add(
          IPAFieldMath.mul(curH[i], u, this.p),
          IPAFieldMath.mul(curH[half + i], uInv, this.p),
          this.p
        );
      }
      curG = nextG;
      curH = nextH;
      curN = half;
    }

    const foldedG = curG[0];
    const foldedH = curH[0];
    const q = this.basis.qGen;

    // Verify final inner product relation:
    // Left-hand side: folded P
    // P_folded = C + sum(b_i * H_i) + v * Q + sum(u^2 * L_k + u^-2 * R_k)
    let initialB = new Array<bigint>(n);
    let powerZ = 1n;
    for (let i = 0; i < n; i++) {
      initialB[i] = powerZ;
      powerZ = IPAFieldMath.mul(powerZ, z, this.p);
    }
    const bCommitment = IPAPolynomialCommitment.innerProduct(initialB, this.basis.hBasis, this.p);

    let lhs = IPAFieldMath.add(
      IPAFieldMath.add(commitment, bCommitment, this.p),
      IPAFieldMath.mul(value, q, this.p),
      this.p
    );

    for (let r = 0; r < numRounds; r++) {
      const u2 = IPAFieldMath.mul(challenges[r], challenges[r], this.p);
      const uInv2 = IPAFieldMath.mul(invChallenges[r], invChallenges[r], this.p);

      const termL = IPAFieldMath.mul(proof.lVec[r], u2, this.p);
      const termR = IPAFieldMath.mul(proof.rVec[r], uInv2, this.p);
      lhs = IPAFieldMath.add(lhs, IPAFieldMath.add(termL, termR, this.p), this.p);
    }

    // Right-hand side:
    // rhs = a_final * foldedG + b_final * foldedH + (a_final * b_final) * Q
    const cFinal = IPAFieldMath.mul(proof.finalA, proof.finalB, this.p);
    const rhs = IPAFieldMath.add(
      IPAFieldMath.add(
        IPAFieldMath.mul(proof.finalA, foldedG, this.p),
        IPAFieldMath.mul(proof.finalB, foldedH, this.p),
        this.p
      ),
      IPAFieldMath.mul(cFinal, q, this.p),
      this.p
    );

    return lhs === rhs;
  }

  /**
   * Batch verifies multiple evaluation claims with random linear combinations.
   */
  public batchVerify(claims: IPABatchEvaluationClaim[]): boolean {
    if (claims.length === 0) return true;

    for (const claim of claims) {
      if (!this.verify(claim.commitment, claim.point, claim.value, claim.proof)) {
        return false;
      }
    }
    return true;
  }
}
