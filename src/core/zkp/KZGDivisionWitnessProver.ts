import { createHash } from 'crypto';

/**
 * Succinct KZG Polynomial Multi-Point Division Witness Prover
 *
 * Implements multi-point Kate-Zaverucha-Goldberg (KZG) polynomial openings over
 * a safe-prime subgroup (P = 2Q + 1) using an SRS of powers {g^{tau^i}}.
 * For any set of points S = {(z_1, y_1), ..., (z_k, y_k)}, constructs the
 * Lagrange interpolation polynomial I(X), vanishing polynomial Z_S(X) = prod (X - z_i),
 * and exact quotient witness Q(X) = (f(X) - I(X)) / Z_S(X), verifying both
 * commitment divisibility C_f / C_I == C_Q^{Z_S(tau)} and Fiat-Shamir evaluation.
 */

const SUBGROUP_ORDER = 0x7fffffffffffffffffffffffffffe1d3n; // Prime Q
const SAFE_PRIME = 0xffffffffffffffffffffffffffffc3a7n; // Safe prime P = 2Q + 1
const SUBGROUP_GEN = 4n; // Order-Q generator g

export interface EvaluationClaim {
  readonly point: bigint;
  readonly value: bigint;
}

export interface KZGMultiPointProof {
  readonly polyCommitment: bigint;
  readonly interpolationCommitment: bigint;
  readonly witnessCommitment: bigint;
  readonly claims: readonly EvaluationClaim[];
  readonly quotientCoeffs: readonly bigint[];
  readonly challengeGamma: bigint;
  readonly fAtGamma: bigint;
  readonly iAtGamma: bigint;
  readonly qAtGamma: bigint;
  readonly zAtGamma: bigint;
  readonly transcriptDigest: string;
}

export interface KZGVerificationResult {
  readonly isValid: boolean;
  readonly verifiedPoints: number;
  readonly commitmentEquationValid: boolean;
  readonly challengeEquationValid: boolean;
  readonly reason?: string;
}

function modQ(x: bigint): bigint {
  const r = x % SUBGROUP_ORDER;
  return r >= 0n ? r : r + SUBGROUP_ORDER;
}

function modP(x: bigint): bigint {
  const r = x % SAFE_PRIME;
  return r >= 0n ? r : r + SAFE_PRIME;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) {
      result = (result * b) % mod;
    }
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function modInverseQ(a: bigint): bigint {
  const val = modQ(a);
  if (val === 0n) throw new Error('Cannot invert zero mod Q');
  return modPow(val, SUBGROUP_ORDER - 2n, SUBGROUP_ORDER);
}

function modInverseP(a: bigint): bigint {
  return modPow(a, SAFE_PRIME - 2n, SAFE_PRIME);
}

function hashToScalar(domain: string, parts: readonly string[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const p of parts) {
    h.update('|');
    h.update(p);
  }
  const s = modQ(BigInt('0x' + h.digest('hex')));
  return s === 0n ? 1n : s;
}

function trimPoly(coeffs: readonly bigint[]): bigint[] {
  const out = coeffs.map((c) => modQ(c));
  while (out.length > 1 && out[out.length - 1] === 0n) {
    out.pop();
  }
  return out;
}

function evalPoly(coeffs: readonly bigint[], x: bigint): bigint {
  let acc = 0n;
  const pt = modQ(x);
  for (let i = coeffs.length - 1; i >= 0; i--) {
    acc = modQ(acc * pt + modQ(coeffs[i]));
  }
  return acc;
}

function addPoly(a: readonly bigint[], b: readonly bigint[]): bigint[] {
  const len = Math.max(a.length, b.length);
  const res = new Array<bigint>(len).fill(0n);
  for (let i = 0; i < len; i++) {
    res[i] = modQ((a[i] ?? 0n) + (b[i] ?? 0n));
  }
  return trimPoly(res);
}

