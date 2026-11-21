/**
 * @file ZeroKnowledgeQuadraticResidueProver.ts
 * @description Non-Interactive Fiat-Shamir Feige-Fiat-Shamir (FFS) Parallel Quadratic-Residue
 * Identity & Multi-Round Authentication Prover over a Blum Composite Modulus N = P * Q.
 * A prover holds k secret square roots s_1..s_k coprime to N and publishes public quadratic
 * residues v_i = s_i^2 mod N. In each Fiat-Shamir round j = 1..t:
 *   1. Prover commits x_j = r_j^2 mod N for random r_j.
 *   2. Fiat-Shamir bit-matrix e_{j,i} in {0, 1} is derived from H(ctx || v_1..v_k || x_1..x_t).
 *   3. Prover responds y_j = r_j * Prod_{i=1}^k s_i^{e_{j,i}} mod N.
 *   4. Verifier checks y_j^2 == x_j * Prod_{i=1}^k v_i^{e_{j,i}} mod N for every round j!
 * Soundness error drops exponentially as 2^{-(k * t)}!
 */

import { createHash, randomBytes } from 'node:crypto';

// Blum primes (p === 3 mod 4, q === 3 mod 4)
const BLUM_SEED_P = 0x00d1e2f3a4b5c6d7e8f9a1b2c3d4e5f3n;
const BLUM_SEED_Q = 0x00e5f6a7b8c9d0e1f2a3b4c5d6e7f8a7n;

export interface FFSIdentityKeyPair {
  identityId: string;
  modulusN: bigint;
  secretRoots: bigint[];
  publicResidues: bigint[];
  keyFingerprint: string;
}

export interface FFSAuthProof {
  proofId: string;
  identityId: string;
  contextMessage: string;
  modulusN: bigint;
  publicResidues: bigint[];
  roundsCount: number;
  commitmentsX: bigint[];
  challengeBits: Array<Array<0 | 1>>;
  responsesY: bigint[];
  soundnessBits: number;
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

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

function isProbablePrime(n: bigint): boolean {
  if (n < 2n) return false;
  for (const p of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n]) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  let d = n - 1n;
  let s = 0n;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    s += 1n;
  }
  for (const a of [2n, 3n, 5n, 7n, 11n]) {
    if (a >= n) continue;
    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let comp = true;
    for (let r = 1n; r < s; r++) {
      x = (x * x) % n;
      if (x === n - 1n) {
        comp = false;
        break;
      }
    }
    if (comp) return false;
  }
  return true;
}

function nextBlumPrime(start: bigint): bigint {
  let c = start % 4n === 3n ? start : start + ((3n - (start % 4n) + 4n) % 4n);
  while (!isProbablePrime(c)) c += 4n;
  return c;
}

function randomCoprime(n: bigint): bigint {
  for (let i = 0; i < 256; i++) {
    const raw = (BigInt(`0x${randomBytes(32).toString('hex')}`) % (n - 3n)) + 2n;
    if (gcd(raw, n) === 1n) return raw;
  }
  throw new Error('Failed to sample coprime element mod N');
}

/**
 * Non-Interactive Feige-Fiat-Shamir (FFS) Quadratic-Residue Zero-Knowledge Identity Prover.
 */
export class ZeroKnowledgeQuadraticResidueProver {
  private readonly modulusN: bigint;

  constructor() {
    const p = nextBlumPrime(BLUM_SEED_P);
    const q = nextBlumPrime(BLUM_SEED_Q);
    this.modulusN = p * q;
  }

  public getModulusN(): bigint {
    return this.modulusN;
  }

