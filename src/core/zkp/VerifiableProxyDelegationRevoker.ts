import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Epoch-Revocable Proxy Re-Encryption (PRE) Delegation Engine.
 *
 * Implements unidirectional Blaze-Bleumer-Strauss / Umbral-style Proxy Re-Encryption
 * augmented with epoch-scoped revocation & Chaum-Pedersen DLEQ honesty proofs:
 *  - Delegator Alice holds master secret key a (pk_A = g^a) and derives per-epoch key
 *    a_ep = (a + H_scalar(epochId)) mod Q with public key Y_{A,ep} = pk_A * g^{H_scalar(epochId)}.
 *  - To grant delegatee Bob (pk_B = g^b) temporary access for epochId, Alice issues a
 *    re-encryption key rk_{A->B,ep} = b / a_ep mod Q (computed interactively or via shared
 *    ephemeral key) along with a Schnorr authorization certificate signed by pk_A!
 *  - Semi-trusted proxy transforms ciphertext (c1, c2) = (Y_{A,ep}^r, g^m * g^r) into
 *    (c1' = c1^{rk} = Y_B^r, c2) WITHOUT learning plaintext m, and attaches a Chaum-Pedersen
 *    DLEQ proof proving honest re-encryption!
 *  - Alice can revoke Bob at any time by revoking (delegateeId, epochId) or advancing epoch!
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

export interface PREKeyPair {
  userId: string;
  secretKey: bigint;
  publicKey: bigint;
}

export interface EpochCiphertext {
  epochId: string;
  ownerId: string;
  c1: bigint; // Y_{owner,epoch}^r
  c2: bigint; // g^r * g^m
}

export interface ReEncryptionKeyGrant {
  grantId: string;
  ownerId: string;
  ownerPubKey: bigint;
  delegateeId: string;
  delegateePubKey: bigint;
  epochId: string;
  reKeyScalar: bigint;      // b * a_ep^{-1} mod Q
  reKeyCommitment: bigint;  // g^{reKeyScalar}
  ownerSigR: bigint;
  ownerSigS: bigint;
}

export interface ReEncryptedCapsule {
  grantId: string;
  epochId: string;
  originalC1: bigint;
  transformedC1: bigint; // c1^{reKeyScalar} = Y_B^r
  c2: bigint;
  dleqA: bigint;
  dleqB: bigint;
  challenge: bigint;
  responseReKey: bigint;
}

export class VerifiableProxyDelegationRevoker {
  private revokedGrants = new Set<string>();

  public generateKeyPair(userId: string, secret?: bigint): PREKeyPair {
    const secretKey = secret !== undefined ? modScalar(secret) : randomScalar();
    if (secretKey === 0n) throw new Error('Secret key must be non-zero');
    return { userId, secretKey, publicKey: modPow(BASE_G, secretKey, SAFE_PRIME_P) };
  }

  public deriveEpochOffset(ownerId: string, epochId: string): bigint {
    return hashToScalar('PRE-EPOCH-OFFSET-V1', ownerId, epochId);
  }

  public deriveEpochPublicKey(ownerId: string, ownerPubKey: bigint, epochId: string): bigint {
    const offset = this.deriveEpochOffset(ownerId, epochId);
    return (ownerPubKey * modPow(BASE_G, offset, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  public encryptForEpoch(ownerId: string, ownerPubKey: bigint, epochId: string, messageVal: bigint): EpochCiphertext {
    if (messageVal < 0n) throw new RangeError('Message value must be non-negative');
    const r = randomScalar();
    const epochPub = this.deriveEpochPublicKey(ownerId, ownerPubKey, epochId);
    return {
      epochId,
      ownerId,
      c1: modPow(epochPub, r, SAFE_PRIME_P),
      c2: (modPow(BASE_G, r, SAFE_PRIME_P) * modPow(BASE_G, modScalar(messageVal), SAFE_PRIME_P)) % SAFE_PRIME_P,
    };
  }

  public decryptAsOwner(owner: PREKeyPair, ct: EpochCiphertext, maxMsg = 5000n): bigint | null {
    const aEp = modScalar(owner.secretKey + this.deriveEpochOffset(owner.userId, ct.epochId));
    const invAEp = modInv(aEp, SUBGROUP_Q);
    const gR = modPow(ct.c1, invAEp, SAFE_PRIME_P);
    const gM = (ct.c2 * modPow(gR, SAFE_PRIME_P - 2n, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return this.resolveSmallDlog(gM, maxMsg);
  }

  private resolveSmallDlog(gM: bigint, maxMsg: bigint): bigint | null {
    let cur = 1n;
    for (let m = 0n; m <= maxMsg; m++) {
      if (cur === gM) return m;
      cur = (cur * BASE_G) % SAFE_PRIME_P;
    }
    return null;
  }

  public issueReEncryptionGrant(
    grantId: string,
    owner: PREKeyPair,
    delegatee: PREKeyPair,
    epochId: string,
  ): ReEncryptionKeyGrant {
    const aEp = modScalar(owner.secretKey + this.deriveEpochOffset(owner.userId, epochId));
    const reKeyScalar = modScalar(delegatee.secretKey * modInv(aEp, SUBGROUP_Q));
    const reKeyCommitment = modPow(BASE_G, reKeyScalar, SAFE_PRIME_P);

    const msg = sha256Hex(
      'PRE-GRANT-V1',
      grantId,
      owner.userId,
      delegatee.userId,
      epochId,
      delegatee.publicKey.toString(16),
      reKeyCommitment.toString(16),
    );
    const k = randomScalar();
    const ownerSigR = modPow(BASE_G, k, SAFE_PRIME_P);
    const c = hashToScalar('PRE-GRANT-SIG-V1', ownerSigR.toString(16), owner.publicKey.toString(16), msg);
    const ownerSigS = modScalar(k + c * owner.secretKey);

    return {
      grantId,
      ownerId: owner.userId,
      ownerPubKey: owner.publicKey,
      delegateeId: delegatee.userId,
      delegateePubKey: delegatee.publicKey,
      epochId,
      reKeyScalar,
      reKeyCommitment,
      ownerSigR,
      ownerSigS,
    };
  }

  public verifyGrant(grant: ReEncryptionKeyGrant): boolean {
    if (this.revokedGrants.has(grant.grantId)) return false;
    const epochPub = this.deriveEpochPublicKey(grant.ownerId, grant.ownerPubKey, grant.epochId);
    // Algebraically verify epochPub^{reKeyScalar} == delegateePubKey and g^{reKeyScalar} == reKeyCommitment
    if (modPow(BASE_G, grant.reKeyScalar, SAFE_PRIME_P) !== grant.reKeyCommitment) return false;
    if (modPow(epochPub, grant.reKeyScalar, SAFE_PRIME_P) !== grant.delegateePubKey) return false;

    const msg = sha256Hex(
      'PRE-GRANT-V1',
      grant.grantId,
      grant.ownerId,
      grant.delegateeId,
      grant.epochId,
      grant.delegateePubKey.toString(16),
      grant.reKeyCommitment.toString(16),
    );
    const c = hashToScalar('PRE-GRANT-SIG-V1', grant.ownerSigR.toString(16), grant.ownerPubKey.toString(16), msg);
    return modPow(BASE_G, grant.ownerSigS, SAFE_PRIME_P) === (grant.ownerSigR * modPow(grant.ownerPubKey, c, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  public revokeGrant(grantId: string): void {
    this.revokedGrants.add(grantId);
  }

  public isGrantRevoked(grantId: string): boolean {
    return this.revokedGrants.has(grantId);
  }

  public proxyReEncrypt(grant: ReEncryptionKeyGrant, ct: EpochCiphertext): ReEncryptedCapsule {
    if (this.revokedGrants.has(grant.grantId)) {
      throw new Error(`Re-encryption grant "${grant.grantId}" has been revoked`);
    }
    if (ct.epochId !== grant.epochId || ct.ownerId !== grant.ownerId) {
      throw new Error('Ciphertext owner/epoch does not match delegation grant');
    }
    if (!this.verifyGrant(grant)) {
      throw new Error('Cannot re-encrypt with invalid delegation grant');
    }

    const transformedC1 = modPow(ct.c1, grant.reKeyScalar, SAFE_PRIME_P);
    const k = randomScalar();
    const dleqA = modPow(BASE_G, k, SAFE_PRIME_P);
    const dleqB = modPow(ct.c1, k, SAFE_PRIME_P);
    const challenge = hashToScalar(
      'PRE-REENC-DLEQ-V1',
      grant.grantId,
      grant.epochId,
      grant.reKeyCommitment.toString(16),
      ct.c1.toString(16),
      transformedC1.toString(16),
      dleqA.toString(16),
      dleqB.toString(16),
    );
    const responseReKey = modScalar(k + challenge * grant.reKeyScalar);

    return {
      grantId: grant.grantId,
      epochId: grant.epochId,
      originalC1: ct.c1,
      transformedC1,
      c2: ct.c2,
      dleqA,
      dleqB,
      challenge,
      responseReKey,
    };
  }

  public verifyReEncryptedCapsule(grant: ReEncryptionKeyGrant, capsule: ReEncryptedCapsule): boolean {
    if (this.revokedGrants.has(grant.grantId) || capsule.grantId !== grant.grantId || capsule.epochId !== grant.epochId) {
      return false;
    }
    if (!this.verifyGrant(grant)) return false;

    const expectedC = hashToScalar(
      'PRE-REENC-DLEQ-V1',
      capsule.grantId,
      capsule.epochId,
      grant.reKeyCommitment.toString(16),
      capsule.originalC1.toString(16),
      capsule.transformedC1.toString(16),
      capsule.dleqA.toString(16),
      capsule.dleqB.toString(16),
    );
    if (expectedC !== capsule.challenge) return false;

    const eq1 = modPow(BASE_G, capsule.responseReKey, SAFE_PRIME_P) ===
      (capsule.dleqA * modPow(grant.reKeyCommitment, capsule.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const eq2 = modPow(capsule.originalC1, capsule.responseReKey, SAFE_PRIME_P) ===
      (capsule.dleqB * modPow(capsule.transformedC1, capsule.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return eq1 && eq2;
  }

  public decryptAsDelegatee(
    delegatee: PREKeyPair,
    grant: ReEncryptionKeyGrant,
    capsule: ReEncryptedCapsule,
    maxMsg = 5000n,
  ): bigint | null {
    if (!this.verifyReEncryptedCapsule(grant, capsule)) return null;
    if (delegatee.publicKey !== grant.delegateePubKey) return null;
    const invB = modInv(delegatee.secretKey, SUBGROUP_Q);
    const gR = modPow(capsule.transformedC1, invB, SAFE_PRIME_P);
    const gM = (capsule.c2 * modPow(gR, SAFE_PRIME_P - 2n, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return this.resolveSmallDlog(gM, maxMsg);
  }

  public serializeCapsule(capsule: ReEncryptedCapsule): string {
    return JSON.stringify({
      grantId: capsule.grantId,
      epochId: capsule.epochId,
      transformedC1: capsule.transformedC1.toString(16),
    });
  }
}
