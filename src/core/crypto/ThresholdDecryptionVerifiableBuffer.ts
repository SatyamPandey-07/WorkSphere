/**
 * @file ThresholdDecryptionVerifiableBuffer.ts
 * @description Verifiable Threshold Decryption Buffer for MEV-Resistant Consensus Mempools.
 * Stores encrypted transactions in an order-fair verifiable buffer until block ordering is
 * finalized in consensus. Validators then contribute threshold decryption shares with
 * non-interactive Chaum-Pedersen DLEQ zero-knowledge proofs over BN254, reconstructing
 * original transaction payloads atomically in deterministic sequence order.
 */

import { createHash, randomBytes } from 'crypto';

export const BUFFER_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const BUFFER_GENERATOR = 3n;

/**
 * Field arithmetic helper over BN254.
 */
export class BufferFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = BUFFER_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = BUFFER_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = BUFFER_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = BUFFER_PRIME): bigint {
    let res = 1n;
    let b = ((base % p) + p) % p;
    let e = exponent < 0n ? (exponent % (p - 1n)) + (p - 1n) : exponent % (p - 1n);
    while (e > 0n) {
      if (e & 1n) res = (res * b) % p;
      b = (b * b) % p;
      e >>= 1n;
    }
    return res;
  }

  public static inv(val: bigint, p: bigint = BUFFER_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('BufferFieldMath: Cannot invert zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = BUFFER_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }

  public static randomScalar(p: bigint = BUFFER_PRIME): bigint {
    const b = randomBytes(32);
    let val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

/**
 * Chaum-Pedersen Discrete Log Equality (DLEQ) Proof.
 * Proves log_G(PK_i) == log_C1(W_i) = s_i.
 */
export interface BufferDLEQProof {
  commitmentG: bigint;
  commitmentC1: bigint;
  challenge: bigint;
  response: bigint;
}

/**
 * Threshold decryption share.
 */
export interface BufferDecryptionShare {
  partyIndex: number;
  partialDecryption: bigint;
  proof: BufferDLEQProof;
}

/**
 * Buffered encrypted entry.
 */
export interface EncryptedBufferEntry {
  entryId: string;
  c1: bigint;
  c2: bigint;
  ciphertextDigest: string;
  epoch: number;
  sequenceNumber: number;
  timestamp: number;
  isDecrypted: boolean;
  decryptedPayload?: bigint;
}

/**
 * Configuration for the threshold decryption buffer.
 */
export interface ThresholdBufferConfig {
  threshold: number;
  totalParties: number;
  networkPublicKey: bigint;
  partyPublicKeys: Map<number, bigint>;
  prime?: bigint;
  g?: bigint;
}

/**
 * Engine managing verifiable encrypted buffering and threshold reconstruction.
 */
export class ThresholdDecryptionVerifiableBuffer {
  public readonly threshold: number;
  public readonly totalParties: number;
  public readonly networkPublicKey: bigint;
  public readonly partyPublicKeys: Map<number, bigint>;
  public readonly prime: bigint;
  public readonly g: bigint;

  private buffer: Map<string, EncryptedBufferEntry> = new Map();
  private collectedShares: Map<string, Map<number, BufferDecryptionShare>> = new Map();

  constructor(config: ThresholdBufferConfig) {
    this.threshold = config.threshold;
    this.totalParties = config.totalParties;
    this.networkPublicKey = config.networkPublicKey;
    this.partyPublicKeys = new Map(config.partyPublicKeys);
    this.prime = config.prime ?? BUFFER_PRIME;
    this.g = config.g ?? BUFFER_GENERATOR;
  }

  /**
   * Enqueues an encrypted entry into the verifiable mempool buffer.
   */
  public enqueueEncryptedEntry(
    entryId: string,
    c1: bigint,
    c2: bigint,
    epoch: number,
    sequenceNumber: number
  ): EncryptedBufferEntry {
    if (this.buffer.has(entryId)) {
      throw new Error(`Entry ${entryId} already exists in buffer`);
    }

    const digest = createHash('sha256')
      .update(`${c1.toString(16)}:${c2.toString(16)}:${epoch}:${sequenceNumber}`)
      .digest('hex');

    const entry: EncryptedBufferEntry = {
      entryId,
      c1: ((c1 % this.prime) + this.prime) % this.prime,
      c2: ((c2 % this.prime) + this.prime) % this.prime,
      ciphertextDigest: digest,
      epoch,
      sequenceNumber,
      timestamp: Date.now(),
      isDecrypted: false,
    };

    this.buffer.set(entryId, entry);
    this.collectedShares.set(entryId, new Map());
    return entry;
  }

  /**
   * Generates a decryption share with a non-interactive Chaum-Pedersen DLEQ proof.
   */
  public createDecryptionShare(
    partyIndex: number,
    secretShare: bigint,
    entryId: string,
    c1: bigint
  ): BufferDecryptionShare {
    const s_i = ((secretShare % this.prime) + this.prime) % this.prime;
    const partialDecryption = BufferFieldMath.mul(s_i, c1, this.prime);

    // Blinding scalar k
    const k = BufferFieldMath.randomScalar(this.prime);
    const commitmentG = BufferFieldMath.mul(k, this.g, this.prime);
    const commitmentC1 = BufferFieldMath.mul(k, c1, this.prime);

    const pk_i = this.partyPublicKeys.get(partyIndex);
    if (!pk_i) {
      throw new Error(`Party index ${partyIndex} not found in public keys`);
    }

    // Fiat-Shamir challenge
    const transcript = [
      entryId,
      this.g.toString(16),
      pk_i.toString(16),
      c1.toString(16),
      partialDecryption.toString(16),
      commitmentG.toString(16),
      commitmentC1.toString(16),
    ].join(':');

    const challenge = BufferFieldMath.hashToScalar(transcript, this.prime);

    // Response z = k + challenge * s_i mod p
    const response = BufferFieldMath.add(k, BufferFieldMath.mul(challenge, s_i, this.prime), this.prime);

    return {
      partyIndex,
      partialDecryption,
      proof: {
        commitmentG,
        commitmentC1,
        challenge,
        response,
      },
    };
  }

  /**
   * Verifies a Chaum-Pedersen DLEQ proof.
   */
  public verifyDLEQProof(
    partyIndex: number,
    c1: bigint,
    partialDecryption: bigint,
    proof: BufferDLEQProof,
    entryId: string
  ): boolean {
    const pk_i = this.partyPublicKeys.get(partyIndex);
    if (!pk_i) return false;

    // Check transcript hash matches challenge
    const transcript = [
      entryId,
      this.g.toString(16),
      pk_i.toString(16),
      c1.toString(16),
      partialDecryption.toString(16),
      proof.commitmentG.toString(16),
      proof.commitmentC1.toString(16),
    ].join(':');

    const expectedChallenge = BufferFieldMath.hashToScalar(transcript, this.prime);
    if (proof.challenge !== expectedChallenge) {
      return false;
    }

    // Check z * G == commitmentG + challenge * PK_i
    const lhsG = BufferFieldMath.mul(proof.response, this.g, this.prime);
    const rhsG = BufferFieldMath.add(proof.commitmentG, BufferFieldMath.mul(proof.challenge, pk_i, this.prime), this.prime);
    if (lhsG !== rhsG) return false;

    // Check z * C1 == commitmentC1 + challenge * partialDecryption
    const lhsC1 = BufferFieldMath.mul(proof.response, c1, this.prime);
    const rhsC1 = BufferFieldMath.add(
      proof.commitmentC1,
      BufferFieldMath.mul(proof.challenge, partialDecryption, this.prime),
      this.prime
    );
    return lhsC1 === rhsC1;
  }

  /**
   * Submits and validates a decryption share for a buffered entry.
   */
  public submitDecryptionShare(
    entryId: string,
    share: BufferDecryptionShare
  ): { success: boolean; totalSharesCollected: number; canDecrypt: boolean; reason?: string } {
    const entry = this.buffer.get(entryId);
    if (!entry) {
      return { success: false, totalSharesCollected: 0, canDecrypt: false, reason: 'Entry not found in buffer' };
    }

    if (entry.isDecrypted) {
      return { success: true, totalSharesCollected: this.threshold, canDecrypt: true };
    }

    const isValid = this.verifyDLEQProof(
      share.partyIndex,
      entry.c1,
      share.partialDecryption,
      share.proof,
      entryId
    );

    if (!isValid) {
      return { success: false, totalSharesCollected: 0, canDecrypt: false, reason: 'Invalid DLEQ zero-knowledge proof' };
    }

    const sharesMap = this.collectedShares.get(entryId)!;
    sharesMap.set(share.partyIndex, share);

    return {
      success: true,
      totalSharesCollected: sharesMap.size,
      canDecrypt: sharesMap.size >= this.threshold,
    };
  }

  /**
   * Reconstructs the decrypted plaintext using Lagrange interpolation over threshold shares.
   */
  public reconstructDecryptedPayload(entryId: string): bigint {
    const entry = this.buffer.get(entryId);
    if (!entry) throw new Error(`Entry ${entryId} not found`);

    if (entry.isDecrypted && entry.decryptedPayload !== undefined) {
      return entry.decryptedPayload;
    }

    const sharesMap = this.collectedShares.get(entryId)!;
    if (sharesMap.size < this.threshold) {
      throw new Error(`Insufficient shares to decrypt entry ${entryId}: have ${sharesMap.size}, need ${this.threshold}`);
    }

    // Take the first threshold shares
    const activeShares = Array.from(sharesMap.values()).slice(0, this.threshold);
    const indices = activeShares.map((s) => BigInt(s.partyIndex));

    let secretSharedMask = 0n;
    for (let i = 0; i < this.threshold; i++) {
      const xi = indices[i];
      let num = 1n;
      let den = 1n;

      for (let j = 0; j < this.threshold; j++) {
        if (i === j) continue;
        const xj = indices[j];
        // Lagrange basis l_i(0) = \prod_{j != i} (0 - xj) / (xi - xj)
        num = BufferFieldMath.mul(num, BufferFieldMath.sub(0n, xj, this.prime), this.prime);
        den = BufferFieldMath.mul(den, BufferFieldMath.sub(xi, xj, this.prime), this.prime);
      }

      const lagrange = BufferFieldMath.mul(num, BufferFieldMath.inv(den, this.prime), this.prime);
      const term = BufferFieldMath.mul(lagrange, activeShares[i].partialDecryption, this.prime);
      secretSharedMask = BufferFieldMath.add(secretSharedMask, term, this.prime);
    }

    // Recover plaintext: M = C2 - secretSharedMask (mod p)
    const plaintext = BufferFieldMath.sub(entry.c2, secretSharedMask, this.prime);

    entry.isDecrypted = true;
    entry.decryptedPayload = plaintext;

    return plaintext;
  }

  /**
   * Drains decrypted entries for an epoch, ordered strictly by sequenceNumber.
   */
  public drainDecryptedBuffer(epoch: number): EncryptedBufferEntry[] {
    const results: EncryptedBufferEntry[] = [];
    for (const entry of this.buffer.values()) {
      if (entry.epoch === epoch && entry.isDecrypted) {
        results.push(entry);
      }
    }

    results.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    return results;
  }
}
