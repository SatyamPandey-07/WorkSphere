/**
 * @file VerifiableRSAUnlinkableBlindToken.ts
 * @description Chaum Blind RSA Unlinkable Access-Token Issuer & Double-Spend Nullifier Registry.
 * Implements RFC-9474-style Blind RSA privacy-preserving tokens:
 *   1. User picks a random token nonce `tokenId`, computes message hash m = H(tokenId), blinds
 *      m_blind = m * r^e mod N, and sends m_blind to Issuer.
 *   2. Issuer signs s_blind = (m_blind)^d mod N without ever seeing `tokenId` or m!
 *   3. User unblinds s = s_blind * r^{-1} mod N -> valid RSA signature s^e == H(tokenId) mod N!
 *   4. Redemption verifies s^e == H(tokenId) mod N AND records nullifier = H(tokenId) to block
 *      double-spending while preserving 100% issuance-to-redemption unlinkability!
 */

import { createHash, randomBytes } from 'node:crypto';

const BLIND_RSA_SEED_P = 0x00d7c5b3a19f8d7b69574533210f1d2b3n;
const BLIND_RSA_SEED_Q = 0x00f5e3d1bfa9978573614f3d2b1907f57n;
const PUBLIC_EXP_E = 65537n;

export interface BlindRSAIssuerKeyPair {
  issuerId: string;
  modulusN: bigint;
  publicE: bigint;
  privateD: bigint;
  keyFingerprint: string;
}

export interface BlindedTokenRequest {
  requestId: string;
  tokenId: string;
  blindingR: bigint;
  blindedDigest: bigint;
}

export interface UnblindedAccessToken {
  issuerId: string;
  tokenId: string;
  signatureS: bigint;
  nullifierHex: string;
}

export interface TokenRedemptionVerdict {
  accepted: boolean;
  nullifierHex: string;
  reason?: string;
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

function extendedGcd(a: bigint, b: bigint): { gcd: bigint; x: bigint; y: bigint } {
  let oldR = a, r = b;
  let oldS = 1n, s = 0n;
  let oldT = 0n, t = 1n;
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
    [oldT, t] = [t, oldT - q * t];
  }
  return { gcd: oldR, x: oldS, y: oldT };
}

function modInverse(a: bigint, m: bigint): bigint {
  const { gcd, x } = extendedGcd(modNorm(a, m), m);
  if (gcd !== 1n) throw new Error('Not invertible');
  return modNorm(x, m);
}

function isProbablePrime(n: bigint): boolean {
  if (n < 2n) return false;
  for (const p of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n]) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  let d = n - 1n;
  let s = 0n;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    s += 1n;
  }
  for (const a of [2n, 3n, 5n, 7n, 11n]) {
    if (a >= n) continue;
    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let comp = true;
    for (let r = 1n; r < s; r++) {
      x = (x * x) % n;
      if (x === n - 1n) {
        comp = false;
        break;
      }
    }
    if (comp) return false;
  }
  return true;
}

function nextCoprimePrime(start: bigint, e: bigint): bigint {
  let c = start % 2n === 0n ? start + 1n : start;
  while (!isProbablePrime(c) || (c - 1n) % e === 0n) c += 2n;
  return c;
}

function randomCoprime(n: bigint): bigint {
  for (let i = 0; i < 256; i++) {
    const cand = (BigInt(`0x${randomBytes(32).toString('hex')}`) % (n - 3n)) + 2n;
    if (extendedGcd(cand, n).gcd === 1n) return cand;
  }
  throw new Error('Failed to sample coprime blinding scalar');
}

/**
 * Chaum Blind RSA Unlinkable Token Issuer & Nullifier Redemption Engine.
 */
export class VerifiableRSAUnlinkableBlindToken {
  private readonly spentNullifiers: Set<string> = new Set();

  public generateIssuerKey(issuerId: string, offsetP = 0n, offsetQ = 0n): BlindRSAIssuerKeyPair {
    const p = nextCoprimePrime(BLIND_RSA_SEED_P + offsetP * 2n, PUBLIC_EXP_E);
    const q = nextCoprimePrime(BLIND_RSA_SEED_Q + offsetQ * 2n, PUBLIC_EXP_E);
    if (p === q) throw new Error('RSA primes must be distinct');

    const modulusN = p * q;
    const phiN = (p - 1n) * (q - 1n);
    const privateD = modInverse(PUBLIC_EXP_E, phiN);
    const keyFingerprint = createHash('sha256')
      .update(`WorkSphere::BlindRSA|${issuerId}|${modulusN.toString(16)}`)
      .digest('hex')
      .slice(0, 32);

    return {
      issuerId,
      modulusN,
      publicE: PUBLIC_EXP_E,
      privateD,
      keyFingerprint,
    };
  }

  /**
   * Full-domain hash mapping a token ID into Z_N^* (coprime to N).
   */
  public hashTokenToGroup(issuerId: string, tokenId: string, modulusN: bigint): bigint {
    const h1 = createHash('sha256').update(`WorkSphere::BlindRSAMsg1|${issuerId}|${tokenId}`).digest('hex');
    const h2 = createHash('sha256').update(`WorkSphere::BlindRSAMsg2|${issuerId}|${tokenId}`).digest('hex');
    const raw = BigInt(`0x${h1}${h2}`) % (modulusN - 3n) + 2n;
    return raw;
  }

