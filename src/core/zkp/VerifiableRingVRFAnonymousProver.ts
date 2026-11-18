import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Ring VRF Anonymous Prover.
 *
 * Combines a Spontaneous Anonymous Group (LSAG) ring signature with a Verifiable Random
 * Function (VRF) over a safe-prime quadratic-residue subgroup:
 *  - Public ring R = [Y_0, Y_1, ..., Y_{n-1}] where Y_i = g^{x_i} mod P
 *  - VRF input alpha mapped into the order-Q subgroup: H = HashToSubgroup(alpha)
 *  - Deterministic VRF pre-output Gamma = H^{x_s} mod P (also acts as a per-alpha nullifier!)
 *  - Ring proof proves knowledge of (s, x_s) such that:
 *      Y_s = g^{x_s}  AND  Gamma = H^{x_s}
 *    without revealing signer index s.
 *  - Verifiable pseudorandom output beta = SHA-256('RING-VRF-BETA' || alpha || Gamma).
 *
 * Ideal for anonymous validator sortition, private leader election, and unlinkable lotteries.
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

function sha256Hex(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return h.digest('hex');
}

export interface RingVRFKeyPair {
  secretKey: bigint;
  publicKey: bigint;
}

export interface RingVRFProof {
  ring: bigint[];
  alpha: string;
  gamma: bigint;
  vrfOutputHex: string;
  c0: bigint;
  responses: bigint[];
  context: string;
}

export interface SortitionEvaluation {
  eligible: boolean;
  outputNumeric: bigint;
  thresholdTarget: bigint;
  vrfOutputHex: string;
}

export class VerifiableRingVRFAnonymousProver {
  private seenNullifiers = new Set<string>();

  public generateKeyPair(secret?: bigint): RingVRFKeyPair {
    const secretKey = secret !== undefined ? modScalar(secret) : randomScalar();
    if (secretKey === 0n) throw new Error('Secret key must be non-zero');
    return {
      secretKey,
      publicKey: modPow(BASE_G, secretKey, SAFE_PRIME_P),
    };
  }

