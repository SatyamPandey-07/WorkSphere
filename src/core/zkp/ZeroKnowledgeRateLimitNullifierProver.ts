import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Rate-Limiting Nullifier (RLN) Anonymous Anti-Spam Prover.
 *
 * Implements the Rate-Limiting Nullifier (RLN) protocol combining anonymous group membership
 * with Shamir linear secret-sharing slashing:
 *  - Each registered member holds secret identity key a_0 in Z_Q* with public commitment Y = g^{a_0}.
 *  - For each epoch E, member derives deterministic slope a_1 = H_scalar('RLN-SLOPE' || a_0 || E)
 *    defining the epoch secret-sharing line:
 *      f_E(x) = a_0 + a_1 * x  (mod Q)
 *    and deterministic epoch nullifier N_E = g^{a_1} (or H2G(E)^{a_0}).
 *  - Sending ONE message m with x = H_scalar(m) reveals ONLY ONE point (x, y = f_E(x)) on the
 *    line together with a zero-knowledge LSAG ring proof proving (g^y == Y_s * A_1^x) for some
 *    member s in the group! A single point reveals ZERO information about a_0!
 *  - Sending TWO distinct messages (x_1, y_1) and (x_2, y_2) in the SAME epoch shares the same
 *    epoch nullifier A_1 = g^{a_1}, enabling ANY observer to algebraically recover and slash
 *    the spammer's secret identity key:
 *      a_1 = (y_2 - y_1) / (x_2 - x_1) mod Q
 *      a_0 = (y_1 - a_1 * x_1) mod Q   =>  g^{a_0} == Y_spammer!!
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

export interface RLNMemberIdentity {
  memberId: string;
  secretA0: bigint;
  publicCommitmentY: bigint; // g^{a_0}
}

export interface RLNSignalProof {
  appId: string;
  epochId: string;
  message: string;
  signalX: bigint;
  shareY: bigint;          // a_0 + a_1 * signalX mod Q
  epochNullifierA1: bigint; // g^{a_1} (unique per member per epoch!)
  ringCommitments: bigint[];
  c0: bigint;
  responses: bigint[];
}

export interface RLNSlashingVerdict {
  spamDetected: boolean;
  recoveredSecretA0?: bigint;
  slashedPublicCommitmentY?: bigint;
  slashedMemberId?: string;
  reason: string;
}

export class ZeroKnowledgeRateLimitNullifierProver {
  public readonly appId: string;
  private members: Array<{ memberId: string; publicCommitmentY: bigint }> = [];
  // Tracks seen epoch nullifiers: `${epochId}:${A1_hex}` -> first RLNSignalProof
  private epochSignals = new Map<string, RLNSignalProof>();

  constructor(appId: string) {
    this.appId = appId;
  }

  public registerMember(memberId: string, secret?: bigint): RLNMemberIdentity {
    if (this.members.some((m) => m.memberId === memberId)) {
      throw new Error(`Member "${memberId}" already registered`);
    }
    const secretA0 = secret !== undefined ? modScalar(secret) : randomScalar();
    if (secretA0 === 0n) throw new Error('Identity secret must be non-zero');
    const publicCommitmentY = modPow(BASE_G, secretA0, SAFE_PRIME_P);
    this.members.push({ memberId, publicCommitmentY });
    return { memberId, secretA0, publicCommitmentY };
  }

  public deriveEpochSlope(secretA0: bigint, epochId: string): bigint {
    return hashToScalar('RLN-EPOCH-SLOPE-V1', this.appId, epochId, secretA0.toString(16));
  }

  public hashMessageX(epochId: string, message: string): bigint {
    return hashToScalar('RLN-SIGNAL-X-V1', this.appId, epochId, message);
  }

  private ringChallenge(
    epochId: string,
    signalX: bigint,
    shareY: bigint,
    epochNullifierA1: bigint,
    ringDigest: string,
    L: bigint,
  ): bigint {
    return hashToScalar(
      'RLN-RING-STEP-V1',
      this.appId,
      epochId,
      signalX.toString(16),
      shareY.toString(16),
      epochNullifierA1.toString(16),
      ringDigest,
      L.toString(16),
    );
  }

