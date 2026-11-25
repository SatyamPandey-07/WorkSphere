import { createHash } from 'crypto';

/**
 * Aurora-Style Univariate Sumcheck Polynomial Division Argument
 *
 * Implements the univariate sumcheck protocol (Ben-Sasson et al., Aurora 2019)
 * over the BN254 scalar field Fr. For a multiplicative subgroup H of order m = 2^k
 * with vanishing polynomial Z_H(X) = X^m - 1, proves that:
 *
 *   sum_{h in H} f(h) = S
 *
 * by decomposing f(X) = q(X) * (X^m - 1) + X * g(X) + S / m with deg(g) < m - 1
 * and verifying the algebraic identity at a deterministic Fiat-Shamir challenge z.
 */

const FIELD_MODULUS =
  0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n; // BN254 Fr
const TWO_ADICITY = 28;
const TWO_ADIC_GENERATOR = 5n; // Primitive root for BN254 Fr 2-adic subgroup

export interface UnivariateSumcheckProof {
  readonly domainSize: number;
  readonly claimedSum: bigint;
  readonly fCommitment: string;
  readonly qCommitment: string;
  readonly gCommitment: string;
  readonly challengePoint: bigint;
  readonly fEval: bigint;
  readonly qEval: bigint;
  readonly gEval: bigint;
  readonly gDegree: number;
  readonly quotientCoeffs: readonly bigint[];
  readonly remainderGCoeffs: readonly bigint[];
  readonly transcriptDigest: string;
}

export interface UnivariateSumcheckVerification {
  readonly isValid: boolean;
  readonly challengePoint: bigint;
  readonly lhsValue: bigint;
  readonly rhsValue: bigint;
  readonly reason?: string;
}

function modField(x: bigint): bigint {
  const r = x % FIELD_MODULUS;
  return r >= 0n ? r : r + FIELD_MODULUS;
}

function modPow(base: bigint, exp: bigint): bigint {
  let result = 1n;
  let b = modField(base);
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) {
      result = modField(result * b);
    }
    b = modField(b * b);
    e >>= 1n;
  }
  return result;
}

function modInverse(a: bigint): bigint {
  const val = modField(a);
  if (val === 0n) {
    throw new Error('Cannot invert zero in BN254 Fr');
  }
  return modPow(val, FIELD_MODULUS - 2n);
}

function evaluatePoly(coeffs: readonly bigint[], x: bigint): bigint {
  let acc = 0n;
  const pt = modField(x);
  for (let i = coeffs.length - 1; i >= 0; i--) {
    acc = modField(acc * pt + modField(coeffs[i]));
  }
  return acc;
}

function trimPoly(coeffs: readonly bigint[]): bigint[] {
  const out = coeffs.map((c) => modField(c));
  while (out.length > 1 && out[out.length - 1] === 0n) {
    out.pop();
  }
  return out;
}

function commitPoly(domain: string, coeffs: readonly bigint[]): string {
  const h = createHash('sha256');
  h.update(domain);
  h.update(`|deg=${coeffs.length - 1}`);
  for (const c of coeffs) {
    h.update('|');
    h.update(modField(c).toString(16));
  }
  return h.digest('hex');
}

function deriveChallenge(domain: string, parts: readonly string[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const part of parts) {
    h.update('|');
    h.update(part);
  }
  const scalar = modField(BigInt('0x' + h.digest('hex')));
  return scalar === 0n ? 1n : scalar;
}

export class UnivariateSumcheckProver {
  private readonly domainSize: number;
  private readonly omega: bigint;
  private readonly domainElements: readonly bigint[];