  public computeNullifier(issuerId: string, tokenId: string): string {
    return createHash('sha256')
      .update(`WorkSphere::BlindRSANullifier|${issuerId}|${tokenId}`)
      .digest('hex');
  }

  /**
   * Client Step 1: Blinds `tokenId` as m_blind = H(tokenId) * r^e mod N.
   */
  public blindToken(
    requestId: string,
    issuerPublic: Pick<BlindRSAIssuerKeyPair, 'issuerId' | 'modulusN' | 'publicE'>,
    tokenId?: string
  ): BlindedTokenRequest {
    const finalTokenId = tokenId ?? `tok-${randomBytes(16).toString('hex')}`;
    const m = this.hashTokenToGroup(issuerPublic.issuerId, finalTokenId, issuerPublic.modulusN);
    const blindingR = randomCoprime(issuerPublic.modulusN);
    const rE = modPow(blindingR, issuerPublic.publicE, issuerPublic.modulusN);
    const blindedDigest = (m * rE) % issuerPublic.modulusN;

    return {
      requestId,
      tokenId: finalTokenId,
      blindingR,
      blindedDigest,
    };
  }

  /**
   * Issuer Step 2: Signs the blinded digest without learning `tokenId`.
   */
  public blindSign(issuerKey: BlindRSAIssuerKeyPair, blindedDigest: bigint): bigint {
    if (blindedDigest <= 1n || blindedDigest >= issuerKey.modulusN) {
      throw new RangeError('Blinded digest out of range');
    }
    return modPow(blindedDigest, issuerKey.privateD, issuerKey.modulusN);
  }

  /**
   * Client Step 3: Unblinds s = s_blind * r^{-1} mod N and verifies s^e == H(tokenId) mod N!
   */
  public unblindToken(
    issuerPublic: Pick<BlindRSAIssuerKeyPair, 'issuerId' | 'modulusN' | 'publicE'>,
    request: BlindedTokenRequest,
    blindSignature: bigint
  ): UnblindedAccessToken {
    const rInv = modInverse(request.blindingR, issuerPublic.modulusN);
    const signatureS = (modNorm(blindSignature, issuerPublic.modulusN) * rInv) % issuerPublic.modulusN;
    const token: UnblindedAccessToken = {
      issuerId: issuerPublic.issuerId,
      tokenId: request.tokenId,
      signatureS,
      nullifierHex: this.computeNullifier(issuerPublic.issuerId, request.tokenId),
    };
    if (!this.verifyTokenSignature(issuerPublic, token)) {
      throw new Error('Issuer returned invalid blind RSA signature');
    }
    return token;
  }

  /**
   * Publicly verifies an unblinded RSA access token without consulting the issuer.
   */
  public verifyTokenSignature(
    issuerPublic: Pick<BlindRSAIssuerKeyPair, 'issuerId' | 'modulusN' | 'publicE'>,
    token: UnblindedAccessToken
  ): boolean {
    if (token.issuerId !== issuerPublic.issuerId) return false;
    if (token.nullifierHex !== this.computeNullifier(issuerPublic.issuerId, token.tokenId)) return false;
    const expectedM = this.hashTokenToGroup(issuerPublic.issuerId, token.tokenId, issuerPublic.modulusN);
    return modPow(token.signatureS, issuerPublic.publicE, issuerPublic.modulusN) === expectedM;
  }

  /**
   * Redeems a verified unlinkable access token ONCE and permanently records its nullifier to
   * block double-spending replays!
   */
  public redeemToken(
    issuerPublic: Pick<BlindRSAIssuerKeyPair, 'issuerId' | 'modulusN' | 'publicE'>,
    token: UnblindedAccessToken
  ): TokenRedemptionVerdict {
    if (!this.verifyTokenSignature(issuerPublic, token)) {
      return { accepted: false, nullifierHex: token.nullifierHex, reason: 'Invalid RSA token signature' };
    }
    if (this.spentNullifiers.has(token.nullifierHex)) {
      return { accepted: false, nullifierHex: token.nullifierHex, reason: 'Double-spend replay blocked' };
    }
    this.spentNullifiers.add(token.nullifierHex);
    return { accepted: true, nullifierHex: token.nullifierHex };
  }

  public getSpentCount(): number {
    return this.spentNullifiers.size;
  }

  public serializeToken(token: UnblindedAccessToken): string {
    return JSON.stringify({
      issuerId: token.issuerId,
      tokenId: token.tokenId,
      signatureS: token.signatureS.toString(16),
      nullifierHex: token.nullifierHex,
    });
  }

  public deserializeToken(payload: string): UnblindedAccessToken {
    const raw = JSON.parse(payload) as Record<string, string>;
    return {
      issuerId: raw.issuerId,
      tokenId: raw.tokenId,
      signatureS: BigInt(`0x${raw.signatureS}`),
      nullifierHex: raw.nullifierHex,
    };
  }
}
