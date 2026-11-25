/**
 * @file ThresholdRingSignatureVerifier.ts
 * @description t-out-of-n Linkable Threshold Ring Signature Prover & Verifier.
 * Allows any t anonymous members of a public ring of size n to jointly endorse a WorkSphere
 * governance action without disclosing WHICH t members signed, while emitting deterministic
 * linkable key images I_j = H_p(pk_j)^{sk_j} so any duplicate signer is immediately caught.
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface RingMemberKeyPair {
  memberId: string;
  secretKey: bigint;
  publicKey: bigint;
}

export interface LinkableRingSignature {
  scopeId: string;
  message: string;
  ringPublicKeys: bigint[];
  keyImage: bigint;
  c0: bigint;
  responses: bigint[];
  signatureDigest: string;
}

export interface ThresholdRingBundle {
  bundleId: string;
  scopeId: string;
  message: string;
  requiredThreshold: number;
  ringPublicKeys: bigint[];
  signatures: LinkableRingSignature[];
  bundleDigest: string;
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
 * Linkable Spontaneous Anonymous Group (LSAG) Ring Signature & Threshold Quorum Verifier.
 */
export class ThresholdRingSignatureVerifier {
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

  public generateMemberKey(memberId: string, seedSecret?: bigint): RingMemberKeyPair {
    const secretKey = seedSecret !== undefined
      ? modNorm(seedSecret, this.q - 2n) + 2n
      : randomScalar(this.q);
    return {
      memberId,
      secretKey,
      publicKey: modPow(this.g, secretKey, this.p),
    };
  }

  /**
   * Deterministically maps (scopeId, publicKey) to an order-q quadratic residue base H_p.
   */
  public hashToSubgroupBase(scopeId: string, publicKey: bigint): bigint {
    for (let c = 0; c < 1024; c++) {
      const digest = createHash('sha256')
        .update(`WorkSphere::RingHp|${scopeId}|${publicKey.toString(16)}|${c}`)
        .digest('hex');
      const raw = BigInt(`0x${digest}`) % (this.p - 2n) + 2n;
      const point = (raw * raw) % this.p;
      if (point > 1n && modPow(point, this.q, this.p) === 1n) {
        return point;
      }
    }
    throw new Error('Failed to map public key to order-q subgroup base');
  }

  private computeRingHash(
    scopeId: string,
    message: string,
    ringKeys: readonly bigint[],
    keyImage: bigint,
    L: bigint,
    R: bigint
  ): bigint {
    return hashScalar('WorkSphere::LSAGChallenge', [
      scopeId,
      message,
      keyImage,
      L,
      R,
      BigInt(ringKeys.length),
      ...ringKeys,
    ]);
  }

  /**
   * Creates a single linkable ring signature on `message` under `scopeId` for a ring member
   * at index `signerIndex` without revealing which ring key produced it.
   */
  public signRingMember(
    scopeId: string,
    message: string,
    ringPublicKeys: readonly bigint[],
    signerIndex: number,
    signerSecretKey: bigint
  ): LinkableRingSignature {
    const n = ringPublicKeys.length;
    if (n < 2) {
      throw new Error('Ring must contain at least 2 public keys');
    }
    if (signerIndex < 0 || signerIndex >= n) {
      throw new RangeError('signerIndex out of ring bounds');
    }
    if (modPow(this.g, signerSecretKey, this.p) !== ringPublicKeys[signerIndex]) {
      throw new Error('Signer secret key does not match public key at signerIndex');
    }

    const hpSigner = this.hashToSubgroupBase(scopeId, ringPublicKeys[signerIndex]);
    const keyImage = modPow(hpSigner, signerSecretKey, this.p);

    const challenges = new Array<bigint>(n);
    const responses = new Array<bigint>(n);

    const alpha = randomScalar(this.q);
    const LStart = modPow(this.g, alpha, this.p);
    const RStart = modPow(hpSigner, alpha, this.p);

    let idx = (signerIndex + 1) % n;
    challenges[idx] = this.computeRingHash(scopeId, message, ringPublicKeys, keyImage, LStart, RStart);

    while (idx !== signerIndex) {
      const s = randomScalar(this.q);
      responses[idx] = s;
      const hp = this.hashToSubgroupBase(scopeId, ringPublicKeys[idx]);
      const L = (modPow(this.g, s, this.p) * modPow(ringPublicKeys[idx], challenges[idx], this.p)) % this.p;
      const R = (modPow(hp, s, this.p) * modPow(keyImage, challenges[idx], this.p)) % this.p;
      const nextIdx = (idx + 1) % n;
      challenges[nextIdx] = this.computeRingHash(scopeId, message, ringPublicKeys, keyImage, L, R);
      idx = nextIdx;
    }

    // Close the ring at signerIndex: s_pi = alpha - c_pi * sk mod q
    responses[signerIndex] = modNorm(alpha - challenges[signerIndex] * signerSecretKey, this.q);

    const signatureDigest = createHash('sha256')
      .update(`${scopeId}|${message}|${keyImage.toString(16)}|${challenges[0].toString(16)}`)
      .digest('hex');

    return {
      scopeId,
      message,
      ringPublicKeys: [...ringPublicKeys],
      keyImage,
      c0: challenges[0],
      responses,
      signatureDigest,
    };
  }

