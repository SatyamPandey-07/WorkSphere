/**
 * @file VerifiableProxyReencryptionProver.ts
 * @description Verifiable ElGamal Proxy Re-Encryption (PRE) Prover & Verifier with
 * Chaum-Pedersen Re-Encryption Key Authorization Proofs and Honest Proxy Transform Proofs.
 * Allows Delegator A to grant an untrusted proxy a re-encryption key rk_{A->B} = sk_B / sk_A mod q
 * so the proxy can transform ciphertexts encrypted under pk_A into ciphertexts decryptable ONLY
 * by Delegatee B without ever learning the plaintext or either party's secret key, while proving
 * every re-encryption transform was executed honestly via non-interactive DLEQ proofs.
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface PREKeyPair {
  partyId: string;
  secretKey: bigint;
  publicKey: bigint;
}

export interface PRECiphertext {
  ciphertextId: string;
  ownerId: string;
  c1: bigint;
  c2: bigint;
  level: 1 | 2; // level 1 = original, level 2 = re-encrypted
}

export interface ReEncryptionKeyBundle {
  delegationId: string;
  fromPartyId: string;
  toPartyId: string;
  fromPublicKey: bigint;
  toPublicKey: bigint;
  reEncryptionKey: bigint;
  authProof: {
    nonceFrom: bigint;
    nonceTo: bigint;
    challenge: bigint;
    response: bigint;
  };
  bundleDigest: string;
}

export interface ProxyTransformProof {
  delegationId: string;
  originalCiphertext: PRECiphertext;
  transformedCiphertext: PRECiphertext;
  u: bigint;
  v: bigint;
  challenge: bigint;
  response: bigint;
  transformDigest: string;
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
  if (r > 1n) throw new Error('Not invertible');
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
 * Verifiable Proxy Re-Encryption Engine with delegation revocation registry and batch auditing.
 */
export class VerifiableProxyReencryptionProver {
  private readonly p: bigint;
  private readonly q: bigint;
  private readonly g: bigint;
  private readonly revokedDelegations: Set<string> = new Set();

  constructor(p = SAFE_PRIME_P, q = SUBGROUP_Q, g = BASE_G) {
    if (p !== 2n * q + 1n) {
      throw new Error('Safe prime invariant p = 2q + 1 is required');
    }
    this.p = p;
    this.q = q;
    this.g = g;
  }

  public generateKeyPair(partyId: string, seedSecret?: bigint): PREKeyPair {
    const secretKey = seedSecret !== undefined
      ? modNorm(seedSecret, this.q - 2n) + 2n
      : randomScalar(this.q);
    return {
      partyId,
      secretKey,
      publicKey: modPow(this.g, secretKey, this.p),
    };
  }

  public encodeMessage(value: bigint): bigint {
    if (value < 0n || value >= this.q) throw new RangeError('Value out of subgroup range');
    return modPow(this.g, value, this.p);
  }

  public encrypt(ciphertextId: string, recipient: { partyId: string; publicKey: bigint }, messageElement: bigint): PRECiphertext {
    const r = randomScalar(this.q);
    return {
      ciphertextId,
      ownerId: recipient.partyId,
      c1: modPow(this.g, r, this.p),
      c2: (modNorm(messageElement, this.p) * modPow(recipient.publicKey, r, this.p)) % this.p,
      level: 1,
    };
  }

  /**
   * Decrypts either a level-1 original ciphertext OR a level-2 proxy re-encrypted ciphertext.
   * For level-1: c1 = g^r, c2 = m * pk_A^r = m * c1^{sk_A}.
   * For level-2: c1' = c1^{rk} = g^{r * sk_A / sk_B}, c2' = c2 = m * g^{r * sk_A} = m * (c1')^{sk_B}!
   */
  public decrypt(keyPair: PREKeyPair, ciphertext: PRECiphertext): bigint {
    const mask = modPow(ciphertext.c1, keyPair.secretKey, this.p);
    return (ciphertext.c2 * modInverse(mask, this.p)) % this.p;
  }

