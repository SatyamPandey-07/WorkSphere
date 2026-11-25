import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Polynomial Exact Divisibility Batch Prover.
 *
 * Proves in zero knowledge that a secretly committed polynomial P(x) is EXACTLY divisible
 * by another secretly committed (or public) divisor polynomial D(x) over F_Q:
 *   P(x) == Q(x) * D(x)   (zero remainder!)
 * where P, D, and quotient Q are all hidden inside Pedersen coefficient commitments!
 *
 * Protocol (Fiat-Shamir Schwartz-Zippel Polynomial Identity Check):
 *  1. Prover performs exact polynomial Euclidean division in F_Q to obtain Q(x) with R(x) == 0,
 *     and commits to Q(x) via Pedersen commitments C_Q[0..deg(Q)].
 *  2. Derives random Fiat-Shamir evaluation challenge z = H(C_P, C_D, C_Q, context).
 *  3. Verifier homomorphically evaluates commitments at z:
 *       C_P(z) = prod C_P[k]^{z^k},  C_D(z) = prod C_D[k]^{z^k},  C_Q(z) = prod C_Q[k]^{z^k}
 *  4. Prover executes a zero-knowledge Pedersen multiplication gate Sigma proof certifying
 *     that the hidden evaluation at z satisfies P(z) == Q(z) * D(z) mod Q without revealing
 *     P(z), Q(z), D(z), or ANY polynomial coefficients!
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

function modInv(a: bigint, m: bigint): bigint {
  let t = 0n;
  let newT = 1n;
  let r = m;
  let newR = ((a % m) + m) % m;
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  if (r > 1n) throw new Error('Not invertible');
  return t < 0n ? t + m : t;
}

function randomScalar(): bigint {
  const bytes = randomBytes(16);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return (v % (SUBGROUP_Q - 2n)) + 1n;
}

function sha256Hex(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return h.digest('hex');
}

function hashToScalar(...parts: string[]): bigint {
  const v = modScalar(BigInt('0x' + sha256Hex(...parts).slice(0, 32)));
  return v === 0n ? 1n : v;
}