  /**
   * Verifies a single linkable ring signature by walking the ring and checking closure at c0.
   */
  public verifyRingSignature(sig: LinkableRingSignature): boolean {
    const n = sig.ringPublicKeys.length;
    if (n < 2 || sig.responses.length !== n) return false;
    if (sig.keyImage <= 1n || sig.keyImage >= this.p) return false;
    if (modPow(sig.keyImage, this.q, this.p) !== 1n) return false;

    const expectedDigest = createHash('sha256')
      .update(`${sig.scopeId}|${sig.message}|${sig.keyImage.toString(16)}|${sig.c0.toString(16)}`)
      .digest('hex');
    if (expectedDigest !== sig.signatureDigest) return false;

    let c = sig.c0;
    for (let i = 0; i < n; i++) {
      const s = sig.responses[i];
      if (s < 0n || s >= this.q) return false;
      const hp = this.hashToSubgroupBase(sig.scopeId, sig.ringPublicKeys[i]);
      const L = (modPow(this.g, s, this.p) * modPow(sig.ringPublicKeys[i], c, this.p)) % this.p;
      const R = (modPow(hp, s, this.p) * modPow(sig.keyImage, c, this.p)) % this.p;
      c = this.computeRingHash(sig.scopeId, sig.message, sig.ringPublicKeys, sig.keyImage, L, R);
    }

    return c === sig.c0;
  }

  /**
   * Checks whether two linkable ring signatures under the same scope were produced by the same signer.
   */
  public areSignaturesLinked(sigA: LinkableRingSignature, sigB: LinkableRingSignature): boolean {
    return sigA.scopeId === sigB.scopeId && sigA.keyImage === sigB.keyImage;
  }

  /**
   * Builds a t-of-n threshold ring approval bundle from t distinct anonymous signers.
   */
  public createThresholdRingBundle(
    bundleId: string,
    scopeId: string,
    message: string,
    requiredThreshold: number,
    ringPublicKeys: readonly bigint[],
    signers: ReadonlyArray<{ signerIndex: number; secretKey: bigint }>
  ): ThresholdRingBundle {
    if (requiredThreshold < 1 || requiredThreshold > ringPublicKeys.length) {
      throw new RangeError('Invalid threshold for ring size');
    }

    const signatures = signers.map((s) =>
      this.signRingMember(scopeId, message, ringPublicKeys, s.signerIndex, s.secretKey)
    );
    const bundleDigest = createHash('sha256')
      .update(`${bundleId}|${scopeId}|${message}|t:${requiredThreshold}|${signatures.map((s) => s.keyImage.toString(16)).join(',')}`)
      .digest('hex');

    return {
      bundleId,
      scopeId,
      message,
      requiredThreshold,
      ringPublicKeys: [...ringPublicKeys],
      signatures,
      bundleDigest,
    };
  }

