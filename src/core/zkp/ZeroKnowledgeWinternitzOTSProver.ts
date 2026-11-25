/**
 * @file ZeroKnowledgeWinternitzOTSProver.ts
 * @description Post-Quantum Winternitz One-Time Signature Plus (WOTS+, RFC-8391-inspired)
 * Hash-Chain Prover & Verifier with Winternitz Checksum Forgery Defense.
 * Compresses hash-based signature sizes by ~4x vs Lamport using base-w (w = 16, 4-bit nibbles)
 * iterative keyed hash chains:
 *   - 256-bit message digest splits into 64 base-16 digits d_0..d_{63} in [0..15].
 *   - Appends 3 base-16 checksum digits encoding C = Sum_{i=0}^{63} (15 - d_i) (blocks forward-chain
 *     forgeries since increasing any message digit strictly decreases the checksum!).
 *   - Total 67 chains of length 15; verification completes remaining (15 - digit) chain steps
 *     and checks the resulting public key root hash!
 */

import { createHash, randomBytes } from 'node:crypto';

const WINTERNITZ_W = 16;
const MAX_DIGIT = WINTERNITZ_W - 1; // 15
const MSG_CHAINS = 64;              // 256 bits / 4 bits per nibble
const CHECKSUM_CHAINS = 3;          // max checksum = 64 * 15 = 960 < 16^3 = 4096
const TOTAL_CHAINS = MSG_CHAINS + CHECKSUM_CHAINS; // 67

export interface WOTSKeyPair {
  keyId: string;
  pubSeedHex: string;
  secretSeeds: string[];   // 67 secret chain starting points
  publicEndpoints: string[]; // 67 chain endpoints at step 15
  publicKeyHash: string;
  spent: boolean;
}

export interface WOTSSignature {
  keyId: string;
  pubSeedHex: string;
  message: string;
  messageDigestHex: string;
  chainValues: string[]; // 67 intermediate chain digests
  publicKeyHash: string;
  sigDigest: string;
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Domain-separated keyed WOTS+ chaining step (mitigates multi-target preimage attacks).
 */
function chainStep(pubSeedHex: string, chainIdx: number, stepIdx: number, inputHex: string): string {
  return sha256Hex(`WorkSphere::WOTS+|${pubSeedHex}|c:${chainIdx}|s:${stepIdx}|${inputHex}`);
}

function advanceChain(
  pubSeedHex: string,
  chainIdx: number,
  startValueHex: string,
  startStep: number,
  steps: number
): string {
  let cur = startValueHex;
  for (let s = 0; s < steps; s++) {
    cur = chainStep(pubSeedHex, chainIdx, startStep + s, cur);
  }
  return cur;
}

function hashPublicEndpoints(pubSeedHex: string, endpoints: readonly string[]): string {
  const h = createHash('sha256');
  h.update(`WorkSphere::WOTSPK|${pubSeedHex}`);
  for (const ep of endpoints) h.update(ep);
  return h.digest('hex');
}

/**
 * Post-Quantum WOTS+ Hash-Chain Signature Engine with Checksum Forgery Defense.
 */
export class ZeroKnowledgeWinternitzOTSProver {
  /**
   * Encodes a 256-bit message digest hex into 64 base-16 message digits + 3 base-16 checksum digits.
   */
  public encodeMessageWithChecksum(messageDigestHex: string): {
    digits: number[];
    checksumValue: number;
  } {
    if (messageDigestHex.length !== 64) {
      throw new Error('Expected 64-char SHA-256 hex digest');
    }

    const digits: number[] = [];
    let checksumValue = 0;
    for (let i = 0; i < MSG_CHAINS; i++) {
      const d = parseInt(messageDigestHex[i], 16);
      digits.push(d);
      checksumValue += MAX_DIGIT - d;
    }

    // Encode checksum in big-endian base-16 across 3 digits
    const c2 = (checksumValue >> 8) & 0xf;
    const c1 = (checksumValue >> 4) & 0xf;
    const c0 = checksumValue & 0xf;
    digits.push(c2, c1, c0);

    return { digits, checksumValue };
  }

  /**
   * Generates a fresh WOTS+ one-time key pair (67 hash chains of length 15).
   */
  public generateKeyPair(keyId: string, deterministicSeed?: string): WOTSKeyPair {
    const master = deterministicSeed ?? randomBytes(32).toString('hex');
    const pubSeedHex = sha256Hex(`WorkSphere::WOTSPubSeed|${keyId}|${master}`);

    const secretSeeds: string[] = new Array(TOTAL_CHAINS);
    const publicEndpoints: string[] = new Array(TOTAL_CHAINS);

    for (let c = 0; c < TOTAL_CHAINS; c++) {
      const sk = sha256Hex(`WorkSphere::WOTSSK|${keyId}|${master}|c:${c}`);
      secretSeeds[c] = sk;
      publicEndpoints[c] = advanceChain(pubSeedHex, c, sk, 0, MAX_DIGIT);
    }

    const publicKeyHash = hashPublicEndpoints(pubSeedHex, publicEndpoints);
    return {
      keyId,
      pubSeedHex,
      secretSeeds,
      publicEndpoints,
      publicKeyHash,
      spent: false,
    };
  }

