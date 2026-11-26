import { createHash } from 'crypto';

/**
 * Zero-Knowledge Linkable Spontaneous Anonymous Group (LSAG) Ring Signature Engine
 *
 * Implements the Liu-Wei-Wong (2004) Linkable Spontaneous Anonymous Group (LSAG)
 * ring signature protocol over a safe-prime subgroup (P = 2Q + 1):
 *   - Signer anonymity across any arbitrary public-key ring [Y_0, ..., Y_{n-1}]
 *   - Deterministic key image I = H_p(Y_pi)^{x_pi} mod P enabling public
 *     double-signing / double-spend linkability without revealing signer identity
 *   - Closed Fiat-Shamir ring challenge loop c_0 -> c_1 -> ... -> c_n == c_0
 */

const SUBGROUP_ORDER = 0x7fffffffffffffffffffffffffffe1d3n; // Prime Q
const SAFE_PRIME = 0xffffffffffffffffffffffffffffc3a7n; // Safe prime P = 2Q + 1
const SUBGROUP_GEN = 4n; // Order-Q generator g

export interface LSAGKeyPair {
  readonly witnessScalar: bigint;
  readonly publicPoint: bigint;
  readonly keyImage: bigint;
}

export interface LSAGRingSignature {
  readonly messageDigest: string;
  readonly ringPublicPoints: readonly bigint[];
  readonly keyImage: bigint;
  readonly initialChallengeC0: bigint;
  readonly responses: readonly bigint[];
  readonly signatureDigest: string;
}

export interface LSAGVerificationResult {
  readonly isValid: boolean;
  readonly ringSize: number;
  readonly recomputedC0: bigint;
  readonly reason?: string;
}

export interface LinkabilityCheckResult {
  readonly linked: boolean;
  readonly sharedKeyImage: bigint | null;
  readonly bothSignaturesValid: boolean;
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

function hashToGroupPoint(publicPoint: bigint): bigint {
  const exp = hashToScalar('LSAG_HP_POINT', [publicPoint.toString(16)]);
  return modPow(SUBGROUP_GEN, exp, SAFE_PRIME);
}

function computeRingHash(ringPublicPoints: readonly bigint[]): string {
  const h = createHash('sha256');
  h.update(`LSAG_RING|${ringPublicPoints.length}`);
  for (const y of ringPublicPoints) {
    h.update('|');
    h.update(y.toString(16));
  }
  return h.digest('hex');
}

export class RingSignatureLinkableProver {
  public generateKeyPair(identitySeed: string): LSAGKeyPair {
    const witnessScalar = hashToScalar('LSAG_KEYPAIR', [identitySeed]);
    const publicPoint = modPow(SUBGROUP_GEN, witnessScalar, SAFE_PRIME);
    const hp = hashToGroupPoint(publicPoint);
    const keyImage = modPow(hp, witnessScalar, SAFE_PRIME);
    return { witnessScalar, publicPoint, keyImage };
  }

  public sign(
    signer: LSAGKeyPair,
    ringPublicPoints: readonly bigint[],
    messageDigest: string,
    signingNonce: string
  ): LSAGRingSignature {
    const n = ringPublicPoints.length;
    if (n < 2) {
      throw new Error('LSAG ring must contain at least 2 public points');
    }
    const signerIndex = ringPublicPoints.indexOf(signer.publicPoint);
    if (signerIndex === -1) {
      throw new Error('Signer public point is not present in the specified ring');
    }
    if (new Set(ringPublicPoints).size !== n) {
      throw new Error('Ring public points must be distinct');
    }

    const ringHash = computeRingHash(ringPublicPoints);
    const hpSigner = hashToGroupPoint(signer.publicPoint);
    const keyImage = modPow(hpSigner, modQ(signer.witnessScalar), SAFE_PRIME);

    const u = hashToScalar('LSAG_U_NONCE', [signingNonce, messageDigest, ringHash]);
    const lPi = modPow(SUBGROUP_GEN, u, SAFE_PRIME);
    const rPi = modPow(hpSigner, u, SAFE_PRIME);

    const challenges = new Array<bigint>(n).fill(0n);
    const responses = new Array<bigint>(n).fill(0n);

    let idx = (signerIndex + 1) % n;
    challenges[idx] = hashToScalar('LSAG_CHALLENGE', [
      ringHash,
      keyImage.toString(16),
      messageDigest,
      lPi.toString(16),
      rPi.toString(16),
    ]);

    while (idx !== signerIndex) {
      const si = hashToScalar('LSAG_SIM_S', [signingNonce, String(idx), messageDigest]);
      responses[idx] = si;
      const yi = ringPublicPoints[idx];
      const hpi = hashToGroupPoint(yi);
      const ci = challenges[idx];

      const li = modP(modPow(SUBGROUP_GEN, si, SAFE_PRIME) * modPow(yi, ci, SAFE_PRIME));
      const ri = modP(modPow(hpi, si, SAFE_PRIME) * modPow(keyImage, ci, SAFE_PRIME));

      const nextIdx = (idx + 1) % n;
      challenges[nextIdx] = hashToScalar('LSAG_CHALLENGE', [
        ringHash,
        keyImage.toString(16),
        messageDigest,
        li.toString(16),
        ri.toString(16),
      ]);
      idx = nextIdx;
    }

    // Close the ring at signerIndex: s_pi = u - c_pi * x_pi mod Q
    responses[signerIndex] = modQ(u - modQ(challenges[signerIndex] * modQ(signer.witnessScalar)));
    const initialChallengeC0 = challenges[0];

    const signatureDigest = createHash('sha256')
      .update(`LSAG_SIG|${ringHash}|${messageDigest}|${keyImage.toString(16)}|${initialChallengeC0.toString(16)}|`)
      .update(responses.map((s) => s.toString(16)).join(','))
      .digest('hex');

    return {
      messageDigest,
      ringPublicPoints: [...ringPublicPoints],
      keyImage,
      initialChallengeC0,
      responses,
      signatureDigest,
    };
  }

