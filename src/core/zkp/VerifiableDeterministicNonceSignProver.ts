/**
 * @file VerifiableDeterministicNonceSignProver.ts
 * @description RFC-6979-Inspired Deterministic Schnorr Multi-Key Signing, Nonce-Reuse Forensic
 * Key-Recovery Auditor, Randomized Cross-Key Batch Verification, and Portable JSON Serialization.
 * Eliminates catastrophic RNG nonce-reuse vulnerabilities by deriving per-message nonces via
 * HMAC-SHA256(secretKey || domain || message), while also providing a forensic security auditor
 * that detects repeated R values across distinct messages and demonstrates private-key exposure!
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface DeterministicKeyPair {
  keyId: string;
  secretKey: bigint;
  publicKey: bigint;
}

export interface DeterministicSchnorrSignature {
  keyId: string;
  publicKey: bigint;
  domainContext: string;
  message: string;
  R: bigint;
  s: bigint;
  sigDigest: string;
}

export interface NonceReuseForensicReport {
  reuseDetected: boolean;
  collidingPairs: Array<{
    publicKey: bigint;
    sharedR: bigint;
    messageA: string;
    messageB: string;
    recoveredSecretKey: bigint;
  }>;
  auditDigest: string;
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
 * Deterministic RFC-6979-Style Schnorr Signer & Nonce-Reuse Forensic Security Auditor.
 */
export class VerifiableDeterministicNonceSignProver {
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

  public generateKeyPair(keyId: string, seedSecret?: bigint): DeterministicKeyPair {
    const secretKey = seedSecret !== undefined
      ? modNorm(seedSecret, this.q - 2n) + 2n
      : randomScalar(this.q);
    return {
      keyId,
      secretKey,
      publicKey: modPow(this.g, secretKey, this.p),
    };
  }

  /**
   * Derives a deterministic RFC-6979-style nonce k via multi-round HMAC-SHA256 keyed by secretKey.
   */
  public deriveDeterministicNonce(
    secretKey: bigint,
    domainContext: string,
    message: string,
    extraEntropyHex = ''
  ): bigint {
    const skHex = secretKey.toString(16).padStart(32, '0');
    const msgHash = createHash('sha256').update(`${domainContext}|${message}`).digest('hex');

    let kState = Buffer.alloc(32, 0x00);
    let vState = Buffer.alloc(32, 0x01);

    const seed = Buffer.from(`${skHex}|${msgHash}|${extraEntropyHex}`, 'utf8');
    kState = createHmac('sha256', kState).update(vState).update(Buffer.from([0x00])).update(seed).digest();
    vState = createHmac('sha256', kState).update(vState).digest();
    kState = createHmac('sha256', kState).update(vState).update(Buffer.from([0x01])).update(seed).digest();
    vState = createHmac('sha256', kState).update(vState).digest();

    for (let attempt = 0; attempt < 64; attempt++) {
      vState = createHmac('sha256', kState).update(vState).digest();
      const cand = BigInt(`0x${vState.toString('hex')}`) % this.q;
      if (cand > 1n && cand < this.q - 1n) return cand;
      kState = createHmac('sha256', kState).update(vState).update(Buffer.from([0x00])).digest();
      vState = createHmac('sha256', kState).update(vState).digest();
    }
    throw new Error('Failed to derive deterministic nonce');
  }

  private computeChallenge(publicKey: bigint, R: bigint, domainContext: string, message: string): bigint {
    return hashScalar('WorkSphere::DetSchnorrE', [publicKey, R, domainContext, message]);
  }

  /**
   * Produces a completely deterministic Schnorr signature (identical inputs always produce the exact
   * same signature; distinct messages produce cryptographically independent nonces).
   */
  public signDeterministic(
    keyPair: DeterministicKeyPair,
    message: string,
    domainContext = 'worksphere-default'
  ): DeterministicSchnorrSignature {
    const k = this.deriveDeterministicNonce(keyPair.secretKey, domainContext, message);
    return this.signWithExplicitNonce(keyPair, message, domainContext, k);
  }