  /**
   * Generates a Feige-Fiat-Shamir identity keypair with `kSecrets` independent secret square roots.
   */
  public generateIdentity(identityId: string, kSecrets = 8): FFSIdentityKeyPair {
    if (!Number.isInteger(kSecrets) || kSecrets < 1 || kSecrets > 64) {
      throw new RangeError('kSecrets must be an integer between 1 and 64');
    }
    const secretRoots: bigint[] = [];
    const publicResidues: bigint[] = [];
    for (let i = 0; i < kSecrets; i++) {
      const s = randomCoprime(this.modulusN);
      secretRoots.push(s);
      publicResidues.push((s * s) % this.modulusN);
    }

    const keyFingerprint = createHash('sha256')
      .update(`WorkSphere::FFSKey|${identityId}|${publicResidues.map((v) => v.toString(16)).join(',')}`)
      .digest('hex')
      .slice(0, 32);

    return {
      identityId,
      modulusN: this.modulusN,
      secretRoots,
      publicResidues,
      keyFingerprint,
    };
  }

  private deriveChallengeMatrix(
    proofId: string,
    identityId: string,
    contextMessage: string,
    publicResidues: readonly bigint[],
    commitmentsX: readonly bigint[]
  ): Array<Array<0 | 1>> {
    const k = publicResidues.length;
    const t = commitmentsX.length;
    const matrix: Array<Array<0 | 1>> = [];

    for (let j = 0; j < t; j++) {
      const h = createHash('sha256');
      h.update(`WorkSphere::FFSChallenge|${proofId}|${identityId}|${contextMessage}|round:${j}`);
      for (const v of publicResidues) h.update(`|v:${v.toString(16)}`);
      for (const x of commitmentsX) h.update(`|x:${x.toString(16)}`);
      const digest = h.digest();

      const bits: Array<0 | 1> = [];
      for (let i = 0; i < k; i++) {
        const byte = digest[(i >> 3) % digest.length];
        const bit = ((byte >> (i & 7)) & 1) === 1 ? 1 : 0;
        bits.push(bit);
      }
      matrix.push(bits);
    }

    return matrix;
  }

  /**
   * Produces a non-interactive Fiat-Shamir Feige-Fiat-Shamir zero-knowledge authentication proof
   * with `roundsCount` parallel rounds (soundness = kSecrets * roundsCount bits!).
   */
  public proveIdentity(
    proofId: string,
    identity: FFSIdentityKeyPair,
    contextMessage: string,
    roundsCount = 16
  ): FFSAuthProof {
    if (!Number.isInteger(roundsCount) || roundsCount < 1) {
      throw new RangeError('roundsCount must be >= 1');
    }
    const k = identity.secretRoots.length;
    const noncesR: bigint[] = [];
    const commitmentsX: bigint[] = [];

    for (let j = 0; j < roundsCount; j++) {
      const r = randomCoprime(this.modulusN);
      noncesR.push(r);
      commitmentsX.push((r * r) % this.modulusN);
    }

    const challengeBits = this.deriveChallengeMatrix(
      proofId,
      identity.identityId,
      contextMessage,
      identity.publicResidues,
      commitmentsX
    );

    const responsesY: bigint[] = [];
    for (let j = 0; j < roundsCount; j++) {
      let y = noncesR[j];
      for (let i = 0; i < k; i++) {
        if (challengeBits[j][i] === 1) {
          y = (y * identity.secretRoots[i]) % this.modulusN;
        }
      }
      responsesY.push(y);
    }

    const soundnessBits = k * roundsCount;
    const proofDigest = createHash('sha256')
      .update(`${proofId}|${identity.identityId}|${contextMessage}|bits:${soundnessBits}|${responsesY[0].toString(16)}`)
      .digest('hex');

    return {
      proofId,
      identityId: identity.identityId,
      contextMessage,
      modulusN: this.modulusN,
      publicResidues: [...identity.publicResidues],
      roundsCount,
      commitmentsX,
      challengeBits,
      responsesY,
      soundnessBits,
      proofDigest,
    };
  }

