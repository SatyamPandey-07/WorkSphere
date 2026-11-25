/**
 * @file DistributedVerifiableEscrowProver.ts
 * @description Schnorr Adaptor-Signature Verifiable Fair-Exchange Escrow & Atomic Secret-Release Prover.
 * Enables trustless atomic swap / fair exchange of digital workspace assets or secret keys:
 *   1. Seller holds witness secret t with public statement T = g^t mod p.
 *   2. Buyer creates an adaptor pre-signature (R_hat, s_hat) encrypted under T on a settlement tx:
 *        R_total = R_hat * T,  e = H(pk_buyer || R_total || tx),  s_hat = k + e * sk_buyer mod q.
 *   3. Anyone verifies the pre-signature via g^{s_hat} == R_hat * pk_buyer^e mod p.
 *   4. Seller adapts the pre-signature with t into a standard Schnorr signature s = s_hat + t mod q
 *      (verifiable via g^s == R_total * pk_buyer^e mod p) and publishes it to claim payment.
 *   5. Buyer IMMEDIATELY extracts the exact secret witness t = (s - s_hat) mod q from the published
 *      signature, guaranteeing 100% atomic fair exchange without a trusted mediator!
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface EscrowKeyPair {
  partyId: string;
  secretKey: bigint;
  publicKey: bigint;
}

export interface SecretWitnessStatement {
  witnessId: string;
  secretT: bigint;
  statementT: bigint;
  encryptedAssetHex: string;
  assetMacHex: string;
}

export interface AdaptorPreSignature {
  escrowId: string;
  buyerPublicKey: bigint;
  statementT: bigint;
  settlementMessage: string;
  rHat: bigint;
  rTotal: bigint;
  sHat: bigint;
  preSigDigest: string;
}

export interface AdaptedFinalSignature {
  escrowId: string;
  buyerPublicKey: bigint;
  settlementMessage: string;
  rTotal: bigint;
  sFinal: bigint;
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

function xorAsset(buf: Buffer, witnessT: bigint, witnessId: string): Buffer {
  const out = Buffer.alloc(buf.length);
  let offset = 0;
  let block = 0;
  while (offset < buf.length) {
    const stream = createHash('sha256')
      .update(`WorkSphere::EscrowStream|${witnessId}|${witnessT.toString(16)}|${block}`)
      .digest();
    for (let i = 0; i < stream.length && offset < buf.length; i++, offset++) {
      out[offset] = buf[offset] ^ stream[i];
    }
    block++;
  }
  return out;
}

/**
 * Adaptor-Signature Verifiable Fair-Exchange Escrow Engine.
 */
export class DistributedVerifiableEscrowProver {
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

  public generatePartyKey(partyId: string, seedSecret?: bigint): EscrowKeyPair {
    const secretKey = seedSecret !== undefined
      ? modNorm(seedSecret, this.q - 2n) + 2n
      : randomScalar(this.q);
    return {
      partyId,
      secretKey,
      publicKey: modPow(this.g, secretKey, this.p),
    };
  }

  private computeMac(witnessT: bigint, witnessId: string, ciphertext: Buffer): string {
    return createHash('sha256')
      .update(`WorkSphere::EscrowMac|${witnessId}|${witnessT.toString(16)}|${ciphertext.toString('hex')}`)
      .digest('hex');
  }

  /**
   * Seller locks a secret digital asset under a fresh adaptor witness t and publishes T = g^t mod p
   * along with the authenticated ciphertext.
   */
  public lockSecretAsset(witnessId: string, secretAssetPayload: string): SecretWitnessStatement {
    const secretT = randomScalar(this.q);
    const statementT = modPow(this.g, secretT, this.p);
    const ct = xorAsset(Buffer.from(secretAssetPayload, 'utf8'), secretT, witnessId);
    const assetMacHex = this.computeMac(secretT, witnessId, ct);

    return {
      witnessId,
      secretT,
      statementT,
      encryptedAssetHex: ct.toString('hex'),
      assetMacHex,
    };
  }

  private computeChallenge(buyerPub: bigint, rTotal: bigint, message: string): bigint {
    return hashScalar('WorkSphere::EscrowAdaptorE', [buyerPub, rTotal, message]);
  }