function deriveH(): bigint {
  const raw = (BigInt('0x' + sha256Hex('ZK-POLY-DIV-BATCH-H-V1').slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
  const qr = (raw * raw) % SAFE_PRIME_P;
  return qr === 1n || qr === BASE_G ? 9n : qr;
}

export const BASE_H = deriveH();

export interface PedersenPolyCommitment {
  label: string;
  coefficients: bigint[];
  blindings: bigint[];
  commitments: bigint[];
}

export interface PolyDivisibilityProof {
  dividendCommitments: bigint[];
  divisorCommitments: bigint[];
  quotientCommitments: bigint[];
  evalChallengeZ: bigint;
  // Multiplication Sigma proof at z: C_P(z) = C_Q(z)^{d_z} * h^{rP(z) - d_z * rQ(z)}
  announceD: bigint;
  announceProd: bigint;
  sigmaChallenge: bigint;
  respDz: bigint;
  respRd: bigint;
  respRDelta: bigint;
  context: string;
}

export class ZeroKnowledgePolynomialDivisibilityBatch {
  public trimPoly(coeffs: bigint[]): bigint[] {
    const out = coeffs.map((c) => modScalar(c));
    while (out.length > 1 && out[out.length - 1] === 0n) out.pop();
    return out;
  }

  public evalPoly(coeffs: bigint[], x: bigint): bigint {
    const xn = modScalar(x);
    let acc = 0n;
    let xp = 1n;
    for (const c of coeffs) {
      acc = modScalar(acc + modScalar(c) * xp);
      xp = modScalar(xp * xn);
    }
    return acc;
  }

  public multiplyPolys(a: bigint[], b: bigint[]): bigint[] {
    const out = new Array<bigint>(a.length + b.length - 1).fill(0n);
    for (let i = 0; i < a.length; i++) {
      for (let j = 0; j < b.length; j++) {
        out[i + j] = modScalar(out[i + j] + modScalar(a[i]) * modScalar(b[j]));
      }
    }
    return this.trimPoly(out);
  }

  /**
   * Exact Euclidean polynomial division in F_Q: dividend = quotient * divisor + remainder.
   */
  public dividePolys(dividendIn: bigint[], divisorIn: bigint[]): { quotient: bigint[]; remainder: bigint[] } {
    const rem = this.trimPoly(dividendIn);
    const div = this.trimPoly(divisorIn);
    if (div.length === 1 && div[0] === 0n) throw new Error('Division by zero polynomial');

    const degDiv = div.length - 1;
    if (rem.length - 1 < degDiv) {
      return { quotient: [0n], remainder: rem };
    }

    const invLead = modInv(div[degDiv], SUBGROUP_Q);
    const q = new Array<bigint>(rem.length - degDiv).fill(0n);

    for (let i = rem.length - 1; i >= degDiv; i--) {
      if (rem[i] === 0n) continue;
      const factor = modScalar(rem[i] * invLead);
      q[i - degDiv] = factor;
      for (let j = 0; j <= degDiv; j++) {
        rem[i - degDiv + j] = modScalar(rem[i - degDiv + j] - factor * div[j]);
      }
    }

    return { quotient: this.trimPoly(q), remainder: this.trimPoly(rem) };
  }

  public commitPolynomial(label: string, coeffs: bigint[]): PedersenPolyCommitment {
    if (coeffs.length === 0) throw new Error('Polynomial coefficients cannot be empty');
    const normalized = coeffs.map((c) => modScalar(c));
    const blindings = normalized.map(() => randomScalar());
    const commitments = normalized.map((c, i) =>
      (modPow(BASE_G, c, SAFE_PRIME_P) * modPow(BASE_H, blindings[i], SAFE_PRIME_P)) % SAFE_PRIME_P,
    );
    return { label, coefficients: normalized, blindings, commitments };
  }

  public evalCommitment(commitments: bigint[], z: bigint): bigint {
    const zn = modScalar(z);
    let acc = 1n;
    let zp = 1n;
    for (const ck of commitments) {
      acc = (acc * modPow(ck, zp, SAFE_PRIME_P)) % SAFE_PRIME_P;
      zp = modScalar(zp * zn);
    }
    return acc;
  }

  public proveDivisibility(
    dividend: PedersenPolyCommitment,
    divisor: PedersenPolyCommitment,
    context = 'poly-div-v1',
  ): PolyDivisibilityProof {
    const { quotient, remainder } = this.dividePolys(dividend.coefficients, divisor.coefficients);
    if (remainder.length > 1 || remainder[0] !== 0n) {
      throw new Error('Polynomial is not cleanly divisible by divisor (non-zero remainder)');
    }

    const qComm = this.commitPolynomial('quotient', quotient);
    const evalChallengeZ = hashToScalar(
      'POLY-DIV-Z-V1',
      context,
      ...dividend.commitments.map((c) => c.toString(16)),
      ...divisor.commitments.map((c) => c.toString(16)),
      ...qComm.commitments.map((c) => c.toString(16)),
    );

    const dAtZ = this.evalPoly(divisor.coefficients, evalChallengeZ);
    const rPAtZ = this.evalPoly(dividend.blindings, evalChallengeZ);
    const rDAtZ = this.evalPoly(divisor.blindings, evalChallengeZ);
    const rQAtZ = this.evalPoly(qComm.blindings, evalChallengeZ);

    // Since P(z) == Q(z) * D(z):  C_P(z) = C_Q(z)^{D(z)} * h^{rP(z) - D(z)*rQ(z)}
    const rDelta = modScalar(rPAtZ - dAtZ * rQAtZ);
    const cQAtZ = this.evalCommitment(qComm.commitments, evalChallengeZ);
    const cDAtZ = this.evalCommitment(divisor.commitments, evalChallengeZ);
    const cPAtZ = this.evalCommitment(dividend.commitments, evalChallengeZ);

    const kd = randomScalar();
    const krd = randomScalar();
    const krDelta = randomScalar();
    const announceD = (modPow(BASE_G, kd, SAFE_PRIME_P) * modPow(BASE_H, krd, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const announceProd = (modPow(cQAtZ, kd, SAFE_PRIME_P) * modPow(BASE_H, krDelta, SAFE_PRIME_P)) % SAFE_PRIME_P;

    const sigmaChallenge = hashToScalar(
      'POLY-DIV-SIGMA-V1',
      context,
      evalChallengeZ.toString(16),
      cPAtZ.toString(16),
      cDAtZ.toString(16),
      cQAtZ.toString(16),
      announceD.toString(16),
      announceProd.toString(16),
    );

    return {
      dividendCommitments: [...dividend.commitments],
      divisorCommitments: [...divisor.commitments],
      quotientCommitments: [...qComm.commitments],
      evalChallengeZ,
      announceD,
      announceProd,
      sigmaChallenge,
      respDz: modScalar(kd + sigmaChallenge * dAtZ),
      respRd: modScalar(krd + sigmaChallenge * rDAtZ),
      respRDelta: modScalar(krDelta + sigmaChallenge * rDelta),
      context,
    };
  }

  public verifyDivisibility(proof: PolyDivisibilityProof): boolean {
    if (
      proof.dividendCommitments.length === 0 ||
      proof.divisorCommitments.length === 0 ||
      proof.quotientCommitments.length === 0
    ) {
      return false;
    }

    const expectedZ = hashToScalar(
      'POLY-DIV-Z-V1',
      proof.context,
      ...proof.dividendCommitments.map((c) => c.toString(16)),
      ...proof.divisorCommitments.map((c) => c.toString(16)),
      ...proof.quotientCommitments.map((c) => c.toString(16)),
    );
    if (expectedZ !== proof.evalChallengeZ) return false;

    const cPAtZ = this.evalCommitment(proof.dividendCommitments, proof.evalChallengeZ);
    const cDAtZ = this.evalCommitment(proof.divisorCommitments, proof.evalChallengeZ);
    const cQAtZ = this.evalCommitment(proof.quotientCommitments, proof.evalChallengeZ);

    const expectedSigma = hashToScalar(
      'POLY-DIV-SIGMA-V1',
      proof.context,
      proof.evalChallengeZ.toString(16),
      cPAtZ.toString(16),
      cDAtZ.toString(16),
      cQAtZ.toString(16),
      proof.announceD.toString(16),
      proof.announceProd.toString(16),
    );
    if (expectedSigma !== proof.sigmaChallenge) return false;

    const lhs1 = (modPow(BASE_G, proof.respDz, SAFE_PRIME_P) * modPow(BASE_H, proof.respRd, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const rhs1 = (proof.announceD * modPow(cDAtZ, proof.sigmaChallenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    if (lhs1 !== rhs1) return false;

    const lhs2 = (modPow(cQAtZ, proof.respDz, SAFE_PRIME_P) * modPow(BASE_H, proof.respRDelta, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const rhs2 = (proof.announceProd * modPow(cPAtZ, proof.sigmaChallenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return lhs2 === rhs2;
  }

  public verifyBatch(proofs: PolyDivisibilityProof[]): { allValid: boolean; failedIndices: number[] } {
    const failedIndices: number[] = [];
    for (let i = 0; i < proofs.length; i++) {
      if (!this.verifyDivisibility(proofs[i])) failedIndices.push(i);
    }
    return { allValid: failedIndices.length === 0, failedIndices };
  }

  public serializeProof(proof: PolyDivisibilityProof): string {
    return JSON.stringify({
      dividendDegree: proof.dividendCommitments.length - 1,
      divisorDegree: proof.divisorCommitments.length - 1,
      quotientDegree: proof.quotientCommitments.length - 1,
      context: proof.context,
    });
  }
}
