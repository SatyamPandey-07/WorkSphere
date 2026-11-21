/**
 * @file ZeroKnowledgeBlindSignatureSchnorr.ts
 * @description 3-Move Interactive Blind Schnorr Signature Protocol & Unlinkability Verifier.
 * Enables an issuer to sign a user's workspace credential or anonymous pass WITHOUT seeing
 * the message m or being able to link the issuing session to the unblinded final signature:
 *   1. Signer commits to fresh nonce k -> R = g^k mod p.
 *   2. User picks random blinding scalars (alpha, beta), computes blinded nonce
 *      R' = R * g^alpha * Y^beta mod p, computes e' = H(Y || R' || m), and sends
 *      blinded challenge e = e' + beta mod q to the signer.
 *   3. Signer replies with s = k + e * sk mod q.
 *   4. User unblinds s' = s + alpha mod q -> valid standard Schnorr signature (R', s') on m!
 *   5. Includes replay/nonce-reuse guards, randomized batch verification, and JSON serialization.
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface BlindSignerKeyPair {
  issuerId: string;
  secretKey: bigint;
  publicKey: bigint;
}

export interface SignerNonceSession {
  sessionId: string;
  issuerId: string;
  nonceK: bigint;
  publicNonceR: bigint;
  consumed: boolean;
}

export interface UserBlindingState {
  sessionId: string;
  message: string;
  alpha: bigint;
  beta: bigint;
  blindedNonceRPrime: bigint;
  unblindedChallengeEPrime: bigint;
  blindedChallengeE: bigint;
}

export interface BlindSignatureResponse {
  sessionId: string;
  blindedS: bigint;
  publicNonceR: bigint;
}

export interface UnblindedSchnorrSignature {
  issuerId: string;
  message: string;
  R: bigint;
  s: bigint;
  signatureDigest: string;
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
 * Interactive 3-Move Blind Schnorr Signature Protocol & Batch Auditor.
 */
export class ZeroKnowledgeBlindSignatureSchnorr {
  private readonly p: bigint;
  private readonly q: bigint;
  private readonly g: bigint;
  private readonly activeSessions: Map<string, SignerNonceSession> = new Map();

  constructor(p = SAFE_PRIME_P, q = SUBGROUP_Q, g = BASE_G) {
    if (p !== 2n * q + 1n) {
      throw new Error('Safe prime invariant p = 2q + 1 is required');
    }
    this.p = p;
    this.q = q;
    this.g = g;
  }

  public generateIssuerKey(issuerId: string, seedSecret?: bigint): BlindSignerKeyPair {
    const secretKey = seedSecret !== undefined
      ? modNorm(seedSecret, this.q - 2n) + 2n
      : randomScalar(this.q);
    return {
      issuerId,
      secretKey,
      publicKey: modPow(this.g, secretKey, this.p),
    };
  }

  private computeChallenge(issuerPublicKey: bigint, R: bigint, message: string): bigint {
    return hashScalar('WorkSphere::BlindSchnorrE', [issuerPublicKey, R, message]);
  }

  /**
   * Move 1 (Signer): Generates a single-use nonce session (k, R = g^k mod p).
   */
  public initSignerSession(sessionId: string, issuerId: string): { sessionId: string; publicNonceR: bigint } {
    if (this.activeSessions.has(sessionId)) {
      throw new Error(`Duplicate blind signing sessionId: ${sessionId}`);
    }
    const nonceK = randomScalar(this.q);
    const publicNonceR = modPow(this.g, nonceK, this.p);
    this.activeSessions.set(sessionId, {
      sessionId,
      issuerId,
      nonceK,
      publicNonceR,
      consumed: false,
    });
    return { sessionId, publicNonceR };
  }