  public verify(sig: LSAGRingSignature): LSAGVerificationResult {
    const n = sig.ringPublicPoints.length;
    if (n < 2 || sig.responses.length !== n) {
      return {
        isValid: false,
        ringSize: n,
        recomputedC0: 0n,
        reason: 'Invalid ring size or response vector length',
      };
    }

    if (new Set(sig.ringPublicPoints).size !== n) {
      return {
        isValid: false,
        ringSize: n,
        recomputedC0: 0n,
        reason: 'Duplicate public points in ring',
      };
    }

    // Subgroup order check on keyImage: I^Q == 1 mod P and I != 1
    if (
      sig.keyImage <= 1n ||
      sig.keyImage >= SAFE_PRIME ||
      modPow(sig.keyImage, SUBGROUP_ORDER, SAFE_PRIME) !== 1n
    ) {
      return {
        isValid: false,
        ringSize: n,
        recomputedC0: 0n,
        reason: 'Key image is not a valid non-trivial order-Q subgroup element',
      };
    }

    const ringHash = computeRingHash(sig.ringPublicPoints);
    const expectedSigDigest = createHash('sha256')
      .update(
        `LSAG_SIG|${ringHash}|${sig.messageDigest}|${sig.keyImage.toString(16)}|${sig.initialChallengeC0.toString(16)}|`
      )
      .update(sig.responses.map((s) => modQ(s).toString(16)).join(','))
      .digest('hex');

    if (expectedSigDigest !== sig.signatureDigest) {
      return {
        isValid: false,
        ringSize: n,
        recomputedC0: 0n,
        reason: 'Signature digest integrity mismatch',
      };
    }

    let c = modQ(sig.initialChallengeC0);
    for (let i = 0; i < n; i++) {
      const yi = sig.ringPublicPoints[i];
      const si = modQ(sig.responses[i]);
      const hpi = hashToGroupPoint(yi);

      const li = modP(modPow(SUBGROUP_GEN, si, SAFE_PRIME) * modPow(yi, c, SAFE_PRIME));
      const ri = modP(modPow(hpi, si, SAFE_PRIME) * modPow(sig.keyImage, c, SAFE_PRIME));

      c = hashToScalar('LSAG_CHALLENGE', [
        ringHash,
        sig.keyImage.toString(16),
        sig.messageDigest,
        li.toString(16),
        ri.toString(16),
      ]);
    }

    if (c !== modQ(sig.initialChallengeC0)) {
      return {
        isValid: false,
        ringSize: n,
        recomputedC0: c,
        reason: 'LSAG ring challenge loop did not close at c_0',
      };
    }

    return {
      isValid: true,
      ringSize: n,
      recomputedC0: c,
    };
  }

  public checkLinkability(sigA: LSAGRingSignature, sigB: LSAGRingSignature): LinkabilityCheckResult {
    const validA = this.verify(sigA).isValid;
    const validB = this.verify(sigB).isValid;
    if (!validA || !validB) {
      return {
        linked: false,
        sharedKeyImage: null,
        bothSignaturesValid: false,
      };
    }
    const linked = sigA.keyImage === sigB.keyImage;
    return {
      linked,
      sharedKeyImage: linked ? sigA.keyImage : null,
      bothSignaturesValid: true,
    };
  }
}