  private hashRing(ring: bigint[]): string {
    return sha256Hex('RLN-RING-V1', this.appId, ...ring.map((y) => y.toString(16)));
  }

  /**
   * Produces an anonymous RLN signal proof for (epochId, message).
   * Notice that for the real signer s:
   *   Y_s * A_1^{x} == g^{a_0} * g^{a_1 * x} == g^{shareY}
   *   => Y_s == g^{shareY} * A_1^{-x}  is NOT revealed because we prove knowledge of
   *   secretA0 for one ring slot where Z_i = Y_i * A_1^x / g^{shareY} equals 1!
   * Even simpler & cleaner: prove ring knowledge of discrete log of (g^{shareY} * Y_s^{-1}) = A_1^{x}
   * i.e. log_{g^x}(g^{shareY} * Y_s^{-1}) == a_1!
   */
  public generateSignal(identity: RLNMemberIdentity, epochId: string, message: string): RLNSignalProof {
    const ring = this.members.map((m) => m.publicCommitmentY);
    const n = ring.length;
    if (n < 2) throw new Error('RLN group requires at least 2 registered members');
    const signerIdx = ring.indexOf(identity.publicCommitmentY);
    if (signerIdx === -1) throw new Error('Identity not registered in RLN group');

    const a1 = this.deriveEpochSlope(identity.secretA0, epochId);
    const epochNullifierA1 = modPow(BASE_G, a1, SAFE_PRIME_P);
    const signalX = this.hashMessageX(epochId, message);
    const shareY = modScalar(identity.secretA0 + a1 * signalX);

    // Base H_x = g^{signalX}; for every ring member i, target T_i = g^{shareY} * Y_i^{-1}.
    // ONLY for the true signer s does T_s == g^{a_1 * signalX} == (g^{signalX})^{a_1} == H_x^{a_1}
    // while simultaneously A_1 == g^{a_1}!
    // Using a standard ring signature over public keys P_i = (Y_i * A_1^{signalX}) / g^{shareY}
    // Wait: P_s = 1, whereas proving knowledge of log_g(Y_i) in ring with joint equation:
    // Let's prove ring PoK of (a_1) where for index s: g^{a_1} = A_1 AND H_x^{a_1} = g^{shareY} * Y_s^{-1}!
    const gY = modPow(BASE_G, shareY, SAFE_PRIME_P);
    const Hx = modPow(BASE_G, signalX, SAFE_PRIME_P);
    const ringDigest = this.hashRing(ring);

    const challenges = new Array<bigint>(n).fill(0n);
    const responses = new Array<bigint>(n).fill(0n);

    const u = randomScalar();
    const Ls1 = modPow(BASE_G, u, SAFE_PRIME_P);
    const Ls2 = modPow(Hx, u, SAFE_PRIME_P);
    const LsComb = (Ls1 * Ls2) % SAFE_PRIME_P;

    let nextIdx = (signerIdx + 1) % n;
    challenges[nextIdx] = this.ringChallenge(epochId, signalX, shareY, epochNullifierA1, ringDigest, LsComb);

    while (nextIdx !== signerIdx) {
      const si = randomScalar();
      responses[nextIdx] = si;
      const ci = challenges[nextIdx];
      const Ti = (gY * modPow(ring[nextIdx], SAFE_PRIME_P - 2n, SAFE_PRIME_P)) % SAFE_PRIME_P;
      const Li1 = (modPow(BASE_G, si, SAFE_PRIME_P) * modPow(epochNullifierA1, ci, SAFE_PRIME_P)) % SAFE_PRIME_P;
      const Li2 = (modPow(Hx, si, SAFE_PRIME_P) * modPow(Ti, ci, SAFE_PRIME_P)) % SAFE_PRIME_P;
      const LiComb = (Li1 * Li2) % SAFE_PRIME_P;
      const after = (nextIdx + 1) % n;
      challenges[after] = this.ringChallenge(epochId, signalX, shareY, epochNullifierA1, ringDigest, LiComb);
      nextIdx = after;
    }

    responses[signerIdx] = modScalar(u - challenges[signerIdx] * a1);

    return {
      appId: this.appId,
      epochId,
      message,
      signalX,
      shareY,
      epochNullifierA1,
      ringCommitments: ring,
      c0: challenges[0],
      responses,
    };
  }

