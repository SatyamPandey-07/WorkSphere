import { createHash } from 'crypto';

/**
 * Verifiable Zero-Knowledge Threshold Proxy Key-Switching Protocol
 *
 * Implements Blaze-Bleumer-Strauss / Umbral-style (t, n) threshold proxy
 * re-encryption (key switching) over a safe-prime subgroup (P = 2Q + 1).
 * A delegator (pk_A = g^a) splits the re-encryption transform rk = a * b^{-1} mod Q
 * into Shamir shares rk_i with Feldman public verification points V_i = g^{rk_i}.
 * Any t honest proxy nodes transform c1 -> T_i = c1^{rk_i} with Chaum-Pedersen
 * DLEQ proofs, producing a switched ciphertext (c1', c2) decryptable solely by
 * the delegatee (pk_B = g^b) without ever exposing a or the plaintext M.
 */

const SUBGROUP_ORDER = 0x7fffffffffffffffffffffffffffe1d3n; // Prime Q
const SAFE_PRIME = 0xffffffffffffffffffffffffffffc3a7n; // Safe prime P = 2Q + 1
const SUBGROUP_GEN = 4n; // Order-Q generator g

export interface KeyPair {
  readonly witnessScalar: bigint;
  readonly publicPoint: bigint;
}

export interface SwitchableCiphertext {
  readonly c1: bigint;
  readonly c2: bigint;
}

export interface DLEQProof {
  readonly a1: bigint;
  readonly a2: bigint;
  readonly challenge: bigint;
  readonly response: bigint;
}

export interface ProxyKeySwitchShare {
  readonly proxyId: number;
  readonly shareScalar: bigint;
  readonly publicVerificationPoint: bigint;
}

export interface KeySwitchDelegation {
  readonly threshold: number;
  readonly totalProxies: number;
  readonly delegatorPublicPoint: bigint;
  readonly delegateePublicPoint: bigint;
  readonly feldmanCommitments: readonly bigint[];
  readonly proxyShares: readonly ProxyKeySwitchShare[];
  readonly delegationDigest: string;
}

export interface PartialTransformCapsule {
  readonly proxyId: number;
  readonly transformedC1: bigint;
  readonly dleqProof: DLEQProof;
}