  /**
   * Publicly verifies a non-interactive FFS authentication proof without ever learning any secret square root.
   */
  public verifyIdentityProof(
    proof: FFSAuthProof,
    expectedPublicResidues: readonly bigint[],
    expectedContextMessage: string
  ): { valid: boolean; failedRound?: number; reason?: string } {
    if (proof.modulusN !== this.modulusN) {
      return { valid: false, reason: 'Modulus N mismatch' };
    }
    if (proof.contextMessage !== expectedContextMessage) {
      return { valid: false, reason: 'Context message mismatch' };
    }
    if (
      proof.publicResidues.length !== expectedPublicResidues.length ||
      proof.publicResidues.some((v, i) => v !== expectedPublicResidues[i])
    ) {
      return { valid: false, reason: 'Public quadratic residue vector mismatch' };
    }
    if (
      proof.commitmentsX.length !== proof.roundsCount ||
      proof.responsesY.length !== proof.roundsCount ||
      proof.challengeBits.length !== proof.roundsCount
    ) {
      return { valid: false, reason: 'Malformed proof round array lengths' };
    }

    const expectedMatrix = this.deriveChallengeMatrix(
      proof.proofId,
      proof.identityId,
      proof.contextMessage,
      proof.publicResidues,
      proof.commitmentsX
    );

    const k = expectedPublicResidues.length;
    for (let j = 0; j < proof.roundsCount; j++) {
      const x = proof.commitmentsX[j];
      const y = proof.responsesY[j];
      if (x === 0n || y === 0n) {
        return { valid: false, failedRound: j, reason: 'Zero commitment or response rejected' };
      }
      for (let i = 0; i < k; i++) {
        if (proof.challengeBits[j][i] !== expectedMatrix[j][i]) {
          return { valid: false, failedRound: j, reason: 'Fiat-Shamir challenge bit mismatch' };
        }
      }

      const lhs = (y * y) % this.modulusN;
      let rhs = modNorm(x, this.modulusN);
      for (let i = 0; i < k; i++) {
        if (expectedMatrix[j][i] === 1) {
          rhs = (rhs * expectedPublicResidues[i]) % this.modulusN;
        }
      }
      if (lhs !== rhs) {
        return { valid: false, failedRound: j, reason: `Quadratic residue equation failed at round ${j}` };
      }
    }

    return { valid: true };
  }

  /**
   * Batch-verifies an identity quorum (requiring at least `requiredQuorum` distinct valid identities).
   */
  public verifyIdentityQuorum(
    proofs: readonly FFSAuthProof[],
    registry: ReadonlyMap<string, readonly bigint[]>,
    expectedContext: string,
    requiredQuorum: number
  ): { quorumMet: boolean; verifiedIdentities: string[]; rejectedIdentities: string[] } {
    const verifiedSet = new Set<string>();
    const rejectedIdentities: string[] = [];

    for (const p of proofs) {
      const expectedPub = registry.get(p.identityId);
      if (!expectedPub || !this.verifyIdentityProof(p, expectedPub, expectedContext).valid) {
        rejectedIdentities.push(p.identityId);
        continue;
      }
      verifiedSet.add(p.identityId);
    }

    const verifiedIdentities = Array.from(verifiedSet);
    return {
      quorumMet: verifiedIdentities.length >= requiredQuorum,
      verifiedIdentities,
      rejectedIdentities,
    };
  }

  public serializeProof(proof: FFSAuthProof): string {
    return JSON.stringify({
      ...proof,
      modulusN: proof.modulusN.toString(16),
      publicResidues: proof.publicResidues.map((v) => v.toString(16)),
      commitmentsX: proof.commitmentsX.map((x) => x.toString(16)),
      responsesY: proof.responsesY.map((y) => y.toString(16)),
    });
  }

  public deserializeProof(payload: string): FFSAuthProof {
    const raw = JSON.parse(payload) as Record<string, any>;
    return {
      ...raw,
      modulusN: BigInt(`0x${raw.modulusN}`),
      publicResidues: raw.publicResidues.map((v: string) => BigInt(`0x${v}`)),
      commitmentsX: raw.commitmentsX.map((x: string) => BigInt(`0x${x}`)),
      responsesY: raw.responsesY.map((y: string) => BigInt(`0x${y}`)),
    } as FFSAuthProof;
  }
}