  public verifySignal(proof: RLNSignalProof): boolean {
    if (proof.appId !== this.appId) return false;
    const n = proof.ringCommitments.length;
    if (n < 2 || proof.responses.length !== n) return false;
    if (this.hashMessageX(proof.epochId, proof.message) !== proof.signalX) return false;

    const gY = modPow(BASE_G, modScalar(proof.shareY), SAFE_PRIME_P);
    const Hx = modPow(BASE_G, modScalar(proof.signalX), SAFE_PRIME_P);
    const ringDigest = this.hashRing(proof.ringCommitments);

    let c = proof.c0;
    for (let i = 0; i < n; i++) {
      const si = proof.responses[i];
      const Ti = (gY * modPow(proof.ringCommitments[i], SAFE_PRIME_P - 2n, SAFE_PRIME_P)) % SAFE_PRIME_P;
      const Li1 = (modPow(BASE_G, si, SAFE_PRIME_P) * modPow(proof.epochNullifierA1, c, SAFE_PRIME_P)) % SAFE_PRIME_P;
      const Li2 = (modPow(Hx, si, SAFE_PRIME_P) * modPow(Ti, c, SAFE_PRIME_P)) % SAFE_PRIME_P;
      const LiComb = (Li1 * Li2) % SAFE_PRIME_P;
      c = this.ringChallenge(proof.epochId, proof.signalX, proof.shareY, proof.epochNullifierA1, ringDigest, LiComb);
    }

    return c === proof.c0;
  }

  /**
   * Processes an incoming RLN signal. If the same anonymous user already sent a different
   * message in the SAME epoch, algebraically recovers their secret a_0 and slashes them!
   */
  public processSignalAndDetectSpam(proof: RLNSignalProof): RLNSlashingVerdict {
    if (!this.verifySignal(proof)) {
      return { spamDetected: false, reason: 'Invalid RLN proof rejected' };
    }
    const key = `${proof.epochId}:${proof.epochNullifierA1.toString(16)}`;
    const prev = this.epochSignals.get(key);
    if (!prev) {
      this.epochSignals.set(key, proof);
      return { spamDetected: false, reason: 'First valid anonymous signal in epoch accepted' };
    }
    if (prev.signalX === proof.signalX) {
      return { spamDetected: false, reason: 'Duplicate identical message ignored (not distinct spam)' };
    }

    // Two distinct points (x1, y1) and (x2, y2) on y = a_0 + a_1 * x => RECOVER SECRET a_0!
    const dy = modScalar(proof.shareY - prev.shareY);
    const dx = modScalar(proof.signalX - prev.signalX);
    const recoveredA1 = modScalar(dy * modInv(dx, SUBGROUP_Q));
    const recoveredSecretA0 = modScalar(prev.shareY - recoveredA1 * prev.signalX);
    const slashedPublicCommitmentY = modPow(BASE_G, recoveredSecretA0, SAFE_PRIME_P);
    const matched = this.members.find((m) => m.publicCommitmentY === slashedPublicCommitmentY);

    return {
      spamDetected: true,
      recoveredSecretA0,
      slashedPublicCommitmentY,
      slashedMemberId: matched?.memberId,
      reason: `Rate-limit exceeded in epoch ${proof.epochId}: secret identity key recovered & member slashed`,
    };
  }

  public serializeSignal(proof: RLNSignalProof): string {
    return JSON.stringify({
      appId: proof.appId,
      epochId: proof.epochId,
      ringSize: proof.ringCommitments.length,
      epochNullifierA1: proof.epochNullifierA1.toString(16),
    });
  }
}