export interface SwitchedCiphertextResult {
  readonly isValid: boolean;
  readonly switchedCiphertext: SwitchableCiphertext | null;
  readonly participatingProxyIds: readonly number[];
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

function modInverseP(a: bigint): bigint {
  return modPow(a, SAFE_PRIME - 2n, SAFE_PRIME);
}

function modInverseQ(a: bigint): bigint {
  const val = modQ(a);
  if (val === 0n) throw new Error('Cannot invert zero mod Q');
  return modPow(val, SUBGROUP_ORDER - 2n, SUBGROUP_ORDER);
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

export class DistributedKeySwitching {
  private readonly threshold: number;
  private readonly totalProxies: number;

  constructor(threshold: number, totalProxies: number) {
    if (!Number.isInteger(threshold) || !Number.isInteger(totalProxies)) {
      throw new Error('threshold and totalProxies must be integers');
    }
    if (threshold < 2 || threshold > totalProxies) {
      throw new Error('Require 2 <= threshold <= totalProxies');
    }
    this.threshold = threshold;
    this.totalProxies = totalProxies;
  }

  public generateKeyPair(identitySeed: string): KeyPair {
    const witnessScalar = hashToScalar('DKS_KEYPAIR', [identitySeed]);
    const publicPoint = modPow(SUBGROUP_GEN, witnessScalar, SAFE_PRIME);
    return { witnessScalar, publicPoint };
  }

  public encodePlaintextPoint(messageValue: bigint): bigint {
    return modPow(SUBGROUP_GEN, modQ(messageValue), SAFE_PRIME);
  }

  public encrypt(
    recipientPublicPoint: bigint,
    plaintextPoint: bigint,
    nonceLabel: string
  ): SwitchableCiphertext {
    const r = hashToScalar('DKS_ENC_R', [
      recipientPublicPoint.toString(16),
      plaintextPoint.toString(16),
      nonceLabel,
    ]);
    const c1 = modPow(SUBGROUP_GEN, r, SAFE_PRIME);
    const c2 = modP(plaintextPoint * modPow(recipientPublicPoint, r, SAFE_PRIME));
    return { c1, c2 };
  }

  public decrypt(
    recipientWitnessScalar: bigint,
    ciphertext: SwitchableCiphertext
  ): bigint {
    const shared = modPow(ciphertext.c1, modQ(recipientWitnessScalar), SAFE_PRIME);
    return modP(ciphertext.c2 * modInverseP(shared));
  }

  public createDelegation(
    delegatorKey: KeyPair,
    delegateeKey: KeyPair,
    delegationLabel: string
  ): KeySwitchDelegation {
    const rk = modQ(modQ(delegatorKey.witnessScalar) * modInverseQ(delegateeKey.witnessScalar));
    const coeffs: bigint[] = [rk];
    for (let k = 1; k < this.threshold; k++) {
      coeffs.push(hashToScalar('DKS_SHAMIR_COEFF', [delegationLabel, String(k)]));
    }

    const feldmanCommitments = coeffs.map((c) => modPow(SUBGROUP_GEN, c, SAFE_PRIME));
    const proxyShares: ProxyKeySwitchShare[] = [];

    for (let id = 1; id <= this.totalProxies; id++) {
      const x = BigInt(id);
      let y = 0n;
      let xPow = 1n;
      for (let k = 0; k < coeffs.length; k++) {
        y = modQ(y + modQ(coeffs[k] * xPow));
        xPow = modQ(xPow * x);
      }
      proxyShares.push({
        proxyId: id,
        shareScalar: y,
        publicVerificationPoint: modPow(SUBGROUP_GEN, y, SAFE_PRIME),
      });
    }

    const delegationDigest = createHash('sha256')
      .update('DKS_DELEGATION|')
      .update(`${this.threshold}|${this.totalProxies}|`)
      .update(`${delegatorKey.publicPoint.toString(16)}|${delegateeKey.publicPoint.toString(16)}|`)
      .update(feldmanCommitments.map((c) => c.toString(16)).join(','))
      .digest('hex');

    return {
      threshold: this.threshold,
      totalProxies: this.totalProxies,
      delegatorPublicPoint: delegatorKey.publicPoint,
      delegateePublicPoint: delegateeKey.publicPoint,
      feldmanCommitments,
      proxyShares,
      delegationDigest,
    };
  }

  public verifyProxyShareAgainstFeldman(
    share: ProxyKeySwitchShare,
    feldmanCommitments: readonly bigint[]
  ): boolean {
    const x = BigInt(share.proxyId);
    let expected = 1n;
    let xPow = 1n;
    for (let k = 0; k < feldmanCommitments.length; k++) {
      expected = modP(expected * modPow(feldmanCommitments[k], xPow, SAFE_PRIME));
      xPow = modQ(xPow * x);
    }
    const actual = modPow(SUBGROUP_GEN, modQ(share.shareScalar), SAFE_PRIME);
    return actual === expected && actual === share.publicVerificationPoint;
  }

  private proveDLEQ(
    base1: bigint,
    target1: bigint,
    base2: bigint,
    target2: bigint,
    scalar: bigint,
    tag: string
  ): DLEQProof {
    const w = hashToScalar('DKS_DLEQ_W', [
      tag,
      base1.toString(16),
      target1.toString(16),
      base2.toString(16),
      target2.toString(16),
    ]);
    const a1 = modPow(base1, w, SAFE_PRIME);
    const a2 = modPow(base2, w, SAFE_PRIME);
    const challenge = hashToScalar('DKS_DLEQ_E', [
      base1.toString(16),
      target1.toString(16),
      base2.toString(16),
      target2.toString(16),
      a1.toString(16),
      a2.toString(16),
    ]);
    const response = modQ(w + modQ(challenge * modQ(scalar)));
    return { a1, a2, challenge, response };
  }

  private verifyDLEQ(
    base1: bigint,
    target1: bigint,
    base2: bigint,
    target2: bigint,
    proof: DLEQProof
  ): boolean {
    const expectedE = hashToScalar('DKS_DLEQ_E', [
      base1.toString(16),
      target1.toString(16),
      base2.toString(16),
      target2.toString(16),
      proof.a1.toString(16),
      proof.a2.toString(16),
    ]);
    if (expectedE !== proof.challenge) return false;
    const lhs1 = modPow(base1, modQ(proof.response), SAFE_PRIME);
    const rhs1 = modP(proof.a1 * modPow(target1, expectedE, SAFE_PRIME));
    const lhs2 = modPow(base2, modQ(proof.response), SAFE_PRIME);
    const rhs2 = modP(proof.a2 * modPow(target2, expectedE, SAFE_PRIME));
    return lhs1 === rhs1 && lhs2 === rhs2;
  }

  public computePartialTransform(
    share: ProxyKeySwitchShare,
    ciphertext: SwitchableCiphertext,
    transformNonce: string
  ): PartialTransformCapsule {
    const transformedC1 = modPow(ciphertext.c1, modQ(share.shareScalar), SAFE_PRIME);
    const dleqProof = this.proveDLEQ(
      SUBGROUP_GEN,
      share.publicVerificationPoint,
      ciphertext.c1,
      transformedC1,
      share.shareScalar,
      `TRANSFORM:${share.proxyId}:${transformNonce}`
    );
    return {
      proxyId: share.proxyId,
      transformedC1,
      dleqProof,
    };
  }

  public verifyPartialTransform(
    publicVerificationPoint: bigint,
    ciphertext: SwitchableCiphertext,
    capsule: PartialTransformCapsule
  ): boolean {
    return this.verifyDLEQ(
      SUBGROUP_GEN,
      publicVerificationPoint,
      ciphertext.c1,
      capsule.transformedC1,
      capsule.dleqProof
    );
  }

  public combineTransforms(
    originalCiphertext: SwitchableCiphertext,
    capsules: readonly PartialTransformCapsule[],
    publicPointsByProxy: ReadonlyMap<number, bigint>
  ): SwitchedCiphertextResult {
    if (capsules.length < this.threshold) {
      return {
        isValid: false,
        switchedCiphertext: null,
        participatingProxyIds: [],
        reason: `Need at least ${this.threshold} verified proxy transforms`,
      };
    }

    const selected = capsules.slice(0, this.threshold);
    const ids = selected.map((c) => c.proxyId);
    if (new Set(ids).size !== ids.length) {
      return {
        isValid: false,
        switchedCiphertext: null,
        participatingProxyIds: [],
        reason: 'Duplicate proxy ID in transform set',
      };
    }

    let combinedC1 = 1n;
    for (const cap of selected) {
      const pubPoint = publicPointsByProxy.get(cap.proxyId);
      if (!pubPoint || !this.verifyPartialTransform(pubPoint, originalCiphertext, cap)) {
        return {
          isValid: false,
          switchedCiphertext: null,
          participatingProxyIds: [],
          reason: `Invalid Chaum-Pedersen DLEQ proof from proxy ${cap.proxyId}`,
        };
      }

      let num = 1n;
      let den = 1n;
      const xI = BigInt(cap.proxyId);
      for (const otherId of ids) {
        if (otherId === cap.proxyId) continue;
        const xJ = BigInt(otherId);
        num = modQ(num * modQ(-xJ));
        den = modQ(den * modQ(xI - xJ));
      }
      const lambda = modQ(num * modInverseQ(den));
      combinedC1 = modP(combinedC1 * modPow(cap.transformedC1, lambda, SAFE_PRIME));
    }

    return {
      isValid: true,
      switchedCiphertext: {
        c1: combinedC1,
        c2: originalCiphertext.c2,
      },
      participatingProxyIds: ids,
    };
  }
}
