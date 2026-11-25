/**
 * @file VerifiablePolynomialDelegation.ts
 * @description Verifiable Computation Delegation for Dense Polynomials.
 * Enables a resource-constrained client to outsource dense polynomial evaluations
 * y = P(z) to an untrusted cloud worker, receiving succinct opening proofs that
 * verify the evaluation in O(1) client time using KZG polynomial commitment relations
 * over the BN254 scalar field.
 */

import { createHash, randomBytes } from 'crypto';

export const DELEGATION_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field arithmetic helper over BN254.
 */
export class DelegationFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = DELEGATION_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = DELEGATION_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = DELEGATION_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = DELEGATION_PRIME): bigint {
    let res = 1n;
    let b = ((base % p) + p) % p;
    let e = exponent < 0n ? (exponent % (p - 1n)) + (p - 1n) : exponent % (p - 1n);
    while (e > 0n) {
      if (e & 1n) res = (res * b) % p;
      b = (b * b) % p;
      e >>= 1n;
    }
    return res;
  }

  public static inv(a: bigint, p: bigint = DELEGATION_PRIME): bigint {
    if (a % p === 0n) throw new Error('Division by zero in finite field');
    return this.exp(a, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = DELEGATION_PRIME): bigint {
    const hashHex = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + hashHex) % p;
  }
}

/**
 * Structured Reference String (SRS) for KZG polynomial delegation.
 */
export interface DelegationSRS {
  g1Powers: bigint[];
  g2Tau: bigint;
  maxDegree: number;
}

/**
 * Outsourced computation task specification.
 */
export interface DelegationTask {
  taskId: string;
  polynomialCommitment: bigint;
  evaluationPoint: bigint;
  timestamp: number;
}

/**
 * Worker's succinct evaluation proof bundle.
 */
export interface DelegatedEvaluationProof {
  taskId: string;
  evaluationPoint: bigint;
  evaluatedValue: bigint;
  quotientProof: bigint;
  degree: number;
}

/**
 * Verification result for delegated computation.
 */
export interface DelegationVerificationResult {
  isValid: boolean;
  reason?: string;
  evaluationPoint?: bigint;
  evaluatedValue?: bigint;
}

/**
 * Verifiable Polynomial Delegation engine.
 */
export class VerifiablePolynomialDelegation {
  private prime: bigint;
  private srs: DelegationSRS;

  constructor(srs?: DelegationSRS, prime: bigint = DELEGATION_PRIME) {
    this.prime = prime;
    this.srs = srs ?? this.setup(128);
  }

  /**
   * Generates a trusted Structured Reference String up to maxDegree.
   */
  public setup(maxDegree: number, secretTrapdoor?: bigint): DelegationSRS {
    const tau = secretTrapdoor ?? (BigInt('0x' + randomBytes(31).toString('hex')) % (this.prime - 1n) + 1n);
    const g1Powers: bigint[] = new Array(maxDegree + 1);
    let currentPower = 1n;

    for (let i = 0; i <= maxDegree; i++) {
      g1Powers[i] = currentPower;
      currentPower = DelegationFieldMath.mul(currentPower, tau, this.prime);
    }

    this.srs = {
      g1Powers,
      g2Tau: tau,
      maxDegree,
    };

    return this.srs;
  }

  /**
   * Returns current SRS.
   */
  public getSRS(): DelegationSRS {
    return this.srs;
  }

  /**
   * Client commits to a dense polynomial P(X) = \sum c_i X^i.
   */
  public commitPolynomial(coefficients: bigint[]): bigint {
    if (coefficients.length - 1 > this.srs.maxDegree) {
      throw new Error(`Polynomial degree ${coefficients.length - 1} exceeds SRS maxDegree ${this.srs.maxDegree}`);
    }

    let commitment = 0n;
    for (let i = 0; i < coefficients.length; i++) {
      const term = DelegationFieldMath.mul(coefficients[i], this.srs.g1Powers[i], this.prime);
      commitment = DelegationFieldMath.add(commitment, term, this.prime);
    }
    return commitment;
  }

  /**
   * Evaluates a polynomial P(z) directly using Horner's method.
   */
  public evaluatePolynomial(coefficients: bigint[], point: bigint): bigint {
    let result = 0n;
    for (let i = coefficients.length - 1; i >= 0; i--) {
      result = DelegationFieldMath.add(
        DelegationFieldMath.mul(result, point, this.prime),
        coefficients[i],
        this.prime
      );
    }
    return result;
  }

  /**
   * Computes quotient polynomial Q(X) = (P(X) - y) / (X - z) via Ruffini's rule.
   */
  public computeQuotientPolynomial(coefficients: bigint[], point: bigint, evaluatedValue: bigint): bigint[] {
    const degree = coefficients.length - 1;
    if (degree < 1) {
      return [0n];
    }

    const quotient: bigint[] = new Array(degree).fill(0n);
    quotient[degree - 1] = coefficients[degree];

    for (let i = degree - 2; i >= 0; i--) {
      quotient[i] = DelegationFieldMath.add(
        coefficients[i + 1],
        DelegationFieldMath.mul(point, quotient[i + 1], this.prime),
        this.prime
      );
    }

    // Sanity check remainder: c_0 + z * q_0 - y == 0
    const remainder = DelegationFieldMath.sub(
      DelegationFieldMath.add(coefficients[0], DelegationFieldMath.mul(point, quotient[0], this.prime), this.prime),
      evaluatedValue,
      this.prime
    );

    if (remainder !== 0n) {
      throw new Error('Polynomial division remainder non-zero: evaluatedValue does not match P(z)');
    }

    return quotient;
  }

