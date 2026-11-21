import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Polynomial Commitment Batch Prover.
 *
 * Implements hiding Pedersen polynomial commitments C_k = g^{a_k} * h^{r_k} mod P
 * for a batch of polynomials P_0(x), ..., P_{m-1}(x) over F_Q, supporting:
 *  - Homomorphic commitment evaluation at any public point z
 *  - Fiat-Shamir random linear combination folding via challenge gamma:
 *      P_comb(x) = sum_{j=0}^{m-1} gamma^j * P_j(x)
 *  - Euclidean quotient proof: P_comb(x) - y_comb = (x - z) * Q(x) with committed Q(x)
 *  - Zero-knowledge Schnorr opening proving the folded evaluation y_comb = sum gamma^j * y_j
 *    AND verifying committed quotient consistency at a second random challenge point beta!
 */

export const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
export const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
export const BASE_G = 4n;

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

function modScalar(v: bigint): bigint {
  return ((v % SUBGROUP_Q) + SUBGROUP_Q) % SUBGROUP_Q;
}

function randomScalar(): bigint {
  const bytes = randomBytes(16);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return (v % (SUBGROUP_Q - 2n)) + 1n;
}

function hashToScalar(...parts: string[]): bigint {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return modScalar(BigInt('0x' + h.digest('hex').slice(0, 32)));
}