function subPoly(a: readonly bigint[], b: readonly bigint[]): bigint[] {
  const len = Math.max(a.length, b.length);
  const res = new Array<bigint>(len).fill(0n);
  for (let i = 0; i < len; i++) {
    res[i] = modQ((a[i] ?? 0n) - (b[i] ?? 0n));
  }
  return trimPoly(res);
}

function mulPoly(a: readonly bigint[], b: readonly bigint[]): bigint[] {
  const res = new Array<bigint>(a.length + b.length - 1).fill(0n);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      res[i + j] = modQ(res[i + j] + modQ(a[i] * b[j]));
    }
  }
  return trimPoly(res);
}

function scalePoly(a: readonly bigint[], scalar: bigint): bigint[] {
  const s = modQ(scalar);
  return trimPoly(a.map((c) => modQ(c * s)));
}

function divPoly(
  dividend: readonly bigint[],
  divisor: readonly bigint[]
): { quotient: bigint[]; remainder: bigint[] } {
  const num = trimPoly(dividend);
  const den = trimPoly(divisor);
  if (den.length === 1 && den[0] === 0n) {
    throw new Error('Division by zero polynomial');
  }
  if (num.length < den.length) {
    return { quotient: [0n], remainder: num };
  }

  const working = [...num];
  const qLen = num.length - den.length + 1;
  const quotient = new Array<bigint>(qLen).fill(0n);
  const invLead = modInverseQ(den[den.length - 1]);

  for (let i = qLen - 1; i >= 0; i--) {
    const lead = working[i + den.length - 1];
    if (lead !== 0n) {
      const factor = modQ(lead * invLead);
      quotient[i] = factor;
      for (let j = 0; j < den.length; j++) {
        working[i + j] = modQ(working[i + j] - modQ(factor * den[j]));
      }
    }
  }

  return {
    quotient: trimPoly(quotient),
    remainder: trimPoly(working.slice(0, den.length - 1).length > 0 ? working.slice(0, den.length - 1) : [0n]),
  };
}

export class KZGDivisionWitnessProver {
  private readonly maxDegree: number;
  private readonly srsPowers: readonly bigint[];
  private readonly trapdoorTau: bigint;

  constructor(maxDegree = 32, ceremonySeed = 'WORKSPHERE_KZG_SRS_V1') {
    if (!Number.isInteger(maxDegree) || maxDegree < 2 || maxDegree > 512) {
      throw new Error('maxDegree must be an integer between 2 and 512');
    }
    this.maxDegree = maxDegree;
    this.trapdoorTau = hashToScalar('KZG_SRS_TAU', [ceremonySeed]);

    const powers: bigint[] = [];
    let tauPow = 1n;
    for (let i = 0; i <= maxDegree; i++) {
      powers.push(modPow(SUBGROUP_GEN, tauPow, SAFE_PRIME));
      tauPow = modQ(tauPow * this.trapdoorTau);
    }
    this.srsPowers = powers;
  }

  public getMaxDegree(): number {
    return this.maxDegree;
  }

  public commitPolynomial(coeffs: readonly bigint[]): bigint {
    const p = trimPoly(coeffs);
    if (p.length - 1 > this.maxDegree) {
      throw new Error(`Polynomial degree ${p.length - 1} exceeds SRS maxDegree ${this.maxDegree}`);
    }
    let acc = 1n;
    for (let i = 0; i < p.length; i++) {
      if (p[i] !== 0n) {
        acc = modP(acc * modPow(this.srsPowers[i], p[i], SAFE_PRIME));
      }
    }
    return acc;
  }

  public buildVanishingPolynomial(points: readonly bigint[]): bigint[] {
    let poly: bigint[] = [1n];
    for (const z of points) {
      poly = mulPoly(poly, [modQ(-z), 1n]);
    }
    return poly;
  }

