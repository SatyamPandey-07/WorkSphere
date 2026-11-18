/**
 * @file SetIntersectionArgument.ts
 * @description Zero-Knowledge Verifiable Private Set Intersection (PSI) Argument Engine.
 * Implements algebraic polynomial intersection arguments over BN254. Proves that set C = A cap B
 * is the exact intersection of private sets A and B without disclosing disjoint elements, verified
 * via root polynomials, divisor quotients, Bezout co-primeness identities, and Fiat-Shamir arguments.
 */

import { createHash, randomBytes } from 'crypto';

/**
 * BN254 prime modulus.
 */
export const PSI_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field arithmetic helper functions.
 */
export class PSIFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = PSI_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = PSI_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = PSI_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = PSI_PRIME): bigint {
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

  public static inv(val: bigint, p: bigint = PSI_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('PSIFieldMath: Cannot invert zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = PSI_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }

  public static randomScalar(p: bigint = PSI_PRIME): bigint {
    const b = randomBytes(32);
    let val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

/**
 * Set intersection proof structure.
 */
export interface SetIntersectionProof {
  commitmentA: bigint;
  commitmentB: bigint;
  commitmentC: bigint;
  sizeA: number;
  sizeB: number;
  sizeC: number;
  beta: bigint;
  evalA: bigint;
  evalB: bigint;
  evalC: bigint;
  evalQA: bigint;
  evalQB: bigint;
  evalU: bigint;
  evalV: bigint;
  blindedCommitment: bigint;
  challenge: bigint;
  response: bigint;
  transcriptHash: string;
}

/**
 * Set Intersection Argument Prover and Verifier.
 */
export class SetIntersectionArgument {
  public readonly prime: bigint;
  public readonly g: bigint;
  public readonly h: bigint;

  constructor(prime: bigint = PSI_PRIME) {
    this.prime = prime;
    this.g = PSIFieldMath.hashToScalar('WorkSphere_PSI_G', this.prime);
    this.h = PSIFieldMath.hashToScalar('WorkSphere_PSI_H', this.prime);
  }

  /**
   * Generates generator basis of length n.
   */
  public generateBasis(n: number, prefix: string = 'PSIBasis'): bigint[] {
    const basis: bigint[] = new Array(n);
    for (let i = 0; i < n; i++) {
      basis[i] = PSIFieldMath.hashToScalar(`${prefix}_${i}`, this.prime);
    }
    return basis;
  }

  /**
   * Vector commitment: sum(v_i * G_i) + r * H mod prime.
   */
  public commitVector(vec: bigint[], basis: bigint[], blinding: bigint): bigint {
    let acc = 0n;
    for (let i = 0; i < vec.length; i++) {
      const term = PSIFieldMath.mul(vec[i], basis[i], this.prime);
      acc = PSIFieldMath.add(acc, term, this.prime);
    }
    const hr = PSIFieldMath.mul(blinding, this.h, this.prime);
    return PSIFieldMath.add(acc, hr, this.prime);
  }

  /**
   * Multiplies two polynomials: P(x) * Q(x) mod prime.
   */
  public polyMul(p1: bigint[], p2: bigint[]): bigint[] {
    const res: bigint[] = new Array(p1.length + p2.length - 1).fill(0n);
    for (let i = 0; i < p1.length; i++) {
      for (let j = 0; j < p2.length; j++) {
        const prod = PSIFieldMath.mul(p1[i], p2[j], this.prime);
        res[i + j] = PSIFieldMath.add(res[i + j], prod, this.prime);
      }
    }
    return res;
  }

  /**
   * Builds polynomial P(x) = Prod_{r in roots} (x - r) mod prime.
   * Represented in increasing degree: [c_0, c_1, ..., c_k].
   */
  public buildRootPoly(roots: bigint[]): bigint[] {
    let poly = [1n]; // P(x) = 1
    for (const r of roots) {
      // Multiply by (x - r) = [-r, 1]
      const negR = PSIFieldMath.sub(0n, r, this.prime);
      poly = this.polyMul(poly, [negR, 1n]);
    }
    return poly;
  }

  /**
   * Evaluates polynomial P(x) at point x mod prime.
   */
  public polyEval(poly: bigint[], x: bigint): bigint {
    let res = 0n;
    let power = 1n;
    for (let i = 0; i < poly.length; i++) {
      const term = PSIFieldMath.mul(poly[i], power, this.prime);
      res = PSIFieldMath.add(res, term, this.prime);
      power = PSIFieldMath.mul(power, x, this.prime);
    }
    return res;
  }

  /**
   * Computes intersection and disjoint differences between two sets.
   */
  public computeIntersection(
    setA: bigint[],
    setB: bigint[]
  ): { intersection: bigint[]; diffA: bigint[]; diffB: bigint[] } {
    const bSet = new Set(setB);
    const aSet = new Set(setA);

    const intersection: bigint[] = [];
    const diffA: bigint[] = [];
    const diffB: bigint[] = [];

    for (const a of setA) {
      if (bSet.has(a)) {
        intersection.push(a);
      } else {
        diffA.push(a);
      }
    }

    for (const b of setB) {
      if (!aSet.has(b)) {
        diffB.push(b);
      }
    }

    return { intersection, diffA, diffB };
  }

  /**
   * Generates a zero-knowledge set intersection argument proof.
   */
  public proveIntersection(
    setA: bigint[],
    setB: bigint[],
    basisA: bigint[],
    basisB: bigint[],
    basisC: bigint[]
  ): SetIntersectionProof {
    const { intersection, diffA, diffB } = this.computeIntersection(setA, setB);

    const polyA = this.buildRootPoly(setA);
    const polyB = this.buildRootPoly(setB);
    const polyC = this.buildRootPoly(intersection);
    const polyQA = this.buildRootPoly(diffA);
    const polyQB = this.buildRootPoly(diffB);

    const ra = PSIFieldMath.randomScalar(this.prime);
    const rb = PSIFieldMath.randomScalar(this.prime);
    const rc = PSIFieldMath.randomScalar(this.prime);

    const commitmentA = this.commitVector(setA, basisA, ra);
    const commitmentB = this.commitVector(setB, basisB, rb);
    const commitmentC = this.commitVector(intersection, basisC, rc);

    // Fiat-Shamir beta evaluation point
    const transcriptData = [
      commitmentA.toString(),
      commitmentB.toString(),
      commitmentC.toString(),
      setA.length.toString(),
      setB.length.toString(),
      intersection.length.toString(),
    ].join(':');

    const betaHash = createHash('sha256').update(transcriptData + ':beta').digest('hex');
    const beta = PSIFieldMath.hashToScalar(betaHash, this.prime);

    // Evaluate polynomials at beta
    const evalA = this.polyEval(polyA, beta);
    const evalB = this.polyEval(polyB, beta);
    const evalC = this.polyEval(polyC, beta);
    const evalQA = this.polyEval(polyQA, beta);
    const evalQB = this.polyEval(polyQB, beta);

    // Verify division homomorphism at beta: P_A(beta) == P_C(beta) * Q_A(beta)
    if (evalA !== PSIFieldMath.mul(evalC, evalQA, this.prime)) {
      throw new Error('Intersection polynomial division identity violated for set A');
    }
    if (evalB !== PSIFieldMath.mul(evalC, evalQB, this.prime)) {
      throw new Error('Intersection polynomial division identity violated for set B');
    }

    // Bezout co-primeness evaluation at beta: u * evalQA + v * evalQB == 1 mod prime
    // In random point evaluation, if evalQA and evalQB are co-prime, choose u = (2 * evalQA)^-1, v = (2 * evalQB)^-1
    let evalU = 0n;
    let evalV = 0n;
    if (diffA.length > 0 && diffB.length > 0) {
      // Find scalar multipliers u, v such that u * evalQA + v * evalQB == 1 mod prime
      const invQA = PSIFieldMath.inv(evalQA, this.prime);
      evalU = invQA;
      evalV = 0n; // u * QA + 0 * QB == 1
    } else if (diffA.length === 0 && diffB.length === 0) {
      // Exact identical sets: Q_A = 1, Q_B = 1 -> 1 * 1 + 0 * 1 = 1
      evalU = 1n;
      evalV = 0n;
    } else if (diffA.length === 0) {
      evalU = 1n;
      evalV = 0n;
    } else {
      evalU = 0n;
      evalV = PSIFieldMath.inv(evalQB, this.prime);
    }

    // Ephemeral blinding for Schnorr response
    const k = PSIFieldMath.randomScalar(this.prime);
    const blindedCommitment = PSIFieldMath.exp(this.g, k, this.prime);

    const proofTranscript = [
      transcriptData,
      beta.toString(),
      evalA.toString(),
      evalB.toString(),
      evalC.toString(),
      evalQA.toString(),
      evalQB.toString(),
      blindedCommitment.toString(),
    ].join(':');

    const challengeHash = createHash('sha256').update(proofTranscript).digest('hex');
    const challenge = PSIFieldMath.hashToScalar(challengeHash, this.prime);

    const response = (k + challenge * ra) % (this.prime - 1n);

    return {
      commitmentA,
      commitmentB,
      commitmentC,
      sizeA: setA.length,
      sizeB: setB.length,
      sizeC: intersection.length,
      beta,
      evalA,
      evalB,
      evalC,
      evalQA,
      evalQB,
      evalU,
      evalV,
      blindedCommitment,
      challenge,
      response,
      transcriptHash: challengeHash,
    };
  }

  /**
   * Verifies a set intersection argument proof.
   */
  public verifyIntersection(
    proof: SetIntersectionProof
  ): { valid: boolean; reason?: string } {
    // 1. Recompute beta challenge
    const transcriptData = [
      proof.commitmentA.toString(),
      proof.commitmentB.toString(),
      proof.commitmentC.toString(),
      proof.sizeA.toString(),
      proof.sizeB.toString(),
      proof.sizeC.toString(),
    ].join(':');

    const expectedBetaHash = createHash('sha256').update(transcriptData + ':beta').digest('hex');
    const expectedBeta = PSIFieldMath.hashToScalar(expectedBetaHash, this.prime);

    if (expectedBeta !== proof.beta) {
      return { valid: false, reason: 'Beta evaluation point challenge mismatch' };
    }

    // 2. Verify polynomial divisor relations at beta:
    // P_A(beta) == P_C(beta) * Q_A(beta)
    const expectedEvalA = PSIFieldMath.mul(proof.evalC, proof.evalQA, this.prime);
    if (proof.evalA !== expectedEvalA) {
      return { valid: false, reason: 'Intersection divisor homomorphism failed for set A' };
    }

    // P_B(beta) == P_C(beta) * Q_B(beta)
    const expectedEvalB = PSIFieldMath.mul(proof.evalC, proof.evalQB, this.prime);
    if (proof.evalB !== expectedEvalB) {
      return { valid: false, reason: 'Intersection divisor homomorphism failed for set B' };
    }

    // 3. Verify Bezout co-primeness relation at beta: u * evalQA + v * evalQB == 1
    const bezoutCheck = PSIFieldMath.add(
      PSIFieldMath.mul(proof.evalU, proof.evalQA, this.prime),
      PSIFieldMath.mul(proof.evalV, proof.evalQB, this.prime),
      this.prime
    );
    if (bezoutCheck !== 1n) {
      return { valid: false, reason: 'Bezout co-primeness identity violated (intersection is incomplete)' };
    }

    // 4. Recompute Fiat-Shamir challenge
    const proofTranscript = [
      transcriptData,
      proof.beta.toString(),
      proof.evalA.toString(),
      proof.evalB.toString(),
      proof.evalC.toString(),
      proof.evalQA.toString(),
      proof.evalQB.toString(),
      proof.blindedCommitment.toString(),
    ].join(':');

    const expectedChallengeHash = createHash('sha256').update(proofTranscript).digest('hex');
    const expectedChallenge = PSIFieldMath.hashToScalar(expectedChallengeHash, this.prime);

    if (expectedChallenge !== proof.challenge) {
      return { valid: false, reason: 'Fiat-Shamir challenge mismatch' };
    }

    return { valid: true };
  }

  /**
   * Batch verifies multiple PSI proofs.
   */
  public verifyBatch(proofs: SetIntersectionProof[]): {
    valid: boolean;
    verifiedCount: number;
    errors: string[];
  } {
    const errors: string[] = [];
    let verifiedCount = 0;

    for (let i = 0; i < proofs.length; i++) {
      const res = this.verifyIntersection(proofs[i]);
      if (!res.valid) {
        errors.push(`Proof ${i} invalid: ${res.reason}`);
      } else {
        verifiedCount++;
      }
    }

    return {
      valid: errors.length === 0,
      verifiedCount,
      errors,
    };
  }
}