  /**
   * Buyer generates an adaptor pre-signature locked to statement T = g^t mod p.
   */
  public createPreSignature(
    escrowId: string,
    buyerKey: EscrowKeyPair,
    statementT: bigint,
    settlementMessage: string
  ): AdaptorPreSignature {
    if (statementT <= 1n || statementT >= this.p || modPow(statementT, this.q, this.p) !== 1n) {
      throw new Error('Invalid adaptor statement T outside order-q subgroup');
    }

    const k = randomScalar(this.q);
    const rHat = modPow(this.g, k, this.p);
    const rTotal = (rHat * statementT) % this.p;
    const e = this.computeChallenge(buyerKey.publicKey, rTotal, settlementMessage);
    const sHat = modNorm(k + e * buyerKey.secretKey, this.q);

    const preSigDigest = createHash('sha256')
      .update(`${escrowId}|${buyerKey.publicKey.toString(16)}|${statementT.toString(16)}|${rTotal.toString(16)}|${sHat.toString(16)}`)
      .digest('hex');

    return {
      escrowId,
      buyerPublicKey: buyerKey.publicKey,
      statementT,
      settlementMessage,
      rHat,
      rTotal,
      sHat,
      preSigDigest,
    };
  }

  /**
   * Publicly verifies an adaptor pre-signature before the seller commits to adapting it.
   */
  public verifyPreSignature(preSig: AdaptorPreSignature): boolean {
    if ((preSig.rHat * preSig.statementT) % this.p !== preSig.rTotal) return false;
    const expectedDigest = createHash('sha256')
      .update(
        `${preSig.escrowId}|${preSig.buyerPublicKey.toString(16)}|${preSig.statementT.toString(16)}|${preSig.rTotal.toString(16)}|${preSig.sHat.toString(16)}`
      )
      .digest('hex');
    if (expectedDigest !== preSig.preSigDigest) return false;

    const e = this.computeChallenge(preSig.buyerPublicKey, preSig.rTotal, preSig.settlementMessage);
    const lhs = modPow(this.g, modNorm(preSig.sHat, this.q), this.p);
    const rhs = (preSig.rHat * modPow(preSig.buyerPublicKey, e, this.p)) % this.p;
    return lhs === rhs;
  }

  /**
   * Seller adapts the verified pre-signature with secret witness t -> standard valid Schnorr signature!
   */
  public adaptPreSignature(
    preSig: AdaptorPreSignature,
    secretT: bigint
  ): AdaptedFinalSignature {
    if (!this.verifyPreSignature(preSig)) {
      throw new Error('Cannot adapt an invalid pre-signature');
    }
    if (modPow(this.g, modNorm(secretT, this.q), this.p) !== preSig.statementT) {
      throw new Error('Witness secret t does not match adaptor statement T');
    }

    const sFinal = modNorm(preSig.sHat + secretT, this.q);
    const sigDigest = createHash('sha256')
      .update(`${preSig.escrowId}|${preSig.buyerPublicKey.toString(16)}|${preSig.rTotal.toString(16)}|${sFinal.toString(16)}`)
      .digest('hex');

    return {
      escrowId: preSig.escrowId,
      buyerPublicKey: preSig.buyerPublicKey,
      settlementMessage: preSig.settlementMessage,
      rTotal: preSig.rTotal,
      sFinal,
      sigDigest,
    };
  }

  /**
   * Publicly verifies the final adapted Schnorr settlement signature (looks identical to a normal Schnorr sig).
   */
  public verifyFinalSignature(sig: AdaptedFinalSignature): boolean {
    const e = this.computeChallenge(sig.buyerPublicKey, sig.rTotal, sig.settlementMessage);
    const lhs = modPow(this.g, modNorm(sig.sFinal, this.q), this.p);
    const rhs = (sig.rTotal * modPow(sig.buyerPublicKey, e, this.p)) % this.p;
    return lhs === rhs;
  }

  /**
   * Buyer extracts the exact secret witness t = (sFinal - sHat) mod q from the published final signature
   * and immediately decrypts & authenticates the escrowed digital asset!
   */
  public extractWitnessAndUnlockAsset(
    preSig: AdaptorPreSignature,
    finalSig: AdaptedFinalSignature,
    witnessId: string,
    encryptedAssetHex: string,
    assetMacHex: string
  ): { valid: boolean; extractedT?: bigint; decryptedAsset?: string; reason?: string } {
    if (!this.verifyFinalSignature(finalSig)) {
      return { valid: false, reason: 'Final adapted signature is invalid' };
    }
    if (finalSig.rTotal !== preSig.rTotal || finalSig.settlementMessage !== preSig.settlementMessage) {
      return { valid: false, reason: 'Final signature does not match pre-signature transcript' };
    }

    const extractedT = modNorm(finalSig.sFinal - preSig.sHat, this.q);
    if (modPow(this.g, extractedT, this.p) !== preSig.statementT) {
      return { valid: false, reason: 'Extracted witness does not match statement T' };
    }

    const ct = Buffer.from(encryptedAssetHex, 'hex');
    if (this.computeMac(extractedT, witnessId, ct) !== assetMacHex) {
      return { valid: false, reason: 'Asset MAC integrity check failed with extracted witness' };
    }

    const decryptedAsset = xorAsset(ct, extractedT, witnessId).toString('utf8');
    return { valid: true, extractedT, decryptedAsset };
  }

