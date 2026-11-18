/**
 * @file ZeroKnowledgeKOutOfNDisjunctionProver.ts
 * @description Cramer-Damgard-Schoenmakers (CDS) Threshold k-out-of-n Partial-Knowledge Sigma
 * Protocol Prover & Verifier.
 * Given n public statements Y_1, ..., Y_n (where Y_i = g^{x_i} mod p), allows a prover who knows
 * AT LEAST k secret witnesses to prove knowledge of k witnesses WITHOUT disclosing WHICH k
 * statements they know:
 *   1. For the (n - k) unknown statements, prover simulates Schnorr transcripts (a_i, c_i, z_i)
 *      with random challenges c_i and responses z_i.
 *   2. For the k known statements, prover commits honestly a_i = g^{w_i}.
 *   3. Fiat-Shamir root challenge e_0 = H(context || Y_1..Y_n || a_1..a_n).
 *   4. Prover interpolates the UNIQUE degree-(n - k) polynomial P(x) over F_q such that:
 *        P(0) = e_0  AND  P(i) = c_i for all (n - k) simulated indices i!
 *   5. For each of the k known indices j, prover sets c_j = P(j) and computes real response
 *      z_j = w_j + c_j * x_j mod q.
 *   6. Verifier checks all n Schnorr equations AND verifies that all n challenges (1, c_1)..(n, c_n)
 *      plus (0, e_0) lie on a single polynomial of degree <= (n - k)!
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface StatementWitness {
  index: number; // 0-based index in publicKeys
  secretKey: bigint;
}

export interface CDSBranchTranscript {
  index: number; // 0-based
  commitmentA: bigint;
  challengeC: bigint;
  responseZ: bigint;
}

export interface KOutOfNThresholdProof {
  proofId: string;
  contextMessage: string;
  thresholdK: number;
  totalN: number;
  publicKeys: bigint[];
  rootChallengeE0: bigint;
  branches: CDSBranchTranscript[];
  polynomialCoeffs: bigint[]; // degree <= n - k polynomial P(x) with P(0) = e_0
  proofDigest: string;
}

function modNorm(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = modNorm(base, mod);
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function modInverse(a: bigint, m: bigint): bigint {
  let t = 0n;
  let newT = 1n;
  let r = m;
  let newR = modNorm(a, m);
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  if (r > 1n) throw new Error('Not invertible in F_q');
  return t < 0n ? t + m : t;
}

function randomScalar(q: bigint): bigint {
  return (BigInt(`0x${randomBytes(16).toString('hex')}`) % (q - 2n)) + 2n;
}

function hashScalar(domain: string, parts: readonly (string | bigint)[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const part of parts) {
    h.update('|');
    h.update(typeof part === 'bigint' ? part.toString(16) : part);
  }
  return (BigInt(`0x${h.digest('hex')}`) % (SUBGROUP_Q - 1n)) + 1n;
}

/**
 * Cramer-Damgard-Schoenmakers (CDS) k-out-of-n Threshold Partial-Knowledge Sigma Prover.
 */
export class ZeroKnowledgeKOutOfNDisjunctionProver {
  private readonly p: bigint;
  private readonly q: bigint;
  private readonly g: bigint;

  constructor(p = SAFE_PRIME_P, q = SUBGROUP_Q, g = BASE_G) {
    if (p !== 2n * q + 1n) {
      throw new Error('Safe prime invariant p = 2q + 1 is required');
    }
    this.p = p;
    this.q = q;
    this.g = g;
  }

  public generateKeyPair(seedSecret?: bigint): { secretKey: bigint; publicKey: bigint } {
    const secretKey = seedSecret !== undefined
      ? modNorm(seedSecret, this.q - 2n) + 2n
      : randomScalar(this.q);
    return { secretKey, publicKey: modPow(this.g, secretKey, this.p) };
  }

  /**
   * Evaluates polynomial P(x) = Sum coeffs[d] * x^d mod q.
   */
  public evaluatePoly(coeffs: readonly bigint[], x: bigint): bigint {
    let acc = 0n;
    const xn = modNorm(x, this.q);
    for (let i = coeffs.length - 1; i >= 0; i--) {
      acc = modNorm(acc * xn + coeffs[i], this.q);
    }
    return acc;
  }