  public hashToSubgroup(alpha: string): bigint {
    const digest = sha256Hex('RING-VRF-H2G-V1', alpha);
    const raw = (BigInt('0x' + digest.slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
    const qr = (raw * raw) % SAFE_PRIME_P;
    return qr === 1n ? BASE_G : qr;
  }

  public deriveVRFOutput(alpha: string, gamma: bigint): string {
    return sha256Hex('RING-VRF-BETA-V1', alpha, gamma.toString(16));
  }

  private ringChallenge(
    ringDigest: string,
    alpha: string,
    gamma: bigint,
    L: bigint,
    R: bigint,
    context: string,
  ): bigint {
    const digest = sha256Hex(
      'RING-VRF-STEP-V1',
      ringDigest,
      alpha,
      gamma.toString(16),
      L.toString(16),
      R.toString(16),
      context,
    );
    return modScalar(BigInt('0x' + digest.slice(0, 32)));
  }

  private hashRing(ring: bigint[]): string {
    return sha256Hex('RING-VRF-RING', ...ring.map((pk) => pk.toString(16)));
  }

  public prove(
    ring: bigint[],
    signerIndex: number,
    secretKey: bigint,
    alpha: string,
    context = 'epoch-0',
  ): RingVRFProof {
    const n = ring.length;
    if (n < 2) throw new Error('Ring must contain at least 2 public keys');
    if (signerIndex < 0 || signerIndex >= n) throw new RangeError('Signer index out of ring bounds');
    if (modPow(BASE_G, secretKey, SAFE_PRIME_P) !== ring[signerIndex]) {
      throw new Error('Secret key does not match ring[signerIndex]');
    }

    const H = this.hashToSubgroup(alpha);
    const gamma = modPow(H, secretKey, SAFE_PRIME_P);
    const ringDigest = this.hashRing(ring);

    const responses = new Array<bigint>(n).fill(0n);
    const challenges = new Array<bigint>(n).fill(0n);

    // Start ring loop from signerIndex with fresh nonce u
    const u = randomScalar();
    const Ls = modPow(BASE_G, u, SAFE_PRIME_P);
    const Rs = modPow(H, u, SAFE_PRIME_P);

    let nextIdx = (signerIndex + 1) % n;
    challenges[nextIdx] = this.ringChallenge(ringDigest, alpha, gamma, Ls, Rs, context);

    while (nextIdx !== signerIndex) {
      const si = randomScalar();
      responses[nextIdx] = si;
      const ci = challenges[nextIdx];
      const Li = (modPow(BASE_G, si, SAFE_PRIME_P) * modPow(ring[nextIdx], ci, SAFE_PRIME_P)) % SAFE_PRIME_P;
      const Ri = (modPow(H, si, SAFE_PRIME_P) * modPow(gamma, ci, SAFE_PRIME_P)) % SAFE_PRIME_P;
      const after = (nextIdx + 1) % n;
      challenges[after] = this.ringChallenge(ringDigest, alpha, gamma, Li, Ri, context);
      nextIdx = after;
    }

    // Close the ring at signerIndex: g^{s_s} * Y_s^{c_s} = g^u  =>  s_s = u - c_s * x_s mod Q
    responses[signerIndex] = modScalar(u - challenges[signerIndex] * secretKey);

    return {
      ring: [...ring],
      alpha,
      gamma,
      vrfOutputHex: this.deriveVRFOutput(alpha, gamma),
      c0: challenges[0],
      responses,
      context,
    };
  }

  public verify(proof: RingVRFProof): boolean {
    const n = proof.ring.length;
    if (n < 2 || proof.responses.length !== n) return false;
    if (proof.gamma <= 1n || proof.gamma >= SAFE_PRIME_P) return false;
    if (this.deriveVRFOutput(proof.alpha, proof.gamma) !== proof.vrfOutputHex) return false;

    const H = this.hashToSubgroup(proof.alpha);
    const ringDigest = this.hashRing(proof.ring);

    let c = proof.c0;
    for (let i = 0; i < n; i++) {
      const si = proof.responses[i];
      const Li = (modPow(BASE_G, si, SAFE_PRIME_P) * modPow(proof.ring[i], c, SAFE_PRIME_P)) % SAFE_PRIME_P;
      const Ri = (modPow(H, si, SAFE_PRIME_P) * modPow(proof.gamma, c, SAFE_PRIME_P)) % SAFE_PRIME_P;
      c = this.ringChallenge(ringDigest, proof.alpha, proof.gamma, Li, Ri, proof.context);
    }

    return c === proof.c0;
  }

  public registerAndVerifyUnique(proof: RingVRFProof): { valid: boolean; duplicateNullifier: boolean } {
    if (!this.verify(proof)) {
      return { valid: false, duplicateNullifier: false };
    }
    const key = `${proof.alpha}:${proof.gamma.toString(16)}`;
    if (this.seenNullifiers.has(key)) {
      return { valid: false, duplicateNullifier: true };
    }
    this.seenNullifiers.add(key);
    return { valid: true, duplicateNullifier: false };
  }

  public evaluateSortition(proof: RingVRFProof, probabilityBps: number): SortitionEvaluation {
    if (probabilityBps < 0 || probabilityBps > 10000) {
      throw new RangeError('probabilityBps must be between 0 and 10000');
    }
    if (!this.verify(proof)) {
      throw new Error('Cannot evaluate sortition on invalid Ring-VRF proof');
    }
    const maxVal = (1n << 64n) - 1n;
    const outputNumeric = BigInt('0x' + proof.vrfOutputHex.slice(0, 16));
    const thresholdTarget = (maxVal * BigInt(probabilityBps)) / 10000n;
    return {
      eligible: outputNumeric <= thresholdTarget,
      outputNumeric,
      thresholdTarget,
      vrfOutputHex: proof.vrfOutputHex,
    };
  }

  public serializeProof(proof: RingVRFProof): string {
    return JSON.stringify({
      ring: proof.ring.map((pk) => pk.toString(16)),
      alpha: proof.alpha,
      gamma: proof.gamma.toString(16),
      vrfOutputHex: proof.vrfOutputHex,
      c0: proof.c0.toString(16),
      responses: proof.responses.map((s) => s.toString(16)),
      context: proof.context,
    });
  }
}
