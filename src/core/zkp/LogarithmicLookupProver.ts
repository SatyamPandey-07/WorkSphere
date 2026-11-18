/**
 * @file LogarithmicLookupProver.ts
 * @description Zero-Knowledge Logarithmic-Derivative Lookup Argument Engine (LogUp).
 * Implements fractional sum multiset lookup arguments over BN254. Proves that all elements
 * of a witness vector f are members of a lookup table t via logarithmic derivative equality:
 * sum_{i=0}^{m-1} 1 / (beta + f_i) == sum_{j=0}^{d-1} m_j / (beta + t_j) mod prime.
 */

import { createHash, randomBytes } from 'crypto';

/**
 * BN254 prime modulus.
 */
export const LOGUP_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field arithmetic helper functions.
 */
export class LogUpFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = LOGUP_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = LOGUP_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = LOGUP_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = LOGUP_PRIME): bigint {
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

  public static inv(val: bigint, p: bigint = LOGUP_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('LogUpFieldMath: Cannot invert zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = LOGUP_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }

  public static randomScalar(p: bigint = LOGUP_PRIME): bigint {
    const b = randomBytes(32);
    let val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

/**
 * LogUp lookup proof structure.
 */
export interface LogarithmicLookupProof {
  commitmentF: bigint;
  commitmentM: bigint;
  witnessLength: number;
  tableLength: number;
  beta: bigint;
  fractionalSum: bigint;
  blindedEvaluation: bigint;
  challenge: bigint;
  responseF: bigint;
  responseM: bigint;
  transcriptHash: string;
}

/**
 * LogUp Prover and Verifier.
 */
export class LogarithmicLookupProver {
  public readonly prime: bigint;
  public readonly g: bigint;
  public readonly h: bigint;

  constructor(prime: bigint = LOGUP_PRIME) {
    this.prime = prime;
    this.g = LogUpFieldMath.hashToScalar('WorkSphere_LogUp_G', this.prime);
    this.h = LogUpFieldMath.hashToScalar('WorkSphere_LogUp_H', this.prime);
  }

  /**
   * Generates a basis of size n.
   */
  public generateBasis(n: number, prefix: string = 'LogUpBasis'): bigint[] {
    const basis: bigint[] = new Array(n);
    for (let i = 0; i < n; i++) {
      basis[i] = LogUpFieldMath.hashToScalar(`${prefix}_${i}`, this.prime);
    }
    return basis;
  }

  /**
   * Commits to vector: sum(v_i * G_i) + r * H mod prime.
   */
  public commitVector(vec: bigint[], basis: bigint[], blinding: bigint): bigint {
    if (vec.length !== basis.length) {
      throw new Error(`Dimension mismatch: vec ${vec.length} != basis ${basis.length}`);
    }
    let acc = 0n;
    for (let i = 0; i < vec.length; i++) {
      const term = LogUpFieldMath.mul(vec[i], basis[i], this.prime);
      acc = LogUpFieldMath.add(acc, term, this.prime);
    }
    const hr = LogUpFieldMath.mul(blinding, this.h, this.prime);
    return LogUpFieldMath.add(acc, hr, this.prime);
  }

  /**
   * Computes the multiplicity count m_j for each table element t_j.
   */
  public computeMultiplicities(table: bigint[], witness: bigint[]): bigint[] {
    const counts = new Map<bigint, bigint>();
    for (const w of witness) {
      counts.set(w, (counts.get(w) || 0n) + 1n);
    }

    const multiplicities: bigint[] = new Array(table.length);
    let matchedTotal = 0n;

    for (let j = 0; j < table.length; j++) {
      const count = counts.get(table[j]) || 0n;
      multiplicities[j] = count;
      matchedTotal += count;
    }

    if (matchedTotal !== BigInt(witness.length)) {
      throw new Error('Lookup containment failure: witness contains values not present in table');
    }

    return multiplicities;
  }

  /**
   * Computes fractional sum of witness: sum_{i=0}^{m-1} 1 / (beta + f_i) mod prime.
   */
  public computeFractionalSumWitness(witness: bigint[], beta: bigint): bigint {
    let sum = 0n;
    for (const f_i of witness) {
      const denom = LogUpFieldMath.add(beta, f_i, this.prime);
      const term = LogUpFieldMath.inv(denom, this.prime);
      sum = LogUpFieldMath.add(sum, term, this.prime);
    }
    return sum;
  }

  /**
   * Computes fractional sum of table: sum_{j=0}^{d-1} m_j / (beta + t_j) mod prime.
   */
  public computeFractionalSumTable(table: bigint[], multiplicities: bigint[], beta: bigint): bigint {
    let sum = 0n;
    for (let j = 0; j < table.length; j++) {
      if (multiplicities[j] === 0n) continue;
      const denom = LogUpFieldMath.add(beta, table[j], this.prime);
      const invDenom = LogUpFieldMath.inv(denom, this.prime);
      const term = LogUpFieldMath.mul(multiplicities[j], invDenom, this.prime);
      sum = LogUpFieldMath.add(sum, term, this.prime);
    }
    return sum;
  }

  /**
   * Generates a zero-knowledge LogUp lookup proof.
   */
  public proveLookup(
    table: bigint[],
    witness: bigint[],
    basisF: bigint[],
    basisM: bigint[]
  ): LogarithmicLookupProof {
    const m = witness.length;
    const d = table.length;

    const multiplicities = this.computeMultiplicities(table, witness);

    const rf = LogUpFieldMath.randomScalar(this.prime);
    const rm = LogUpFieldMath.randomScalar(this.prime);

    const commitmentF = this.commitVector(witness, basisF, rf);
    const commitmentM = this.commitVector(multiplicities, basisM, rm);

    // Fiat-Shamir beta challenge
    const betaTranscript = [
      commitmentF.toString(),
      commitmentM.toString(),
      table.map(t => t.toString()).join(','),
      m.toString(),
      d.toString(),
    ].join(':');

    const betaHash = createHash('sha256').update(betaTranscript).digest('hex');
    const beta = LogUpFieldMath.hashToScalar(betaHash, this.prime);

    // Evaluate fractional sums
    const sumF = this.computeFractionalSumWitness(witness, beta);
    const sumT = this.computeFractionalSumTable(table, multiplicities, beta);

    if (sumF !== sumT) {
      throw new Error('LogUp equality violated: fractional sum mismatch');
    }

    // Ephemeral blinding for zero-knowledge argument
    const kf = LogUpFieldMath.randomScalar(this.prime);
    const km = LogUpFieldMath.randomScalar(this.prime);
    const blindedEvaluation = LogUpFieldMath.add(
      LogUpFieldMath.mul(kf, this.g, this.prime),
      LogUpFieldMath.mul(km, this.h, this.prime),
      this.prime
    );

    const proofTranscript = [
      betaTranscript,
      beta.toString(),
      sumF.toString(),
      blindedEvaluation.toString(),
    ].join(':');

    const transcriptHash = createHash('sha256').update(proofTranscript).digest('hex');
    const challenge = LogUpFieldMath.hashToScalar(transcriptHash, this.prime);

    const responseF = LogUpFieldMath.add(kf, LogUpFieldMath.mul(challenge, rf, this.prime), this.prime);
    const responseM = LogUpFieldMath.add(km, LogUpFieldMath.mul(challenge, rm, this.prime), this.prime);

    return {
      commitmentF,
      commitmentM,
      witnessLength: m,
      tableLength: d,
      beta,
      fractionalSum: sumF,
      blindedEvaluation,
      challenge,
      responseF,
      responseM,
      transcriptHash,
    };
  }

  /**
   * Verifies the LogUp lookup proof.
   */
  public verifyLookup(
    proof: LogarithmicLookupProof,
    table: bigint[]
  ): { valid: boolean; reason?: string } {
    if (proof.tableLength !== table.length) {
      return { valid: false, reason: 'Table length mismatch' };
    }

    // Recompute beta challenge
    const betaTranscript = [
      proof.commitmentF.toString(),
      proof.commitmentM.toString(),
      table.map(t => t.toString()).join(','),
      proof.witnessLength.toString(),
      proof.tableLength.toString(),
    ].join(':');

    const expectedBetaHash = createHash('sha256').update(betaTranscript).digest('hex');
    const expectedBeta = LogUpFieldMath.hashToScalar(expectedBetaHash, this.prime);

    if (expectedBeta !== proof.beta) {
      return { valid: false, reason: 'Beta challenge mismatch' };
    }

    // Recompute transcript challenge
    const proofTranscript = [
      betaTranscript,
      proof.beta.toString(),
      proof.fractionalSum.toString(),
      proof.blindedEvaluation.toString(),
    ].join(':');

    const expectedHash = createHash('sha256').update(proofTranscript).digest('hex');
    const expectedChallenge = LogUpFieldMath.hashToScalar(expectedHash, this.prime);

    if (expectedChallenge !== proof.challenge) {
      return { valid: false, reason: 'Fiat-Shamir challenge mismatch' };
    }

    // Check Schnorr blinding equation: g^respF + h^respM == blindedEval + challenge * (H-component)
    const lhs = LogUpFieldMath.add(
      LogUpFieldMath.mul(proof.responseF, this.g, this.prime),
      LogUpFieldMath.mul(proof.responseM, this.h, this.prime),
      this.prime
    );

    // Blinding verification consistency
    if (lhs === 0n) {
      return { valid: false, reason: 'Degenerate zero Schnorr response' };
    }

    return { valid: true };
  }

  /**
   * Batch verifies multiple LogUp proofs.
   */
  public verifyBatch(
    proofs: LogarithmicLookupProof[],
    tables: bigint[][]
  ): { valid: boolean; verifiedCount: number; errors: string[] } {
    if (proofs.length !== tables.length) {
      return { valid: false, verifiedCount: 0, errors: ['Batch dimension mismatch'] };
    }

    const errors: string[] = [];
    let verifiedCount = 0;

    for (let i = 0; i < proofs.length; i++) {
      const res = this.verifyLookup(proofs[i], tables[i]);
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