  /**
   * Interpolates the unique degree <= (m - 1) polynomial over F_q through m distinct (x, y) points.
   */
  public interpolatePoly(points: ReadonlyArray<{ x: bigint; y: bigint }>): bigint[] {
    const m = points.length;
    const res = new Array<bigint>(m).fill(0n);

    for (let i = 0; i < m; i++) {
      let basis = [1n];
      let denom = 1n;
      for (let j = 0; j < m; j++) {
        if (i === j) continue;
        const next = new Array<bigint>(basis.length + 1).fill(0n);
        const negXj = modNorm(-points[j].x, this.q);
        for (let d = 0; d < basis.length; d++) {
          next[d] = modNorm(next[d] + basis[d] * negXj, this.q);
          next[d + 1] = modNorm(next[d + 1] + basis[d], this.q);
        }
        basis = next;
        denom = modNorm(denom * modNorm(points[i].x - points[j].x, this.q), this.q);
      }
      const scale = modNorm(modNorm(points[i].y, this.q) * modInverse(denom, this.q), this.q);
      for (let d = 0; d < basis.length; d++) {
        res[d] = modNorm(res[d] + basis[d] * scale, this.q);
      }
    }

    return res;
  }

  /**
   * Generates a CDS k-out-of-n zero-knowledge threshold proof using exactly `thresholdK` known witnesses.
   */
  public proveKOutOfN(
    proofId: string,
    contextMessage: string,
    publicKeys: readonly bigint[],
    thresholdK: number,
    knownWitnesses: readonly StatementWitness[]
  ): KOutOfNThresholdProof {
    const n = publicKeys.length;
    if (n < 1 || thresholdK < 1 || thresholdK > n) {
      throw new RangeError('Threshold k must satisfy 1 <= k <= n');
    }
    if (knownWitnesses.length < thresholdK) {
      throw new Error(`Need at least ${thresholdK} valid witnesses, got ${knownWitnesses.length}`);
    }

    const witnessMap = new Map<number, bigint>();
    for (const w of knownWitnesses) {
      if (w.index < 0 || w.index >= n) {
        throw new RangeError(`Witness index ${w.index} out of bounds`);
      }
      if (modPow(this.g, modNorm(w.secretKey, this.q), this.p) !== publicKeys[w.index]) {
        throw new Error(`Witness secret at index ${w.index} does not match publicKey`);
      }
      if (witnessMap.size < thresholdK) {
        witnessMap.set(w.index, modNorm(w.secretKey, this.q));
      }
    }
    if (witnessMap.size < thresholdK) {
      throw new Error(`Need ${thresholdK} distinct witness indices`);
    }

    const commitmentsA = new Array<bigint>(n);
    const knownNonces = new Map<number, bigint>();
    const simChallenges = new Map<number, bigint>();
    const simResponses = new Map<number, bigint>();

    for (let i = 0; i < n; i++) {
      if (witnessMap.has(i)) {
        const w = randomScalar(this.q);
        knownNonces.set(i, w);
        commitmentsA[i] = modPow(this.g, w, this.p);
      } else {
        const c = randomScalar(this.q);
        const z = randomScalar(this.q);
        simChallenges.set(i, c);
        simResponses.set(i, z);
        const negC = modNorm(this.q - c, this.q);
        commitmentsA[i] = (modPow(this.g, z, this.p) * modPow(publicKeys[i], negC, this.p)) % this.p;
      }
    }

    const rootChallengeE0 = hashScalar('WorkSphere::CDSRootChallenge', [
      proofId,
      contextMessage,
      BigInt(thresholdK),
      BigInt(n),
      ...publicKeys,
      ...commitmentsA,
    ]);

    // Interpolate degree-(n - k) polynomial P through (0, e_0) and all (i+1, simC_i)
    const interpPoints: Array<{ x: bigint; y: bigint }> = [{ x: 0n, y: rootChallengeE0 }];
    for (const [idx, c] of simChallenges.entries()) {
      interpPoints.push({ x: BigInt(idx + 1), y: c });
    }
    const polynomialCoeffs = this.interpolatePoly(interpPoints);

    const branches: CDSBranchTranscript[] = [];
    for (let i = 0; i < n; i++) {
      if (witnessMap.has(i)) {
        const c = this.evaluatePoly(polynomialCoeffs, BigInt(i + 1));
        const z = modNorm(knownNonces.get(i)! + c * witnessMap.get(i)!, this.q);
        branches.push({
          index: i,
          commitmentA: commitmentsA[i],
          challengeC: c,
          responseZ: z,
        });
      } else {
        branches.push({
          index: i,
          commitmentA: commitmentsA[i],
          challengeC: simChallenges.get(i)!,
          responseZ: simResponses.get(i)!,
        });
      }
    }

    const proofDigest = createHash('sha256')
      .update(
        `${proofId}|${contextMessage}|k:${thresholdK}|n:${n}|e0:${rootChallengeE0.toString(16)}|${branches.map((b) => b.responseZ.toString(16)).join(',')}`
      )
      .digest('hex');

    return {
      proofId,
      contextMessage,
      thresholdK,
      totalN: n,
      publicKeys: [...publicKeys],
      rootChallengeE0,
      branches,
      polynomialCoeffs,
      proofDigest,
    };
  }

