/**
 * @file VerifiableThresholdSchnorrMuSig2.ts
 * @description Two-Round MuSig2 Multi-Signature Protocol with Rogue-Key Resistant Key Aggregation,
 * Dual-Nonce Commitment Binding, Partial Signature Fault Localization, Batch Verification,
 * and Portable JSON Serialization.
 * Defends against rogue-key attacks via key-aggregation coefficients a_i = H(L || pk_i) where
 * L = H(pk_1 || ... || pk_n), yielding aggregated public key X_agg = Prod pk_i^{a_i} mod p.
 * Defends against Wagner's k-sum attack via MuSig2 dual-nonce linear combination R = R1 * R2^b.
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface MuSig2KeyPair {
  signerId: string;
  secretKey: bigint;
  publicKey: bigint;
}

export interface MuSig2AggregatedKey {
  keyListHash: string;
  orderedPublicKeys: bigint[];
  coefficients: Map<bigint, bigint>;
  aggregatedPublicKey: bigint;
}

export interface MuSig2NonceState {
  sessionId: string;
  signerId: string;
  secretR1: bigint;
  secretR2: bigint;
  publicR1: bigint;
  publicR2: bigint;
}

export interface MuSig2AggregatedNonce {
  sessionId: string;
  aggR1: bigint;
  aggR2: bigint;
  bindingFactorB: bigint;
  effectiveR: bigint;
}

export interface MuSig2PartialSignature {
  sessionId: string;
  signerId: string;
  publicKey: bigint;
  publicR1: bigint;
  publicR2: bigint;
  partialS: bigint;
}

export interface MuSig2FinalSignature {
  sessionId: string;
  message: string;
  aggregatedPublicKey: bigint;
  R: bigint;
  s: bigint;
  signerCount: number;
  sigDigest: string;
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
 * Two-Round MuSig2 Multi-Signature Protocol Engine.
 */
export class VerifiableThresholdSchnorrMuSig2 {
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

  public generateSignerKey(signerId: string, seedSecret?: bigint): MuSig2KeyPair {
    const secretKey = seedSecret !== undefined
      ? modNorm(seedSecret, this.q - 2n) + 2n
      : randomScalar(this.q);
    return {
      signerId,
      secretKey,
      publicKey: modPow(this.g, secretKey, this.p),
    };
  }