  /**
   * Generates a verifiable re-encryption key rk_{A -> B} = sk_A * sk_B^{-1} mod q
   * along with a zero-knowledge proof that pk_B^{rk} == pk_A mod p (honest key linkage).
   */
  public generateReEncryptionKey(
    delegationId: string,
    delegator: PREKeyPair,
    delegatee: PREKeyPair
  ): ReEncryptionKeyBundle {
    const invSkB = modInverse(delegatee.secretKey, this.q);
    const reEncryptionKey = modNorm(delegator.secretKey * invSkB, this.q);

    // Proof of knowledge of rk such that pk_B^{rk} == pk_A mod p and g^{rk} is bound
    const k = randomScalar(this.q);
    const nonceFrom = modPow(delegatee.publicKey, k, this.p);
    const nonceTo = modPow(this.g, k, this.p);
    const challenge = hashScalar('WorkSphere::PREReKeyAuth', [
      delegationId,
      delegator.partyId,
      delegatee.partyId,
      delegator.publicKey,
      delegatee.publicKey,
      nonceFrom,
      nonceTo,
    ]);
    const response = modNorm(k + challenge * reEncryptionKey, this.q);

    const bundleDigest = createHash('sha256')
      .update(`${delegationId}|${delegator.partyId}|${delegatee.partyId}|${delegator.publicKey.toString(16)}|${delegatee.publicKey.toString(16)}`)
      .digest('hex');

    return {
      delegationId,
      fromPartyId: delegator.partyId,
      toPartyId: delegatee.partyId,
      fromPublicKey: delegator.publicKey,
      toPublicKey: delegatee.publicKey,
      reEncryptionKey,
      authProof: { nonceFrom, nonceTo, challenge, response },
      bundleDigest,
    };
  }

  /**
   * Publicly verifies that a delegation key bundle correctly maps pk_B^{rk} == pk_A mod p.
   */
  public verifyReEncryptionKey(bundle: ReEncryptionKeyBundle): boolean {
    if (this.revokedDelegations.has(bundle.delegationId)) return false;
    const ap = bundle.authProof;
    const expectedC = hashScalar('WorkSphere::PREReKeyAuth', [
      bundle.delegationId,
      bundle.fromPartyId,
      bundle.toPartyId,
      bundle.fromPublicKey,
      bundle.toPublicKey,
      ap.nonceFrom,
      ap.nonceTo,
    ]);
    if (expectedC !== ap.challenge) return false;

    const lhs = modPow(bundle.toPublicKey, ap.response, this.p);
    const rhs = (ap.nonceFrom * modPow(bundle.fromPublicKey, ap.challenge, this.p)) % this.p;
    if (lhs !== rhs) return false;

    return modPow(bundle.toPublicKey, bundle.reEncryptionKey, this.p) === bundle.fromPublicKey;
  }

  public revokeDelegation(delegationId: string): void {
    this.revokedDelegations.add(delegationId);
  }

  public isDelegationRevoked(delegationId: string): boolean {
    return this.revokedDelegations.has(delegationId);
  }

  /**
   * Proxy transforms a level-1 ciphertext for Delegator A into a level-2 ciphertext for Delegatee B
   * and emits a Chaum-Pedersen DLEQ proof proving c1' = c1^{rk} and pk_A = pk_B^{rk} used the exact same rk!
   */
  public proxyReEncrypt(
    bundle: ReEncryptionKeyBundle,
    original: PRECiphertext
  ): ProxyTransformProof {
    if (this.revokedDelegations.has(bundle.delegationId)) {
      throw new Error(`Delegation ${bundle.delegationId} has been revoked`);
    }
    if (original.ownerId !== bundle.fromPartyId) {
      throw new Error('Ciphertext owner does not match delegation source party');
    }
    if (original.level !== 1) {
      throw new Error('Single-hop proxy re-encryption only accepts level-1 ciphertexts');
    }

    const newC1 = modPow(original.c1, bundle.reEncryptionKey, this.p);
    const transformedCiphertext: PRECiphertext = {
      ciphertextId: `${original.ciphertextId}:re:${bundle.toPartyId}`,
      ownerId: bundle.toPartyId,
      c1: newC1,
      c2: original.c2,
      level: 2,
    };

    // Chaum-Pedersen DLEQ: log_{pk_B}(pk_A) == log_{c1}(newC1)
    const k = randomScalar(this.q);
    const u = modPow(bundle.toPublicKey, k, this.p);
    const v = modPow(original.c1, k, this.p);
    const challenge = hashScalar('WorkSphere::PRETransformDLEQ', [
      bundle.delegationId,
      original.ciphertextId,
      bundle.toPublicKey,
      bundle.fromPublicKey,
      original.c1,
      newC1,
      u,
      v,
    ]);
    const response = modNorm(k + challenge * bundle.reEncryptionKey, this.q);

    const transformDigest = createHash('sha256')
      .update(`${bundle.delegationId}|${original.ciphertextId}|${newC1.toString(16)}|${challenge.toString(16)}`)
      .digest('hex');

    return {
      delegationId: bundle.delegationId,
      originalCiphertext: { ...original },
      transformedCiphertext,
      u,
      v,
      challenge,
      response,
      transformDigest,
    };
  }