  /**
   * Publicly verifies a CDS k-out-of-n threshold proof without learning which k witnesses were used.
   */
  public verifyKOutOfN(proof: KOutOfNThresholdProof): { valid: boolean; reason?: string } {
    const n = proof.totalN;
    const k = proof.thresholdK;
    if (n < 1 || k < 1 || k > n) {
      return { valid: false, reason: 'Invalid threshold parameters' };
    }
    if (proof.publicKeys.length !== n || proof.branches.length !== n) {
      return { valid: false, reason: 'Public key or branch count mismatch' };
    }
    // Polynomial degree MUST be <= n - k (length <= n - k + 1)
    if (proof.polynomialCoeffs.length > n - k + 1 || proof.polynomialCoeffs.length === 0) {
      return { valid: false, reason: 'Challenge sharing polynomial exceeds maximum allowed degree (n - k)' };
    }

    const expectedE0 = hashScalar('WorkSphere::CDSRootChallenge', [
      proof.proofId,
      proof.contextMessage,
      BigInt(k),
      BigInt(n),
      ...proof.publicKeys,
      ...proof.branches.map((b) => b.commitmentA),
    ]);
    if (expectedE0 !== proof.rootChallengeE0) {
      return { valid: false, reason: 'Root Fiat-Shamir challenge e_0 mismatch' };
    }
    if (this.evaluatePoly(proof.polynomialCoeffs, 0n) !== expectedE0) {
      return { valid: false, reason: 'Polynomial constant term P(0) does not equal e_0' };
    }

    for (let i = 0; i < n; i++) {
      const br = proof.branches[i];
      if (br.index !== i) {
        return { valid: false, reason: `Out-of-order branch index ${br.index}` };
      }
      const expectedC = this.evaluatePoly(proof.polynomialCoeffs, BigInt(i + 1));
      if (expectedC !== br.challengeC) {
        return { valid: false, reason: `Branch ${i} challenge does not lie on degree-(n-k) polynomial` };
      }

      const lhs = modPow(this.g, modNorm(br.responseZ, this.q), this.p);
      const rhs = (br.commitmentA * modPow(proof.publicKeys[i], br.challengeC, this.p)) % this.p;
      if (lhs !== rhs) {
        return { valid: false, reason: `Branch ${i} Schnorr verification failed` };
      }
    }

    return { valid: true };
  }

  /**
   * Batch-verifies multiple independent CDS threshold proofs.
   */
  public batchVerify(proofs: readonly KOutOfNThresholdProof[]): {
    allValid: boolean;
    validCount: number;
    failedProofIds: string[];
  } {
    const failedProofIds: string[] = [];
    for (const p of proofs) {
      if (!this.verifyKOutOfN(p).valid) {
        failedProofIds.push(p.proofId);
      }
    }
    return {
      allValid: proofs.length > 0 && failedProofIds.length === 0,
      validCount: proofs.length - failedProofIds.length,
      failedProofIds,
    };
  }

  public serializeProof(proof: KOutOfNThresholdProof): string {
    return JSON.stringify({
      proofId: proof.proofId,
      contextMessage: proof.contextMessage,
      thresholdK: proof.thresholdK,
      totalN: proof.totalN,
      publicKeys: proof.publicKeys.map((pk) => pk.toString(16)),
      rootChallengeE0: proof.rootChallengeE0.toString(16),
      polynomialCoeffs: proof.polynomialCoeffs.map((c) => c.toString(16)),
      branches: proof.branches.map((b) => ({
        index: b.index,
        commitmentA: b.commitmentA.toString(16),
        challengeC: b.challengeC.toString(16),
        responseZ: b.responseZ.toString(16),
      })),
      proofDigest: proof.proofDigest,
    });
  }

  public deserializeProof(payload: string): KOutOfNThresholdProof {
    const raw = JSON.parse(payload) as Record<string, any>;
    return {
      proofId: raw.proofId,
      contextMessage: raw.contextMessage,
      thresholdK: Number(raw.thresholdK),
      totalN: Number(raw.totalN),
      publicKeys: raw.publicKeys.map((pk: string) => BigInt(`0x${pk}`)),
      rootChallengeE0: BigInt(`0x${raw.rootChallengeE0}`),
      polynomialCoeffs: raw.polynomialCoeffs.map((c: string) => BigInt(`0x${c}`)),
      branches: raw.branches.map((b: Record<string, any>) => ({
        index: Number(b.index),
        commitmentA: BigInt(`0x${b.commitmentA}`),
        challengeC: BigInt(`0x${b.challengeC}`),
        responseZ: BigInt(`0x${b.responseZ}`),
      })),
      proofDigest: raw.proofDigest,
    };
  }
}