  /**
   * Creates an evaluation task to be outsourced.
   */
  public createTask(taskId: string, polynomialCommitment: bigint, evaluationPoint: bigint): DelegationTask {
    return {
      taskId,
      polynomialCommitment: ((polynomialCommitment % this.prime) + this.prime) % this.prime,
      evaluationPoint: ((evaluationPoint % this.prime) + this.prime) % this.prime,
      timestamp: Date.now(),
    };
  }

  /**
   * Untrusted cloud worker computes y = P(z) and produces opening quotient proof Q(tau).
   */
  public computeAndProve(taskId: string, coefficients: bigint[], evaluationPoint: bigint): DelegatedEvaluationProof {
    const normPoint = ((evaluationPoint % this.prime) + this.prime) % this.prime;
    const y = this.evaluatePolynomial(coefficients, normPoint);
    const quotientCoeffs = this.computeQuotientPolynomial(coefficients, normPoint, y);

    // Compute quotient commitment pi = Q(tau)
    let quotientProof = 0n;
    for (let i = 0; i < quotientCoeffs.length; i++) {
      const term = DelegationFieldMath.mul(quotientCoeffs[i], this.srs.g1Powers[i], this.prime);
      quotientProof = DelegationFieldMath.add(quotientProof, term, this.prime);
    }

    return {
      taskId,
      evaluationPoint: normPoint,
      evaluatedValue: y,
      quotientProof,
      degree: coefficients.length - 1,
    };
  }

  /**
   * Client verifies the worker's evaluation proof in O(1) operations.
   * Checks the pairing identity: (C - y) == pi * (tau - z) (mod p).
   */
  public verifyDelegation(task: DelegationTask, proof: DelegatedEvaluationProof): DelegationVerificationResult {
    if (task.taskId !== proof.taskId) {
      return {
        isValid: false,
        reason: 'Task ID mismatch',
      };
    }

    if (task.evaluationPoint !== proof.evaluationPoint) {
      return {
        isValid: false,
        reason: 'Evaluation point mismatch',
      };
    }

    // Left side: Commitment - y
    const lhs = DelegationFieldMath.sub(task.polynomialCommitment, proof.evaluatedValue, this.prime);

    // Right side: pi * (tau - z)
    const tauMinusZ = DelegationFieldMath.sub(this.srs.g2Tau, proof.evaluationPoint, this.prime);
    const rhs = DelegationFieldMath.mul(proof.quotientProof, tauMinusZ, this.prime);

    if (lhs !== rhs) {
      return {
        isValid: false,
        reason: 'Pairing algebraic check failed: quotient proof invalid or evaluation forged',
        evaluationPoint: proof.evaluationPoint,
        evaluatedValue: proof.evaluatedValue,
      };
    }

    return {
      isValid: true,
      evaluationPoint: proof.evaluationPoint,
      evaluatedValue: proof.evaluatedValue,
    };
  }

  /**
   * Batch verifies multiple independent delegated proofs simultaneously using random linear combination.
   */
  public batchVerify(tasks: DelegationTask[], proofs: DelegatedEvaluationProof[]): DelegationVerificationResult {
    if (tasks.length !== proofs.length || tasks.length === 0) {
      return { isValid: false, reason: 'Task and proof count mismatch or empty list' };
    }

    // Compute random challenge r via Fiat-Shamir
    const transcript = tasks.map((t) => `${t.taskId}:${t.polynomialCommitment.toString(16)}`).join('|');
    const r = DelegationFieldMath.hashToScalar(transcript, this.prime);

    let accLHS = 0n;
    let accRHS = 0n;
    let currentMultiplier = 1n;

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const proof = proofs[i];

      const singleLhs = DelegationFieldMath.sub(task.polynomialCommitment, proof.evaluatedValue, this.prime);
      const tauMinusZ = DelegationFieldMath.sub(this.srs.g2Tau, proof.evaluationPoint, this.prime);
      const singleRhs = DelegationFieldMath.mul(proof.quotientProof, tauMinusZ, this.prime);

      accLHS = DelegationFieldMath.add(accLHS, DelegationFieldMath.mul(currentMultiplier, singleLhs, this.prime), this.prime);
      accRHS = DelegationFieldMath.add(accRHS, DelegationFieldMath.mul(currentMultiplier, singleRhs, this.prime), this.prime);

      currentMultiplier = DelegationFieldMath.mul(currentMultiplier, r, this.prime);
    }

    if (accLHS !== accRHS) {
      return {
        isValid: false,
        reason: 'Batch random linear combination check failed',
      };
    }

    return { isValid: true };
  }
}