  /**
   * Executes a two-way atomic swap verification checking that both legs share the exact same witness T.
   */
  public verifyAtomicSwapPair(
    legA: { preSig: AdaptorPreSignature; finalSig: AdaptedFinalSignature },
    legB: { preSig: AdaptorPreSignature; finalSig: AdaptedFinalSignature }
  ): { valid: boolean; sharedWitnessT?: bigint; reason?: string } {
    if (legA.preSig.statementT !== legB.preSig.statementT) {
      return { valid: false, reason: 'Swap legs do not share the same adaptor statement T' };
    }
    if (!this.verifyFinalSignature(legA.finalSig) || !this.verifyFinalSignature(legB.finalSig)) {
      return { valid: false, reason: 'One or both final swap signatures are invalid' };
    }
    const tA = modNorm(legA.finalSig.sFinal - legA.preSig.sHat, this.q);
    const tB = modNorm(legB.finalSig.sFinal - legB.preSig.sHat, this.q);
    if (tA !== tB || modPow(this.g, tA, this.p) !== legA.preSig.statementT) {
      return { valid: false, reason: 'Extracted witnesses diverge across swap legs' };
    }
    return { valid: true, sharedWitnessT: tA };
  }

  public serializePreSignature(preSig: AdaptorPreSignature): string {
    return JSON.stringify({
      escrowId: preSig.escrowId,
      buyerPublicKey: preSig.buyerPublicKey.toString(16),
      statementT: preSig.statementT.toString(16),
      settlementMessage: preSig.settlementMessage,
      rHat: preSig.rHat.toString(16),
      rTotal: preSig.rTotal.toString(16),
      sHat: preSig.sHat.toString(16),
      preSigDigest: preSig.preSigDigest,
    });
  }

  public deserializePreSignature(payload: string): AdaptorPreSignature {
    const raw = JSON.parse(payload) as Record<string, string>;
    return {
      escrowId: raw.escrowId,
      buyerPublicKey: BigInt(`0x${raw.buyerPublicKey}`),
      statementT: BigInt(`0x${raw.statementT}`),
      settlementMessage: raw.settlementMessage,
      rHat: BigInt(`0x${raw.rHat}`),
      rTotal: BigInt(`0x${raw.rTotal}`),
      sHat: BigInt(`0x${raw.sHat}`),
      preSigDigest: raw.preSigDigest,
    };
  }

  /**
   * Executes a multi-hop adaptor-signature atomic payment chain (e.g. A -> B -> C) locked to
   * a single witness T so releasing T at the final hop atomically unlocks every upstream hop.
   */
  public verifyMultiHopAdaptorChain(
    hops: ReadonlyArray<{
      hopId: string;
      preSig: AdaptorPreSignature;
      finalSig: AdaptedFinalSignature;
    }>
  ): {
    allValid: boolean;
    extractedWitnessT?: bigint;
    failedHopIds: string[];
    chainDigest: string;
  } {
    if (hops.length === 0) {
      return { allValid: false, failedHopIds: [], chainDigest: '' };
    }
    const anchorStatement = hops[0].preSig.statementT;
    const failedHopIds: string[] = [];
    let sharedT: bigint | undefined;

    for (const hop of hops) {
      if (
        hop.preSig.statementT !== anchorStatement ||
        !this.verifyPreSignature(hop.preSig) ||
        !this.verifyFinalSignature(hop.finalSig)
      ) {
        failedHopIds.push(hop.hopId);
        continue;
      }
      const t = modNorm(hop.finalSig.sFinal - hop.preSig.sHat, this.q);
      if (modPow(this.g, t, this.p) !== anchorStatement) {
        failedHopIds.push(hop.hopId);
        continue;
      }
      if (sharedT === undefined) sharedT = t;
      else if (sharedT !== t) failedHopIds.push(hop.hopId);
    }

    const chainDigest = createHash('sha256')
      .update(hops.map((h) => `${h.hopId}:${h.finalSig.sigDigest}`).join('|'))
      .digest('hex');

    return {
      allValid: failedHopIds.length === 0 && sharedT !== undefined,
      extractedWitnessT: sharedT,
      failedHopIds,
      chainDigest,
    };
  }
}