  public interpolateLagrange(claims: readonly EvaluationClaim[]): bigint[] {
    if (claims.length === 0) {
      throw new Error('At least one evaluation claim is required');
    }
    const seen = new Set<bigint>();
    for (const c of claims) {
      const z = modQ(c.point);
      if (seen.has(z)) {
        throw new Error(`Duplicate evaluation point detected: ${z.toString()}`);
      }
      seen.add(z);
    }

    let result: bigint[] = [0n];
    for (let i = 0; i < claims.length; i++) {
      const xi = modQ(claims[i].point);
      const yi = modQ(claims[i].value);
      let basis: bigint[] = [1n];
      let denom = 1n;
      for (let j = 0; j < claims.length; j++) {
        if (i === j) continue;
        const xj = modQ(claims[j].point);
        basis = mulPoly(basis, [modQ(-xj), 1n]);
        denom = modQ(denom * modQ(xi - xj));
      }
      const weight = modQ(yi * modInverseQ(denom));
      result = addPoly(result, scalePoly(basis, weight));
    }
    return trimPoly(result);
  }

  public proveMultiPoint(
    polyCoeffs: readonly bigint[],
    points: readonly bigint[]
  ): KZGMultiPointProof {
    const f = trimPoly(polyCoeffs);
    if (f.length - 1 > this.maxDegree) {
      throw new Error('Polynomial exceeds configured SRS degree');
    }
    if (points.length === 0 || points.length > this.maxDegree) {
      throw new Error('Invalid evaluation point count');
    }

    const claims: EvaluationClaim[] = points.map((pt) => {
      const z = modQ(pt);
      return { point: z, value: evalPoly(f, z) };
    });

    const interpPoly = this.interpolateLagrange(claims);
    const vanishingPoly = this.buildVanishingPolynomial(claims.map((c) => c.point));
    const diffPoly = subPoly(f, interpPoly);
    const { quotient, remainder } = divPoly(diffPoly, vanishingPoly);

    if (remainder.length !== 1 || remainder[0] !== 0n) {
      throw new Error('Exact polynomial division failed: non-zero remainder');
    }

    const polyCommitment = this.commitPolynomial(f);
    const interpolationCommitment = this.commitPolynomial(interpPoly);
    const witnessCommitment = this.commitPolynomial(quotient);

    const claimParts = claims.flatMap((c) => [c.point.toString(16), c.value.toString(16)]);
    const challengeGamma = hashToScalar('KZG_MP_GAMMA', [
      polyCommitment.toString(16),
      interpolationCommitment.toString(16),
      witnessCommitment.toString(16),
      ...claimParts,
    ]);

    const fAtGamma = evalPoly(f, challengeGamma);
    const iAtGamma = evalPoly(interpPoly, challengeGamma);
    const qAtGamma = evalPoly(quotient, challengeGamma);
    const zAtGamma = evalPoly(vanishingPoly, challengeGamma);

    const transcriptDigest = createHash('sha256')
      .update('KZG_MP_TRANSCRIPT|')
      .update(`${polyCommitment.toString(16)}|${interpolationCommitment.toString(16)}|${witnessCommitment.toString(16)}|`)
      .update(`${challengeGamma.toString(16)}|${fAtGamma.toString(16)}|${iAtGamma.toString(16)}|${qAtGamma.toString(16)}|${zAtGamma.toString(16)}`)
      .digest('hex');

    return {
      polyCommitment,
      interpolationCommitment,
      witnessCommitment,
      claims,
      quotientCoeffs: quotient,
      challengeGamma,
      fAtGamma,
      iAtGamma,
      qAtGamma,
      zAtGamma,
      transcriptDigest,
    };
  }