function deriveH(): bigint {
  const digest = createHash('sha256').update('ZK-POLY-COMMIT-BATCH-H-V1').digest('hex');
  const raw = (BigInt('0x' + digest.slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
  const qr = (raw * raw) % SAFE_PRIME_P;
  return qr === 1n || qr === BASE_G ? 9n : qr;
}

export const BASE_H = deriveH();

export interface CommittedPolynomial {
  id: string;
  coefficients: bigint[];
  blindings: bigint[];
  commitments: bigint[];
}

export interface BatchPolynomialOpeningProof {
  polyCommitments: bigint[][];
  evalPointZ: bigint;
  claimedEvaluations: bigint[];
  foldingGamma: bigint;
  quotientCommitments: bigint[];
  checkPointBeta: bigint;
  // Schnorr opening of combined evaluation at z and quotient identity at beta
  evalAnnouncementR: bigint;
  evalResponseBlinding: bigint;
  identityAnnouncementR: bigint;
  identityResponseBlinding: bigint;
  fiatShamirChallenge: bigint;
  context: string;
}

export class ZeroKnowledgePolynomialCommitBatch {
  public evalPoly(coeffs: bigint[], x: bigint): bigint {
    let acc = 0n;
    let xPow = 1n;
    for (const c of coeffs) {
      acc = modScalar(acc + modScalar(c) * xPow);
      xPow = modScalar(xPow * x);
    }
    return acc;
  }

  public commitPolynomial(id: string, coefficients: bigint[]): CommittedPolynomial {
    if (coefficients.length === 0) throw new Error('Polynomial must have at least one coefficient');
    const normalized = coefficients.map((c) => modScalar(c));
    const blindings = normalized.map(() => randomScalar());
    const commitments = normalized.map((c, i) =>
      (modPow(BASE_G, c, SAFE_PRIME_P) * modPow(BASE_H, blindings[i], SAFE_PRIME_P)) % SAFE_PRIME_P,
    );
    return { id, coefficients: normalized, blindings, commitments };
  }

  /**
   * Divides P(x) - P(z) by (x - z) using synthetic division in F_Q.
   */
  public divideByLinearFactor(coeffs: bigint[], z: bigint): { quotient: bigint[]; remainder: bigint } {
    const n = coeffs.length;
    if (n === 1) return { quotient: [0n], remainder: modScalar(coeffs[0]) };
    const q = new Array<bigint>(n - 1).fill(0n);
    let carry = modScalar(coeffs[n - 1]);
    for (let i = n - 2; i >= 0; i--) {
      q[i] = carry;
      carry = modScalar(coeffs[i] + carry * z);
    }
    return { quotient: q, remainder: carry };
  }

  public evalCommitmentAt(commitments: bigint[], x: bigint): bigint {
    let acc = 1n;
    let xPow = 1n;
    for (const Ck of commitments) {
      acc = (acc * modPow(Ck, xPow, SAFE_PRIME_P)) % SAFE_PRIME_P;
      xPow = modScalar(xPow * x);
    }
    return acc;
  }

  public proveBatchOpening(
    polynomials: CommittedPolynomial[],
    evalPointZ: bigint,
    context = 'batch-eval-v1',
  ): BatchPolynomialOpeningProof {
    if (polynomials.length === 0) throw new Error('Need at least one committed polynomial');
    const z = modScalar(evalPointZ);
    const polyCommitments = polynomials.map((p) => [...p.commitments]);
    const claimedEvaluations = polynomials.map((p) => this.evalPoly(p.coefficients, z));

    // Derive Fiat-Shamir folding scalar gamma
    const foldingGamma = hashToScalar(
      'POLY-BATCH-GAMMA-V1',
      z.toString(16),
      ...claimedEvaluations.map((y) => y.toString(16)),
      ...polyCommitments.flat().map((c) => c.toString(16)),
      context,
    );

    const maxLen = Math.max(...polynomials.map((p) => p.coefficients.length));
    const combinedCoeffs = new Array<bigint>(maxLen).fill(0n);
    const combinedBlindings = new Array<bigint>(maxLen).fill(0n);

    let gammaPow = 1n;
    let combinedY = 0n;
    for (let j = 0; j < polynomials.length; j++) {
      const p = polynomials[j];
      combinedY = modScalar(combinedY + gammaPow * claimedEvaluations[j]);
      for (let k = 0; k < p.coefficients.length; k++) {
        combinedCoeffs[k] = modScalar(combinedCoeffs[k] + gammaPow * p.coefficients[k]);
        combinedBlindings[k] = modScalar(combinedBlindings[k] + gammaPow * p.blindings[k]);
      }
      gammaPow = modScalar(gammaPow * foldingGamma);
    }

    // Divide P_comb(x) - combinedY by (x - z)
    const shifted = [...combinedCoeffs];
    shifted[0] = modScalar(shifted[0] - combinedY);
    const { quotient, remainder } = this.divideByLinearFactor(shifted, z);
    if (remainder !== 0n) {
      throw new Error('Internal invariant violation: non-zero remainder in exact division');
    }

    const qCommit = this.commitPolynomial('quotient', quotient);

    // Derive random check point beta after committing to quotient
    const checkPointBeta = hashToScalar(
      'POLY-BATCH-BETA-V1',
      foldingGamma.toString(16),
      ...qCommit.commitments.map((c) => c.toString(16)),
      context,
    );

    // Blinding of P_comb(z)
    const evalBlindingAtZ = this.evalPoly(combinedBlindings, z);
    // Blinding of [P_comb(beta) - combinedY - (beta - z) * Q(beta)] (whose value is identically 0!)
    const combBlindAtBeta = this.evalPoly(combinedBlindings, checkPointBeta);
    const qBlindAtBeta = this.evalPoly(qCommit.blindings, checkPointBeta);
    const betaMinusZ = modScalar(checkPointBeta - z);
    const identityZeroBlinding = modScalar(combBlindAtBeta - betaMinusZ * qBlindAtBeta);

    const kEval = randomScalar();
    const kId = randomScalar();
    const evalAnnouncementR = modPow(BASE_H, kEval, SAFE_PRIME_P);
    const identityAnnouncementR = modPow(BASE_H, kId, SAFE_PRIME_P);

    const fiatShamirChallenge = hashToScalar(
      'POLY-BATCH-FINAL-CHALLENGE-V1',
      checkPointBeta.toString(16),
      evalAnnouncementR.toString(16),
      identityAnnouncementR.toString(16),
      context,
    );

    const evalResponseBlinding = modScalar(kEval + fiatShamirChallenge * evalBlindingAtZ);
    const identityResponseBlinding = modScalar(kId + fiatShamirChallenge * identityZeroBlinding);

    return {
      polyCommitments,
      evalPointZ: z,
      claimedEvaluations,
      foldingGamma,
      quotientCommitments: qCommit.commitments,
      checkPointBeta,
      evalAnnouncementR,
      evalResponseBlinding,
      identityAnnouncementR,
      identityResponseBlinding,
      fiatShamirChallenge,
      context,
    };
  }

  public verifyBatchOpening(proof: BatchPolynomialOpeningProof): boolean {
    if (proof.polyCommitments.length === 0 || proof.polyCommitments.length !== proof.claimedEvaluations.length) {
      return false;
    }

    const expectedGamma = hashToScalar(
      'POLY-BATCH-GAMMA-V1',
      proof.evalPointZ.toString(16),
      ...proof.claimedEvaluations.map((y) => y.toString(16)),
      ...proof.polyCommitments.flat().map((c) => c.toString(16)),
      proof.context,
    );
    if (expectedGamma !== proof.foldingGamma) return false;

    const expectedBeta = hashToScalar(
      'POLY-BATCH-BETA-V1',
      proof.foldingGamma.toString(16),
      ...proof.quotientCommitments.map((c) => c.toString(16)),
      proof.context,
    );
    if (expectedBeta !== proof.checkPointBeta) return false;

    const expectedChallenge = hashToScalar(
      'POLY-BATCH-FINAL-CHALLENGE-V1',
      proof.checkPointBeta.toString(16),
      proof.evalAnnouncementR.toString(16),
      proof.identityAnnouncementR.toString(16),
      proof.context,
    );
    if (expectedChallenge !== proof.fiatShamirChallenge) return false;

    // Combine polynomial commitment evaluations at z and at beta
    let gammaPow = 1n;
    let combinedY = 0n;
    let combinedCommAtZ = 1n;
    let combinedCommAtBeta = 1n;

    for (let j = 0; j < proof.polyCommitments.length; j++) {
      combinedY = modScalar(combinedY + gammaPow * modScalar(proof.claimedEvaluations[j]));
      const cAtZ = this.evalCommitmentAt(proof.polyCommitments[j], proof.evalPointZ);
      const cAtBeta = this.evalCommitmentAt(proof.polyCommitments[j], proof.checkPointBeta);
      combinedCommAtZ = (combinedCommAtZ * modPow(cAtZ, gammaPow, SAFE_PRIME_P)) % SAFE_PRIME_P;
      combinedCommAtBeta = (combinedCommAtBeta * modPow(cAtBeta, gammaPow, SAFE_PRIME_P)) % SAFE_PRIME_P;
      gammaPow = modScalar(gammaPow * proof.foldingGamma);
    }

    const gNegY = modPow(BASE_G, modScalar(SUBGROUP_Q - combinedY), SAFE_PRIME_P);

    // Check 1: Evaluation opening at z
    const evalTarget = (combinedCommAtZ * gNegY) % SAFE_PRIME_P;
    const lhs1 = modPow(BASE_H, proof.evalResponseBlinding, SAFE_PRIME_P);
    const rhs1 = (proof.evalAnnouncementR * modPow(evalTarget, proof.fiatShamirChallenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    if (lhs1 !== rhs1) return false;

    // Check 2: Quotient identity at beta: C_comb(beta) * g^{-combinedY} * C_Q(beta)^{-(beta - z)} is a commitment to 0
    const qAtBeta = this.evalCommitmentAt(proof.quotientCommitments, proof.checkPointBeta);
    const negBetaMinusZ = modScalar(SUBGROUP_Q - modScalar(proof.checkPointBeta - proof.evalPointZ));
    const idTarget = (((combinedCommAtBeta * gNegY) % SAFE_PRIME_P) * modPow(qAtBeta, negBetaMinusZ, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const lhs2 = modPow(BASE_H, proof.identityResponseBlinding, SAFE_PRIME_P);
    const rhs2 = (proof.identityAnnouncementR * modPow(idTarget, proof.fiatShamirChallenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return lhs2 === rhs2;
  }

  public serializeProof(proof: BatchPolynomialOpeningProof): string {
    return JSON.stringify({
      polyCount: proof.polyCommitments.length,
      evalPointZ: proof.evalPointZ.toString(),
      claimedEvaluations: proof.claimedEvaluations.map((y) => y.toString()),
      quotientDegree: proof.quotientCommitments.length - 1,
      context: proof.context,
    });
  }
}