  constructor(domainSize: number) {
    if (!Number.isInteger(domainSize) || domainSize < 2 || (domainSize & (domainSize - 1)) !== 0) {
      throw new Error('domainSize must be a power of 2 >= 2');
    }
    const log2 = Math.round(Math.log2(domainSize));
    if (log2 > TWO_ADICITY) {
      throw new Error(`domainSize exceeds BN254 2-adicity bound (2^${TWO_ADICITY})`);
    }
    this.domainSize = domainSize;
    const cofactor = (FIELD_MODULUS - 1n) >> BigInt(log2);
    this.omega = modPow(TWO_ADIC_GENERATOR, cofactor);

    if (modPow(this.omega, BigInt(domainSize)) !== 1n || modPow(this.omega, BigInt(domainSize / 2)) === 1n) {
      throw new Error('Failed to construct primitive root of unity for domain');
    }

    const elems: bigint[] = [];
    let cur = 1n;
    for (let i = 0; i < domainSize; i++) {
      elems.push(cur);
      cur = modField(cur * this.omega);
    }
    this.domainElements = elems;
  }

  public getDomainSize(): number {
    return this.domainSize;
  }

  public getDomainElements(): readonly bigint[] {
    return this.domainElements;
  }

  public computeDomainSum(polyCoeffs: readonly bigint[]): bigint {
    let sum = 0n;
    for (const h of this.domainElements) {
      sum = modField(sum + evaluatePoly(polyCoeffs, h));
    }
    return sum;
  }

  /**
   * Divides f(X) by Z_H(X) = X^m - 1 in O(deg(f)) time:
   * f(X) = q(X) * (X^m - 1) + r(X) with deg(r) < m.
   */
  public divideByVanishing(polyCoeffs: readonly bigint[]): {
    quotient: bigint[];
    remainder: bigint[];
  } {
    const f = trimPoly(polyCoeffs);
    const m = this.domainSize;
    if (f.length <= m) {
      return { quotient: [0n], remainder: f };
    }

    const working = [...f];
    const quotient = new Array<bigint>(f.length - m).fill(0n);
    for (let i = f.length - 1; i >= m; i--) {
      const coeff = working[i];
      if (coeff !== 0n) {
        quotient[i - m] = coeff;
        working[i] = 0n;
        working[i - m] = modField(working[i - m] + coeff);
      }
    }
    const remainder = trimPoly(working.slice(0, m));
    return { quotient: trimPoly(quotient), remainder };
  }

  public prove(polyCoeffs: readonly bigint[]): UnivariateSumcheckProof {
    const f = trimPoly(polyCoeffs);
    const claimedSum = this.computeDomainSum(f);
    const { quotient, remainder } = this.divideByVanishing(f);

    const expectedConst = modField(claimedSum * modInverse(BigInt(this.domainSize)));
    if (remainder[0] !== expectedConst) {
      throw new Error('Algebraic invariant violation: r(0) != S / |H|');
    }

    // r(X) - r(0) = X * g(X) where deg(g) <= m - 2
    const remainderGCoeffs = remainder.length > 1 ? trimPoly(remainder.slice(1)) : [0n];

    const fCommitment = commitPoly('UNIV_SC_F', f);
    const qCommitment = commitPoly('UNIV_SC_Q', quotient);
    const gCommitment = commitPoly('UNIV_SC_G', remainderGCoeffs);

    const challengePoint = deriveChallenge('UNIV_SC_Z', [
      String(this.domainSize),
      claimedSum.toString(16),
      fCommitment,
      qCommitment,
      gCommitment,
    ]);

    const fEval = evaluatePoly(f, challengePoint);
    const qEval = evaluatePoly(quotient, challengePoint);
    const gEval = evaluatePoly(remainderGCoeffs, challengePoint);

    const transcriptDigest = createHash('sha256')
      .update('UNIV_SC_TRANSCRIPT|')
      .update(`${this.domainSize}|${claimedSum.toString(16)}|`)
      .update(`${fCommitment}|${qCommitment}|${gCommitment}|`)
      .update(`${challengePoint.toString(16)}|${fEval.toString(16)}|${qEval.toString(16)}|${gEval.toString(16)}`)
      .digest('hex');

    return {
      domainSize: this.domainSize,
      claimedSum,
      fCommitment,
      qCommitment,
      gCommitment,
      challengePoint,
      fEval,
      qEval,
      gEval,
      gDegree: remainderGCoeffs.length - 1,
      quotientCoeffs: quotient,
      remainderGCoeffs,
      transcriptDigest,
    };
  }