  public verifyMultiPoint(proof: KZGMultiPointProof): KZGVerificationResult {
    if (proof.claims.length === 0) {
      return {
        isValid: false,
        verifiedPoints: 0,
        commitmentEquationValid: false,
        challengeEquationValid: false,
        reason: 'No evaluation claims provided',
      };
    }

    let interpPoly: bigint[];
    try {
      interpPoly = this.interpolateLagrange(proof.claims);
    } catch (err) {
      return {
        isValid: false,
        verifiedPoints: 0,
        commitmentEquationValid: false,
        challengeEquationValid: false,
        reason: err instanceof Error ? err.message : 'Interpolation failed',
      };
    }

    const vanishingPoly = this.buildVanishingPolynomial(proof.claims.map((c) => c.point));
    const expectedInterpCommit = this.commitPolynomial(interpPoly);
    const expectedWitnessCommit = this.commitPolynomial(proof.quotientCoeffs);

    if (
      expectedInterpCommit !== proof.interpolationCommitment ||
      expectedWitnessCommit !== proof.witnessCommitment
    ) {
      return {
        isValid: false,
        verifiedPoints: 0,
        commitmentEquationValid: false,
        challengeEquationValid: false,
        reason: 'Interpolation or quotient witness commitment mismatch',
      };
    }

    // Verify SRS commitment divisibility: C_f / C_I == C_Q^{Z_S(tau)} mod P
    const zAtTau = evalPoly(vanishingPoly, this.trapdoorTau);
    const lhsCommit = modP(proof.polyCommitment * modInverseP(expectedInterpCommit));
    const rhsCommit = modPow(expectedWitnessCommit, zAtTau, SAFE_PRIME);
    const commitmentEquationValid = lhsCommit === rhsCommit;

    const claimParts = proof.claims.flatMap((c) => [
      modQ(c.point).toString(16),
      modQ(c.value).toString(16),
    ]);
    const expectedGamma = hashToScalar('KZG_MP_GAMMA', [
      proof.polyCommitment.toString(16),
      proof.interpolationCommitment.toString(16),
      proof.witnessCommitment.toString(16),
      ...claimParts,
    ]);

    if (expectedGamma !== proof.challengeGamma) {
      return {
        isValid: false,
        verifiedPoints: 0,
        commitmentEquationValid,
        challengeEquationValid: false,
        reason: 'Fiat-Shamir challenge gamma mismatch',
      };
    }

    const expectedIAtGamma = evalPoly(interpPoly, expectedGamma);
    const expectedQAtGamma = evalPoly(proof.quotientCoeffs, expectedGamma);
    const expectedZAtGamma = evalPoly(vanishingPoly, expectedGamma);
    const rhsGamma = modQ(modQ(expectedQAtGamma * expectedZAtGamma) + expectedIAtGamma);
    const challengeEquationValid =
      expectedIAtGamma === proof.iAtGamma &&
      expectedQAtGamma === proof.qAtGamma &&
      expectedZAtGamma === proof.zAtGamma &&
      modQ(proof.fAtGamma) === rhsGamma;

    const expectedTranscript = createHash('sha256')
      .update('KZG_MP_TRANSCRIPT|')
      .update(`${proof.polyCommitment.toString(16)}|${proof.interpolationCommitment.toString(16)}|${proof.witnessCommitment.toString(16)}|`)
      .update(`${expectedGamma.toString(16)}|${modQ(proof.fAtGamma).toString(16)}|${expectedIAtGamma.toString(16)}|${expectedQAtGamma.toString(16)}|${expectedZAtGamma.toString(16)}`)
      .digest('hex');

    if (expectedTranscript !== proof.transcriptDigest) {
      return {
        isValid: false,
        verifiedPoints: 0,
        commitmentEquationValid,
        challengeEquationValid,
        reason: 'Transcript digest mismatch',
      };
    }

    if (!commitmentEquationValid || !challengeEquationValid) {
      return {
        isValid: false,
        verifiedPoints: 0,
        commitmentEquationValid,
        challengeEquationValid,
        reason: 'KZG polynomial divisibility verification failed',
      };
    }

    return {
      isValid: true,
      verifiedPoints: proof.claims.length,
      commitmentEquationValid,
      challengeEquationValid,
    };
  }
}