  /**
   * Computes rogue-key-resistant MuSig2 key aggregation X_agg = Prod pk_i^{H(L || pk_i)} mod p.
   */
  public aggregatePublicKeys(publicKeys: readonly bigint[]): MuSig2AggregatedKey {
    if (publicKeys.length === 0) {
      throw new Error('At least one public key is required for MuSig2 aggregation');
    }
    const orderedPublicKeys = [...publicKeys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const h = createHash('sha256');
    h.update('WorkSphere::MuSig2KeyList');
    for (const pk of orderedPublicKeys) {
      h.update('|');
      h.update(pk.toString(16));
    }
    const keyListHash = h.digest('hex');

    const coefficients = new Map<bigint, bigint>();
    let aggregatedPublicKey = 1n;
    for (const pk of orderedPublicKeys) {
      const coeff = hashScalar('WorkSphere::MuSig2KeyAggCoeff', [keyListHash, pk]);
      coefficients.set(pk, coeff);
      aggregatedPublicKey = (aggregatedPublicKey * modPow(pk, coeff, this.p)) % this.p;
    }

    return {
      keyListHash,
      orderedPublicKeys,
      coefficients,
      aggregatedPublicKey,
    };
  }

  /**
   * Round 1: Each co-signer generates a fresh dual-nonce pair (r1, r2) and publishes (R1, R2).
   */
  public generateNoncePair(sessionId: string, signerId: string): MuSig2NonceState {
    const secretR1 = randomScalar(this.q);
    const secretR2 = randomScalar(this.q);
    return {
      sessionId,
      signerId,
      secretR1,
      secretR2,
      publicR1: modPow(this.g, secretR1, this.p),
      publicR2: modPow(this.g, secretR2, this.p),
    };
  }

  /**
   * Aggregates all co-signers' public nonces (R1_i, R2_i) and derives the MuSig2 binding factor b
   * bound to (X_agg, aggR1, aggR2, message), yielding effective nonce R = aggR1 * aggR2^b mod p.
   */
  public aggregateNonces(
    sessionId: string,
    aggKey: MuSig2AggregatedKey,
    message: string,
    publicNonces: ReadonlyArray<{ publicR1: bigint; publicR2: bigint }>
  ): MuSig2AggregatedNonce {
    if (publicNonces.length !== aggKey.orderedPublicKeys.length) {
      throw new Error('Nonce count must match aggregated signer count');
    }

    let aggR1 = 1n;
    let aggR2 = 1n;
    for (const n of publicNonces) {
      aggR1 = (aggR1 * n.publicR1) % this.p;
      aggR2 = (aggR2 * n.publicR2) % this.p;
    }

    const bindingFactorB = hashScalar('WorkSphere::MuSig2NonceBind', [
      sessionId,
      aggKey.aggregatedPublicKey,
      aggR1,
      aggR2,
      message,
    ]);
    const effectiveR = (aggR1 * modPow(aggR2, bindingFactorB, this.p)) % this.p;

    return {
      sessionId,
      aggR1,
      aggR2,
      bindingFactorB,
      effectiveR,
    };
  }

  private computeSignatureChallenge(aggPublicKey: bigint, effectiveR: bigint, message: string): bigint {
    return hashScalar('WorkSphere::MuSig2Challenge', [aggPublicKey, effectiveR, message]);
  }

  /**
   * Round 2: Each co-signer computes partial signature s_i = r1_i + b*r2_i + e * a_i * sk_i mod q.
   */
  public signPartial(
    signer: MuSig2KeyPair,
    nonceState: MuSig2NonceState,
    aggKey: MuSig2AggregatedKey,
    aggNonce: MuSig2AggregatedNonce,
    message: string
  ): MuSig2PartialSignature {
    const coeff = aggKey.coefficients.get(signer.publicKey);
    if (coeff === undefined) {
      throw new Error(`Signer ${signer.signerId} public key not present in aggregated key`);
    }
    const e = this.computeSignatureChallenge(aggKey.aggregatedPublicKey, aggNonce.effectiveR, message);
    const effectiveSecretNonce = modNorm(
      nonceState.secretR1 + aggNonce.bindingFactorB * nonceState.secretR2,
      this.q
    );
    const partialS = modNorm(
      effectiveSecretNonce + e * modNorm(coeff * signer.secretKey, this.q),
      this.q
    );

    return {
      sessionId: aggNonce.sessionId,
      signerId: signer.signerId,
      publicKey: signer.publicKey,
      publicR1: nonceState.publicR1,
      publicR2: nonceState.publicR2,
      partialS,
    };
  }

  /**
   * Verifies an individual MuSig2 partial signature to pinpoint malicious co-signers.
   */
  public verifyPartialSignature(
    partial: MuSig2PartialSignature,
    aggKey: MuSig2AggregatedKey,
    aggNonce: MuSig2AggregatedNonce,
    message: string
  ): boolean {
    const coeff = aggKey.coefficients.get(partial.publicKey);
    if (coeff === undefined) return false;
    const e = this.computeSignatureChallenge(aggKey.aggregatedPublicKey, aggNonce.effectiveR, message);
    const effectiveRi = (partial.publicR1 * modPow(partial.publicR2, aggNonce.bindingFactorB, this.p)) % this.p;

    const lhs = modPow(this.g, modNorm(partial.partialS, this.q), this.p);
    const rhs = (effectiveRi * modPow(partial.publicKey, modNorm(e * coeff, this.q), this.p)) % this.p;
    return lhs === rhs;
  }

  /**
   * Audits all co-signer partial signatures and aggregates them into one constant-size Schnorr signature.
   */
  public aggregatePartialSignatures(
    aggKey: MuSig2AggregatedKey,
    aggNonce: MuSig2AggregatedNonce,
    message: string,
    partials: readonly MuSig2PartialSignature[]
  ): {
    signature?: MuSig2FinalSignature;
    faultySigners: string[];
  } {
    const faultySigners: string[] = [];
    let s = 0n;

    for (const part of partials) {
      if (!this.verifyPartialSignature(part, aggKey, aggNonce, message)) {
        faultySigners.push(part.signerId);
        continue;
      }
      s = modNorm(s + part.partialS, this.q);
    }

    if (faultySigners.length > 0 || partials.length !== aggKey.orderedPublicKeys.length) {
      return { faultySigners };
    }

    const sigDigest = createHash('sha256')
      .update(`${aggNonce.sessionId}|${message}|${aggNonce.effectiveR.toString(16)}|${s.toString(16)}`)
      .digest('hex');

    return {
      signature: {
        sessionId: aggNonce.sessionId,
        message,
        aggregatedPublicKey: aggKey.aggregatedPublicKey,
        R: aggNonce.effectiveR,
        s,
        signerCount: partials.length,
        sigDigest,
      },
      faultySigners: [],
    };
  }

  /**
   * Verifies the final constant-size MuSig2 signature using ONLY the single aggregated public key.
   */
  public verifyFinalSignature(sig: MuSig2FinalSignature): boolean {
    const e = this.computeSignatureChallenge(sig.aggregatedPublicKey, sig.R, sig.message);
    const lhs = modPow(this.g, modNorm(sig.s, this.q), this.p);
    const rhs = (sig.R * modPow(sig.aggregatedPublicKey, e, this.p)) % this.p;
    return lhs === rhs;
  }

  public batchVerifySignatures(sigs: readonly MuSig2FinalSignature[]): boolean {
    if (sigs.length === 0) return false;
    let sumS = 0n;
    let rhsProd = 1n;
    for (let i = 0; i < sigs.length; i++) {
      const sig = sigs[i];
      const e = this.computeSignatureChallenge(sig.aggregatedPublicKey, sig.R, sig.message);
      const rho = hashScalar('WorkSphere::MuSig2BatchRho', [BigInt(i), sig.R, sig.s, sig.message]);
      sumS = modNorm(sumS + rho * sig.s, this.q);
      const term = (sig.R * modPow(sig.aggregatedPublicKey, e, this.p)) % this.p;
      rhsProd = (rhsProd * modPow(term, rho, this.p)) % this.p;
    }
    return modPow(this.g, sumS, this.p) === rhsProd;
  }

  public serializeSignature(sig: MuSig2FinalSignature): string {
    return JSON.stringify({
      sessionId: sig.sessionId,
      message: sig.message,
      aggregatedPublicKey: sig.aggregatedPublicKey.toString(16),
      R: sig.R.toString(16),
      s: sig.s.toString(16),
      signerCount: sig.signerCount,
      sigDigest: sig.sigDigest,
    });
  }

  public deserializeSignature(payload: string): MuSig2FinalSignature {
    const raw = JSON.parse(payload) as Record<string, any>;
    return {
      sessionId: raw.sessionId,
      message: raw.message,
      aggregatedPublicKey: BigInt(`0x${raw.aggregatedPublicKey}`),
      R: BigInt(`0x${raw.R}`),
      s: BigInt(`0x${raw.s}`),
      signerCount: Number(raw.signerCount),
      sigDigest: raw.sigDigest,
    };
  }
}