  /**
   * Verifies a t-of-n threshold ring bundle: ensures every signature is cryptographically valid,
   * bound to the exact same ring/scope/message, has strictly distinct key images (no double-signing),
   * and reaches the required quorum threshold.
   */
  public verifyThresholdRingBundle(bundle: ThresholdRingBundle): {
    valid: boolean;
    uniqueValidSigners: number;
    duplicateKeyImages: bigint[];
    invalidSignatureIndices: number[];
    reason?: string;
  } {
    const seenKeyImages = new Set<bigint>();
    const duplicateKeyImages: bigint[] = [];
    const invalidSignatureIndices: number[] = [];

    for (let i = 0; i < bundle.signatures.length; i++) {
      const sig = bundle.signatures[i];
      const ringMatch =
        sig.ringPublicKeys.length === bundle.ringPublicKeys.length &&
        sig.ringPublicKeys.every((pk, j) => pk === bundle.ringPublicKeys[j]);

      if (
        sig.scopeId !== bundle.scopeId ||
        sig.message !== bundle.message ||
        !ringMatch ||
        !this.verifyRingSignature(sig)
      ) {
        invalidSignatureIndices.push(i);
        continue;
      }

      if (seenKeyImages.has(sig.keyImage)) {
        duplicateKeyImages.push(sig.keyImage);
        continue;
      }
      seenKeyImages.add(sig.keyImage);
    }

    const uniqueValidSigners = seenKeyImages.size;
    if (invalidSignatureIndices.length > 0) {
      return {
        valid: false,
        uniqueValidSigners,
        duplicateKeyImages,
        invalidSignatureIndices,
        reason: 'One or more ring signatures failed cryptographic verification',
      };
    }
    if (duplicateKeyImages.length > 0) {
      return {
        valid: false,
        uniqueValidSigners,
        duplicateKeyImages,
        invalidSignatureIndices,
        reason: 'Double-signing detected via duplicate linkable key image',
      };
    }
    if (uniqueValidSigners < bundle.requiredThreshold) {
      return {
        valid: false,
        uniqueValidSigners,
        duplicateKeyImages,
        invalidSignatureIndices,
        reason: `Threshold not met: ${uniqueValidSigners} < ${bundle.requiredThreshold}`,
      };
    }

    return {
      valid: true,
      uniqueValidSigners,
      duplicateKeyImages: [],
      invalidSignatureIndices: [],
    };
  }

  public serializeBundle(bundle: ThresholdRingBundle): string {
    return JSON.stringify({
      bundleId: bundle.bundleId,
      scopeId: bundle.scopeId,
      message: bundle.message,
      requiredThreshold: bundle.requiredThreshold,
      ringPublicKeys: bundle.ringPublicKeys.map((pk) => pk.toString(16)),
      signatures: bundle.signatures.map((s) => ({
        scopeId: s.scopeId,
        message: s.message,
        ringPublicKeys: s.ringPublicKeys.map((pk) => pk.toString(16)),
        keyImage: s.keyImage.toString(16),
        c0: s.c0.toString(16),
        responses: s.responses.map((r) => r.toString(16)),
        signatureDigest: s.signatureDigest,
      })),
      bundleDigest: bundle.bundleDigest,
    });
  }

  public deserializeBundle(payload: string): ThresholdRingBundle {
    const raw = JSON.parse(payload) as Record<string, any>;
    return {
      bundleId: raw.bundleId,
      scopeId: raw.scopeId,
      message: raw.message,
      requiredThreshold: Number(raw.requiredThreshold),
      ringPublicKeys: raw.ringPublicKeys.map((pk: string) => BigInt(`0x${pk}`)),
      signatures: raw.signatures.map((s: Record<string, any>) => ({
        scopeId: s.scopeId,
        message: s.message,
        ringPublicKeys: s.ringPublicKeys.map((pk: string) => BigInt(`0x${pk}`)),
        keyImage: BigInt(`0x${s.keyImage}`),
        c0: BigInt(`0x${s.c0}`),
        responses: s.responses.map((r: string) => BigInt(`0x${r}`)),
        signatureDigest: s.signatureDigest,
      })),
      bundleDigest: raw.bundleDigest,
    };
  }
}