  /**
   * Signs `message` ONCE using WOTS+ and permanently marks the key pair spent.
   */
  public signOneTime(keyPair: WOTSKeyPair, message: string): WOTSSignature {
    if (keyPair.spent) {
      throw new Error(`WOTS+ key ${keyPair.keyId} has already been spent`);
    }
    keyPair.spent = true;

    const messageDigestHex = sha256Hex(`WorkSphere::WOTSMsg|${message}`);
    const { digits } = this.encodeMessageWithChecksum(messageDigestHex);

    const chainValues: string[] = new Array(TOTAL_CHAINS);
    for (let c = 0; c < TOTAL_CHAINS; c++) {
      chainValues[c] = advanceChain(keyPair.pubSeedHex, c, keyPair.secretSeeds[c], 0, digits[c]);
    }

    const sigDigest = sha256Hex(
      `WorkSphere::WOTSSig|${keyPair.keyId}|${messageDigestHex}|${keyPair.publicKeyHash}`
    );

    return {
      keyId: keyPair.keyId,
      pubSeedHex: keyPair.pubSeedHex,
      message,
      messageDigestHex,
      chainValues,
      publicKeyHash: keyPair.publicKeyHash,
      sigDigest,
    };
  }

  /**
   * Publicly verifies a WOTS+ signature by advancing each chain the remaining (15 - digit) steps
   * and checking that the reconstructed 67-endpoint hash equals `expectedPublicKeyHash`!
   */
  public verifySignature(
    sig: WOTSSignature,
    expectedPublicKeyHash: string
  ): { valid: boolean; reconstructedPublicKeyHash?: string; reason?: string } {
    if (sig.chainValues.length !== TOTAL_CHAINS) {
      return { valid: false, reason: `Expected ${TOTAL_CHAINS} WOTS+ chain values` };
    }

    const expectedDigest = sha256Hex(`WorkSphere::WOTSMsg|${sig.message}`);
    if (expectedDigest !== sig.messageDigestHex) {
      return { valid: false, reason: 'Message digest mismatch' };
    }

    const { digits } = this.encodeMessageWithChecksum(expectedDigest);
    const reconstructedEndpoints: string[] = new Array(TOTAL_CHAINS);

    for (let c = 0; c < TOTAL_CHAINS; c++) {
      const remainingSteps = MAX_DIGIT - digits[c];
      reconstructedEndpoints[c] = advanceChain(
        sig.pubSeedHex,
        c,
        sig.chainValues[c],
        digits[c],
        remainingSteps
      );
    }

    const reconstructedPublicKeyHash = hashPublicEndpoints(sig.pubSeedHex, reconstructedEndpoints);
    if (reconstructedPublicKeyHash !== expectedPublicKeyHash || sig.publicKeyHash !== expectedPublicKeyHash) {
      return {
        valid: false,
        reconstructedPublicKeyHash,
        reason: 'Reconstructed WOTS+ public key hash mismatch',
      };
    }

    return { valid: true, reconstructedPublicKeyHash };
  }

  /**
   * Demonstrates Winternitz checksum security: proves that for ANY two distinct 256-bit digests,
   * at least one chain index has a strictly smaller digit (preventing forward-only hash forgery!).
   */
  public verifyChecksumDominanceResistance(msgA: string, msgB: string): {
    distinctMessages: boolean;
    hasDecreasingChainIndex: boolean;
    witnessChainIndex: number;
  } {
    const dA = sha256Hex(`WorkSphere::WOTSMsg|${msgA}`);
    const dB = sha256Hex(`WorkSphere::WOTSMsg|${msgB}`);
    if (dA === dB) {
      return { distinctMessages: false, hasDecreasingChainIndex: false, witnessChainIndex: -1 };
    }
    const encA = this.encodeMessageWithChecksum(dA).digits;
    const encB = this.encodeMessageWithChecksum(dB).digits;
    const witnessIdx = encA.findIndex((v, i) => encB[i] < v);
    return {
      distinctMessages: true,
      hasDecreasingChainIndex: witnessIdx >= 0,
      witnessChainIndex: witnessIdx,
    };
  }

  public serializeSignature(sig: WOTSSignature): string {
    return JSON.stringify(sig);
  }

  public deserializeSignature(payload: string): WOTSSignature {
    return JSON.parse(payload) as WOTSSignature;
  }
}