  /**
   * Signs using an explicit nonce (exposed for forensic nonce-reuse testing and audit simulations).
   */
  public signWithExplicitNonce(
    keyPair: DeterministicKeyPair,
    message: string,
    domainContext: string,
    nonceK: bigint
  ): DeterministicSchnorrSignature {
    const k = modNorm(nonceK, this.q);
    if (k === 0n) throw new RangeError('Nonce k cannot be zero');

    const R = modPow(this.g, k, this.p);
    const e = this.computeChallenge(keyPair.publicKey, R, domainContext, message);
    const s = modNorm(k + e * keyPair.secretKey, this.q);
    const sigDigest = createHash('sha256')
      .update(`${keyPair.keyId}|${domainContext}|${message}|${R.toString(16)}|${s.toString(16)}`)
      .digest('hex');

    return {
      keyId: keyPair.keyId,
      publicKey: keyPair.publicKey,
      domainContext,
      message,
      R,
      s,
      sigDigest,
    };
  }

  public verifySignature(sig: DeterministicSchnorrSignature): boolean {
    if (sig.R <= 1n || sig.R >= this.p) return false;
    const expectedDigest = createHash('sha256')
      .update(`${sig.keyId}|${sig.domainContext}|${sig.message}|${sig.R.toString(16)}|${sig.s.toString(16)}`)
      .digest('hex');
    if (expectedDigest !== sig.sigDigest) return false;

    const e = this.computeChallenge(sig.publicKey, sig.R, sig.domainContext, sig.message);
    const lhs = modPow(this.g, modNorm(sig.s, this.q), this.p);
    const rhs = (sig.R * modPow(sig.publicKey, e, this.p)) % this.p;
    return lhs === rhs;
  }

  /**
   * Randomized cross-key batch verification checking N signatures from arbitrary signers in one check:
   *   g^(Sum rho_i * s_i) == Prod (R_i * pk_i^{e_i})^{rho_i} mod p.
   */
  public batchVerifyCrossKey(signatures: readonly DeterministicSchnorrSignature[]): boolean {
    if (signatures.length === 0) return false;
    let totalS = 0n;
    let rhsProd = 1n;

    for (let i = 0; i < signatures.length; i++) {
      const sig = signatures[i];
      const e = this.computeChallenge(sig.publicKey, sig.R, sig.domainContext, sig.message);
      const rho = hashScalar('WorkSphere::DetBatchRho', [
        BigInt(i),
        sig.publicKey,
        sig.R,
        sig.s,
        sig.message,
      ]);
      totalS = modNorm(totalS + rho * sig.s, this.q);
      const term = (sig.R * modPow(sig.publicKey, e, this.p)) % this.p;
      rhsProd = (rhsProd * modPow(term, rho, this.p)) % this.p;
    }

    return modPow(this.g, totalS, this.p) === rhsProd;
  }

  /**
   * Forensic Nonce-Reuse Detector: scans a log of signatures for any (publicKey, R) collision
   * across distinct messages and mathematically recovers the leaked secret key sk = (s1 - s2) / (e1 - e2)!
   */
  public auditNonceReuse(signatures: readonly DeterministicSchnorrSignature[]): NonceReuseForensicReport {
    const seen = new Map<string, DeterministicSchnorrSignature>();
    const collidingPairs: NonceReuseForensicReport['collidingPairs'] = [];

    for (const sig of signatures) {
      if (!this.verifySignature(sig)) continue;
      const bucketKey = `${sig.publicKey.toString(16)}:${sig.R.toString(16)}`;
      const prev = seen.get(bucketKey);
      if (!prev) {
        seen.set(bucketKey, sig);
        continue;
      }
      if (prev.message !== sig.message || prev.domainContext !== sig.domainContext) {
        const e1 = this.computeChallenge(prev.publicKey, prev.R, prev.domainContext, prev.message);
        const e2 = this.computeChallenge(sig.publicKey, sig.R, sig.domainContext, sig.message);
        const deltaE = modNorm(e1 - e2, this.q);
        if (deltaE !== 0n) {
          const deltaS = modNorm(prev.s - sig.s, this.q);
          const recoveredSecretKey = modNorm(deltaS * modInverse(deltaE, this.q), this.q);
          if (modPow(this.g, recoveredSecretKey, this.p) === sig.publicKey) {
            collidingPairs.push({
              publicKey: sig.publicKey,
              sharedR: sig.R,
              messageA: prev.message,
              messageB: sig.message,
              recoveredSecretKey,
            });
          }
        }
      }
    }

    const auditDigest = createHash('sha256')
      .update(`WorkSphere::NonceAudit|n:${signatures.length}|leaks:${collidingPairs.length}`)
      .digest('hex');

    return {
      reuseDetected: collidingPairs.length > 0,
      collidingPairs,
      auditDigest,
    };
  }