  /**
   * Move 2 (User): Blinds the signer's nonce R with random (alpha, beta) and computes the
   * blinded challenge e = e' + beta mod q so the signer learns nothing about `message` or R'.
   */
  public createBlindedChallenge(
    sessionId: string,
    issuerPublicKey: bigint,
    signerNonceR: bigint,
    message: string
  ): UserBlindingState {
    if (signerNonceR <= 1n || signerNonceR >= this.p || modPow(signerNonceR, this.q, this.p) !== 1n) {
      throw new Error('Signer nonce R is not a valid order-q subgroup element');
    }
    const alpha = randomScalar(this.q);
    const beta = randomScalar(this.q);

    // R' = R * g^alpha * Y^beta mod p  =>  g^(s + alpha) = g^(k + alpha) * Y^(e' + beta) = (R * g^alpha * Y^beta) * Y^(e') = R' * Y^(e')!
    const blindedNonceRPrime =
      (((signerNonceR * modPow(this.g, alpha, this.p)) % this.p) *
        modPow(issuerPublicKey, beta, this.p)) %
      this.p;

    const unblindedChallengeEPrime = this.computeChallenge(issuerPublicKey, blindedNonceRPrime, message);
    const blindedChallengeE = modNorm(unblindedChallengeEPrime + beta, this.q);

    return {
      sessionId,
      message,
      alpha,
      beta,
      blindedNonceRPrime,
      unblindedChallengeEPrime,
      blindedChallengeE,
    };
  }