  public verify(
    polyCoeffs: readonly bigint[],
    proof: UnivariateSumcheckProof
  ): UnivariateSumcheckVerification {
    if (proof.domainSize !== this.domainSize) {
      return {
        isValid: false,
        challengePoint: 0n,
        lhsValue: 0n,
        rhsValue: 0n,
        reason: 'Domain size mismatch',
      };
    }

    if (proof.remainderGCoeffs.length - 1 >= this.domainSize - 1 || proof.gDegree >= this.domainSize - 1) {
      return {
        isValid: false,
        challengePoint: proof.challengePoint,
        lhsValue: 0n,
        rhsValue: 0n,
        reason: `Low-degree bound violated: deg(g) must be < ${this.domainSize - 1}`,
      };
    }

    const f = trimPoly(polyCoeffs);
    const expectedFCommit = commitPoly('UNIV_SC_F', f);
    const expectedQCommit = commitPoly('UNIV_SC_Q', proof.quotientCoeffs);
    const expectedGCommit = commitPoly('UNIV_SC_G', proof.remainderGCoeffs);

    if (
      expectedFCommit !== proof.fCommitment ||
      expectedQCommit !== proof.qCommitment ||
      expectedGCommit !== proof.gCommitment
    ) {
      return {
        isValid: false,
        challengePoint: proof.challengePoint,
        lhsValue: 0n,
        rhsValue: 0n,
        reason: 'Polynomial commitment mismatch',
      };
    }

    const expectedZ = deriveChallenge('UNIV_SC_Z', [
      String(this.domainSize),
      modField(proof.claimedSum).toString(16),
      proof.fCommitment,
      proof.qCommitment,
      proof.gCommitment,
    ]);
    if (expectedZ !== proof.challengePoint) {
      return {
        isValid: false,
        challengePoint: expectedZ,
        lhsValue: 0n,
        rhsValue: 0n,
        reason: 'Fiat-Shamir challenge derivation mismatch',
      };
    }

    const fEval = evaluatePoly(f, expectedZ);
    const qEval = evaluatePoly(proof.quotientCoeffs, expectedZ);
    const gEval = evaluatePoly(proof.remainderGCoeffs, expectedZ);
    if (fEval !== proof.fEval || qEval !== proof.qEval || gEval !== proof.gEval) {
      return {
        isValid: false,
        challengePoint: expectedZ,
        lhsValue: fEval,
        rhsValue: 0n,
        reason: 'Opening evaluation mismatch at challenge point',
      };
    }

    const expectedTranscript = createHash('sha256')
      .update('UNIV_SC_TRANSCRIPT|')
      .update(`${this.domainSize}|${modField(proof.claimedSum).toString(16)}|`)
      .update(`${proof.fCommitment}|${proof.qCommitment}|${proof.gCommitment}|`)
      .update(`${expectedZ.toString(16)}|${fEval.toString(16)}|${qEval.toString(16)}|${gEval.toString(16)}`)
      .digest('hex');
    if (expectedTranscript !== proof.transcriptDigest) {
      return {
        isValid: false,
        challengePoint: expectedZ,
        lhsValue: fEval,
        rhsValue: 0n,
        reason: 'Transcript digest mismatch',
      };
    }

    // Verify f(z) == q(z) * (z^m - 1) + z * g(z) + S / m
    const vanishingAtZ = modField(modPow(expectedZ, BigInt(this.domainSize)) - 1n);
    const sOverM = modField(modField(proof.claimedSum) * modInverse(BigInt(this.domainSize)));
    const rhsValue = modField(
      modField(qEval * vanishingAtZ) + modField(expectedZ * gEval) + sOverM
    );

    if (fEval !== rhsValue) {
      return {
        isValid: false,
        challengePoint: expectedZ,
        lhsValue: fEval,
        rhsValue,
        reason: 'Univariate sumcheck algebraic identity failed',
      };
    }

    return {
      isValid: true,
      challengePoint: expectedZ,
      lhsValue: fEval,
      rhsValue,
    };
  }
}