  public serializeSignature(sig: DeterministicSchnorrSignature): string {
    return JSON.stringify({
      keyId: sig.keyId,
      publicKey: sig.publicKey.toString(16),
      domainContext: sig.domainContext,
      message: sig.message,
      R: sig.R.toString(16),
      s: sig.s.toString(16),
      sigDigest: sig.sigDigest,
    });
  }

  public deserializeSignature(payload: string): DeterministicSchnorrSignature {
    const raw = JSON.parse(payload) as Record<string, string>;
    return {
      keyId: raw.keyId,
      publicKey: BigInt(`0x${raw.publicKey}`),
      domainContext: raw.domainContext,
      message: raw.message,
      R: BigInt(`0x${raw.R}`),
      s: BigInt(`0x${raw.s}`),
      sigDigest: raw.sigDigest,
    };
  }

  /**
   * Produces a linked chain of deterministic signed audit events where each event's domain
   * commits to the previous signature digest, ensuring tamper-evident signing history.
   */
  public signAuditEventChain(
    keyPair: DeterministicKeyPair,
    genesisTag: string,
    events: readonly string[]
  ): Array<{ index: number; event: string; previousDigest: string; signature: DeterministicSchnorrSignature }> {
    if (events.length === 0) throw new Error('At least one audit event is required');
    const chain: Array<{
      index: number;
      event: string;
      previousDigest: string;
      signature: DeterministicSchnorrSignature;
    }> = [];
    let prevDigest = createHash('sha256').update(`WorkSphere::DetChain|${genesisTag}`).digest('hex');

    for (let i = 0; i < events.length; i++) {
      const domain = `chain:${genesisTag}:${i}:${prevDigest}`;
      const signature = this.signDeterministic(keyPair, events[i], domain);
      chain.push({ index: i, event: events[i], previousDigest: prevDigest, signature });
      prevDigest = signature.sigDigest;
    }
    return chain;
  }

  /**
   * Verifies every link and signature in a deterministic signed audit event chain.
   */
  public verifyAuditEventChain(
    expectedPublicKey: bigint,
    genesisTag: string,
    chain: ReadonlyArray<{
      index: number;
      event: string;
      previousDigest: string;
      signature: DeterministicSchnorrSignature;
    }>
  ): { valid: boolean; brokenIndex?: number; reason?: string } {
    if (chain.length === 0) return { valid: false, reason: 'Empty event chain' };
    let expectedPrev = createHash('sha256').update(`WorkSphere::DetChain|${genesisTag}`).digest('hex');

    for (let i = 0; i < chain.length; i++) {
      const item = chain[i];
      if (item.index !== i || item.previousDigest !== expectedPrev) {
        return { valid: false, brokenIndex: i, reason: 'Broken chain link digest' };
      }
      const expectedDomain = `chain:${genesisTag}:${i}:${expectedPrev}`;
      if (
        item.signature.publicKey !== expectedPublicKey ||
        item.signature.domainContext !== expectedDomain ||
        item.signature.message !== item.event ||
        !this.verifySignature(item.signature)
      ) {
        return { valid: false, brokenIndex: i, reason: 'Signature verification failed on chain link' };
      }
      expectedPrev = item.signature.sigDigest;
    }
    return { valid: true };
  }
}