  /**
   * Publicly verifies a proxy re-encryption transform proof WITHOUT needing the secret reEncryptionKey!
   */
  public verifyProxyTransform(
    proof: ProxyTransformProof,
    fromPublicKey: bigint,
    toPublicKey: bigint
  ): { valid: boolean; reason?: string } {
    if (this.revokedDelegations.has(proof.delegationId)) {
      return { valid: false, reason: 'Delegation is revoked' };
    }
    if (proof.transformedCiphertext.c2 !== proof.originalCiphertext.c2) {
      return { valid: false, reason: 'Payload component c2 was altered by proxy' };
    }
    if (proof.transformedCiphertext.level !== 2) {
      return { valid: false, reason: 'Transformed ciphertext must be level 2' };
    }

    const expectedC = hashScalar('WorkSphere::PRETransformDLEQ', [
      proof.delegationId,
      proof.originalCiphertext.ciphertextId,
      toPublicKey,
      fromPublicKey,
      proof.originalCiphertext.c1,
      proof.transformedCiphertext.c1,
      proof.u,
      proof.v,
    ]);
    if (expectedC !== proof.challenge) {
      return { valid: false, reason: 'Proxy transform DLEQ challenge mismatch' };
    }

    const lhsU = modPow(toPublicKey, proof.response, this.p);
    const rhsU = (proof.u * modPow(fromPublicKey, proof.challenge, this.p)) % this.p;
    if (lhsU !== rhsU) {
      return { valid: false, reason: 'Proxy transform key-linkage branch failed' };
    }

    const lhsV = modPow(proof.originalCiphertext.c1, proof.response, this.p);
    const rhsV = (proof.v * modPow(proof.transformedCiphertext.c1, proof.challenge, this.p)) % this.p;
    if (lhsV !== rhsV) {
      return { valid: false, reason: 'Proxy transform ciphertext branch failed' };
    }

    return { valid: true };
  }

  public batchVerifyTransforms(
    proofs: readonly ProxyTransformProof[],
    fromPublicKey: bigint,
    toPublicKey: bigint
  ): { allValid: boolean; validCount: number; failedIds: string[] } {
    const failedIds: string[] = [];
    for (const pr of proofs) {
      if (!this.verifyProxyTransform(pr, fromPublicKey, toPublicKey).valid) {
        failedIds.push(pr.originalCiphertext.ciphertextId);
      }
    }
    return {
      allValid: proofs.length > 0 && failedIds.length === 0,
      validCount: proofs.length - failedIds.length,
      failedIds,
    };
  }

  public serializeTransformProof(proof: ProxyTransformProof): string {
    return JSON.stringify({
      delegationId: proof.delegationId,
      originalCiphertext: {
        ...proof.originalCiphertext,
        c1: proof.originalCiphertext.c1.toString(16),
        c2: proof.originalCiphertext.c2.toString(16),
      },
      transformedCiphertext: {
        ...proof.transformedCiphertext,
        c1: proof.transformedCiphertext.c1.toString(16),
        c2: proof.transformedCiphertext.c2.toString(16),
      },
      u: proof.u.toString(16),
      v: proof.v.toString(16),
      challenge: proof.challenge.toString(16),
      response: proof.response.toString(16),
      transformDigest: proof.transformDigest,
    });
  }

  public deserializeTransformProof(payload: string): ProxyTransformProof {
    const raw = JSON.parse(payload) as Record<string, any>;
    return {
      delegationId: raw.delegationId,
      originalCiphertext: {
        ...raw.originalCiphertext,
        c1: BigInt(`0x${raw.originalCiphertext.c1}`),
        c2: BigInt(`0x${raw.originalCiphertext.c2}`),
      },
      transformedCiphertext: {
        ...raw.transformedCiphertext,
        c1: BigInt(`0x${raw.transformedCiphertext.c1}`),
        c2: BigInt(`0x${raw.transformedCiphertext.c2}`),
      },
      u: BigInt(`0x${raw.u}`),
      v: BigInt(`0x${raw.v}`),
      challenge: BigInt(`0x${raw.challenge}`),
      response: BigInt(`0x${raw.response}`),
      transformDigest: raw.transformDigest,
    };
  }
}