  /**
   * Move 3 (Signer): Signs the blinded challenge ONCE and permanently marks the nonce session consumed
   * (prevents nonce reuse private-key extraction attacks).
   */
  public signBlindedChallenge(
    issuerKey: BlindSignerKeyPair,
    sessionId: string,
    blindedChallengeE: bigint
  ): BlindSignatureResponse {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown blind signing session: ${sessionId}`);
    }
    if (session.consumed) {
      throw new Error(`Nonce session ${sessionId} already consumed (replay/nonce-reuse blocked)`);
    }
    if (session.issuerId !== issuerKey.issuerId) {
      throw new Error('Issuer ID mismatch for session');
    }

    session.consumed = true;
    const blindedS = modNorm(session.nonceK + modNorm(blindedChallengeE, this.q) * issuerKey.secretKey, this.q);

    return {
      sessionId,
      blindedS,
      publicNonceR: session.publicNonceR,
    };
  }

  /**
   * User Finalization: Verifies signer's blinded response and unblinds (R', s' = s + alpha mod q)
   * into a standard publicly verifiable Schnorr signature unlinkable to the signing transcript.
   */
  public unblindSignature(
    issuerId: string,
    issuerPublicKey: bigint,
    userState: UserBlindingState,
    signerResponse: BlindSignatureResponse
  ): UnblindedSchnorrSignature {
    if (userState.sessionId !== signerResponse.sessionId) {
      throw new Error('Session ID mismatch during unblinding');
    }

    // Verify signer honesty before unblinding: g^s == R * Y^e mod p
    const lhsBlind = modPow(this.g, modNorm(signerResponse.blindedS, this.q), this.p);
    const rhsBlind =
      (signerResponse.publicNonceR * modPow(issuerPublicKey, userState.blindedChallengeE, this.p)) %
      this.p;
    if (lhsBlind !== rhsBlind) {
      throw new Error('Signer returned an invalid blinded signature response');
    }

    const s = modNorm(signerResponse.blindedS + userState.alpha, this.q);
    const R = userState.blindedNonceRPrime;
    const signatureDigest = createHash('sha256')
      .update(`${issuerId}|${userState.message}|${R.toString(16)}|${s.toString(16)}`)
      .digest('hex');

    return {
      issuerId,
      message: userState.message,
      R,
      s,
      signatureDigest,
    };
  }

  /**
   * Publicly verifies an unblinded Schnorr signature using only the issuer's public key.
   */
  public verifySignature(issuerPublicKey: bigint, signature: UnblindedSchnorrSignature): boolean {
    if (signature.R <= 1n || signature.R >= this.p) return false;
    const expectedDigest = createHash('sha256')
      .update(`${signature.issuerId}|${signature.message}|${signature.R.toString(16)}|${signature.s.toString(16)}`)
      .digest('hex');
    if (expectedDigest !== signature.signatureDigest) return false;

    const e = this.computeChallenge(issuerPublicKey, signature.R, signature.message);
    const lhs = modPow(this.g, modNorm(signature.s, this.q), this.p);
    const rhs = (signature.R * modPow(issuerPublicKey, e, this.p)) % this.p;
    return lhs === rhs;
  }

  /**
   * Confirms transcript unlinkability between a signer's view (R, e, s) and the final
   * unblinded signature (R', e', s').
   */
  public verifyUnlinkabilitySeparation(
    signerNonceR: bigint,
    blindedChallengeE: bigint,
    blindedS: bigint,
    unblinded: UnblindedSchnorrSignature,
    issuerPublicKey: bigint
  ): {
    signatureValid: boolean;
    nonceBlinded: boolean;
    challengeBlinded: boolean;
    responseBlinded: boolean;
  } {
    const ePrime = this.computeChallenge(issuerPublicKey, unblinded.R, unblinded.message);
    return {
      signatureValid: this.verifySignature(issuerPublicKey, unblinded),
      nonceBlinded: signerNonceR !== unblinded.R,
      challengeBlinded: blindedChallengeE !== ePrime,
      responseBlinded: blindedS !== unblinded.s,
    };
  }

  /**
   * Randomized batch verification of multiple unblinded Schnorr signatures under one issuer key.
   */
  public batchVerifySignatures(
    issuerPublicKey: bigint,
    signatures: readonly UnblindedSchnorrSignature[]
  ): boolean {
    if (signatures.length === 0) return false;
    let sumS = 0n;
    let sumE = 0n;
    let prodR = 1n;

    for (let i = 0; i < signatures.length; i++) {
      const sig = signatures[i];
      const e = this.computeChallenge(issuerPublicKey, sig.R, sig.message);
      const rho = hashScalar('WorkSphere::BlindBatchRho', [
        BigInt(i),
        issuerPublicKey,
        sig.R,
        sig.s,
        sig.message,
      ]);
      sumS = modNorm(sumS + rho * sig.s, this.q);
      sumE = modNorm(sumE + rho * e, this.q);
      prodR = (prodR * modPow(sig.R, rho, this.p)) % this.p;
    }

    return modPow(this.g, sumS, this.p) === (prodR * modPow(issuerPublicKey, sumE, this.p)) % this.p;
  }

  public serializeSignature(sig: UnblindedSchnorrSignature): string {
    return JSON.stringify({
      issuerId: sig.issuerId,
      message: sig.message,
      R: sig.R.toString(16),
      s: sig.s.toString(16),
      signatureDigest: sig.signatureDigest,
    });
  }

  public deserializeSignature(payload: string): UnblindedSchnorrSignature {
    const raw = JSON.parse(payload) as Record<string, string>;
    return {
      issuerId: raw.issuerId,
      message: raw.message,
      R: BigInt(`0x${raw.R}`),
      s: BigInt(`0x${raw.s}`),
      signatureDigest: raw.signatureDigest,
    };
  }

  /**
   * Executes an end-to-end batch of N independent blind-signed anonymous tokens and returns
   * an aggregate issuance audit summary alongside all unblinded tokens.
   */
  public issueBlindTokenBatch(
    issuerKey: BlindSignerKeyPair,
    batchPrefix: string,
    messages: readonly string[]
  ): {
    tokens: UnblindedSchnorrSignature[];
    batchVerified: boolean;
    issuanceAuditDigest: string;
  } {
    if (messages.length === 0) {
      throw new Error('At least one message is required for blind token batch issuance');
    }
    const tokens: UnblindedSchnorrSignature[] = [];
    for (let i = 0; i < messages.length; i++) {
      const sid = `${batchPrefix}:${i}`;
      const { publicNonceR } = this.initSignerSession(sid, issuerKey.issuerId);
      const userState = this.createBlindedChallenge(sid, issuerKey.publicKey, publicNonceR, messages[i]);
      const resp = this.signBlindedChallenge(issuerKey, sid, userState.blindedChallengeE);
      const sig = this.unblindSignature(issuerKey.issuerId, issuerKey.publicKey, userState, resp);
      tokens.push(sig);
    }

    const batchVerified = this.batchVerifySignatures(issuerKey.publicKey, tokens);
    const issuanceAuditDigest = createHash('sha256')
      .update(`${issuerKey.issuerId}|${batchPrefix}|${tokens.map((t) => t.signatureDigest).join('|')}`)
      .digest('hex');

    return { tokens, batchVerified, issuanceAuditDigest };
  }

  /**
   * Returns active vs consumed nonce session metrics for issuer audit telemetry.
   */
  public getSessionStats(): { totalSessions: number; consumedSessions: number; openSessions: number } {
    let consumed = 0;
    for (const s of this.activeSessions.values()) {
      if (s.consumed) consumed++;
    }
    return {
      totalSessions: this.activeSessions.size,
      consumedSessions: consumed,
      openSessions: this.activeSessions.size - consumed,
    };
  }
}
