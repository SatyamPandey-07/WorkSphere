/**
 * @file ZeroKnowledgeMerkleBloomFilterProver.ts
 * @description Cryptographic Domain-Separated Bloom-Filter Commitment & Merkle-Bitset
 * Proof Engine for Privacy-Preserving Watchlists, Revocation Filters, and Fast Membership Pre-Checks.
 * Commits to a fixed-size m-bit Bloom filter chunked into leaf blocks inside a Merkle tree so a
 * verifier can audit ONLY the k bit-positions H_1(x)..H_k(x) for a queried item x in O(k log(m/B))
 * WITHOUT downloading the full filter, while tracking empirical vs theoretical false-positive rates.
 */

import { createHash } from 'node:crypto';

export interface BloomFilterConfig {
  filterId: string;
  numBits: number;     // must be a power of two >= 64
  numHashes: number;   // k independent hash functions
  chunkBits: number;   // bits per Merkle leaf chunk (power of two, e.g., 32)
}

export interface BloomChunkProof {
  chunkIndex: number;
  chunkHex: string;
  leafHash: string;
  merklePath: Array<{ direction: 'left' | 'right'; siblingHash: string }>;
}

export interface BloomQueryVerificationProof {
  filterId: string;
  queriedKey: string;
  bitPositions: number[];
  possiblyPresent: boolean;
  chunkProofs: BloomChunkProof[];
  rootHash: string;
  proofDigest: string;
}

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hashChunk(filterId: string, chunkIndex: number, chunkHex: string): string {
  return sha256Hex(`WorkSphere::BloomChunk|${filterId}|idx:${chunkIndex}|hex:${chunkHex}`);
}

function hashPair(leftHex: string, rightHex: string): string {
  return createHash('sha256')
    .update('\x01')
    .update(Buffer.from(leftHex, 'hex'))
    .update(Buffer.from(rightHex, 'hex'))
    .digest('hex');
}

function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

/**
 * Merkle-Committed Cryptographic Bloom Filter & Verifiable Bit-Probe Engine.
 */
export class ZeroKnowledgeMerkleBloomFilterProver {
  private readonly config: BloomFilterConfig;
  private readonly bits: Uint8Array;
  private readonly numChunks: number;
  private insertedCount = 0;
  private merkleLevels: string[][] = [];
  private dirty = true;

  constructor(config: Partial<BloomFilterConfig> = {}) {
    const numBits = config.numBits ?? 2048;
    const chunkBits = config.chunkBits ?? 64;
    const numHashes = config.numHashes ?? 5;
    if (!isPowerOfTwo(numBits) || numBits < 64) {
      throw new RangeError('numBits must be a power of two >= 64');
    }
    if (!isPowerOfTwo(chunkBits) || chunkBits < 8 || chunkBits > numBits) {
      throw new RangeError('chunkBits must be a power of two between 8 and numBits');
    }
    if (!Number.isInteger(numHashes) || numHashes < 1 || numHashes > 16) {
      throw new RangeError('numHashes must be between 1 and 16');
    }

    this.config = {
      filterId: config.filterId ?? 'worksphere-bloom-2026',
      numBits,
      numHashes,
      chunkBits,
    };
    this.bits = new Uint8Array(numBits >> 3);
    this.numChunks = numBits / chunkBits;
  }

  public getConfig(): BloomFilterConfig {
    return { ...this.config };
  }

  public getInsertedCount(): number {
    return this.insertedCount;
  }

  /**
   * Computes k deterministic double-hashed bit indices in [0, numBits) for `key`.
   */
  public computeBitPositions(key: string): number[] {
    const h1Buf = createHash('sha256').update(`WorkSphere::BloomH1|${this.config.filterId}|${key}`).digest();
    const h2Buf = createHash('sha256').update(`WorkSphere::BloomH2|${this.config.filterId}|${key}`).digest();
    const h1 = h1Buf.readUInt32BE(0);
    const h2 = h2Buf.readUInt32BE(0) | 1; // odd step guarantees full cycle over power-of-two modulus
    const mask = this.config.numBits - 1;

    const positions: number[] = [];
    for (let i = 0; i < this.config.numHashes; i++) {
      positions.push(((h1 + i * h2) >>> 0) & mask);
    }
    return positions;
  }

  private setBit(pos: number): void {
    this.bits[pos >> 3] |= 1 << (pos & 7);
  }

  private getBit(pos: number): boolean {
    return ((this.bits[pos >> 3] >> (pos & 7)) & 1) === 1;
  }

  private getChunkHex(chunkIndex: number): string {
    const bytesPerChunk = this.config.chunkBits >> 3;
    const start = chunkIndex * bytesPerChunk;
    return Buffer.from(this.bits.subarray(start, start + bytesPerChunk)).toString('hex');
  }

  public insert(key: string): void {
    for (const pos of this.computeBitPositions(key)) {
      this.setBit(pos);
    }
    this.insertedCount++;
    this.dirty = true;
  }

  public insertBatch(keys: readonly string[]): string {
    for (const k of keys) this.insert(k);
    return this.commitFilterRoot();
  }

  public mightContain(key: string): boolean {
    return this.computeBitPositions(key).every((pos) => this.getBit(pos));
  }

  /**
   * Computes the theoretical false-positive probability (1 - e^{-k*n/m})^k.
   */
  public estimateFalsePositiveRate(): number {
    const { numBits: m, numHashes: k } = this.config;
    const n = this.insertedCount;
    return Math.pow(1 - Math.exp((-k * n) / m), k);
  }

  /**
   * Rebuilds the Merkle tree over all bitset chunks and returns the 256-bit filter root hash.
   */
  public commitFilterRoot(): string {
    const leaves: string[] = [];
    for (let c = 0; c < this.numChunks; c++) {
      leaves.push(hashChunk(this.config.filterId, c, this.getChunkHex(c)));
    }
    const levels: string[][] = [leaves];
    let cur = leaves;
    while (cur.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        next.push(hashPair(cur[i], cur[i + 1]));
      }
      levels.push(next);
      cur = next;
    }
    this.merkleLevels = levels;
    this.dirty = false;
    return levels[levels.length - 1][0];
  }

  public getRootHash(): string {
    if (this.dirty || this.merkleLevels.length === 0) {
      return this.commitFilterRoot();
    }
    return this.merkleLevels[this.merkleLevels.length - 1][0];
  }

  private proveChunk(chunkIndex: number): BloomChunkProof {
    const rootReady = this.getRootHash();
    void rootReady;
    const chunkHex = this.getChunkHex(chunkIndex);
    const merklePath: Array<{ direction: 'left' | 'right'; siblingHash: string }> = [];
    let idx = chunkIndex;
    for (let lvl = 0; lvl < this.merkleLevels.length - 1; lvl++) {
      const isRight = (idx & 1) === 1;
      const sibIdx = isRight ? idx - 1 : idx + 1;
      merklePath.push({
        direction: isRight ? 'left' : 'right',
        siblingHash: this.merkleLevels[lvl][sibIdx],
      });
      idx >>= 1;
    }
    return {
      chunkIndex,
      chunkHex,
      leafHash: this.merkleLevels[0][chunkIndex],
      merklePath,
    };
  }

  /**
   * Generates a compact Merkle-verified Bloom query proof revealing ONLY the chunks touched by
   * `queriedKey`'s k hash positions — proving EITHER definite non-membership (at least one 0 bit)
   * OR probabilistic membership (all k bits == 1)!
   */
  public generateQueryProof(queriedKey: string): BloomQueryVerificationProof {
    const rootHash = this.getRootHash();
    const bitPositions = this.computeBitPositions(queriedKey);
    const possiblyPresent = bitPositions.every((p) => this.getBit(p));

    const touchedChunks = Array.from(
      new Set(bitPositions.map((p) => Math.floor(p / this.config.chunkBits)))
    ).sort((a, b) => a - b);

    const chunkProofs = touchedChunks.map((cIdx) => this.proveChunk(cIdx));
    const proofDigest = sha256Hex(
      `WorkSphere::BloomProof|${this.config.filterId}|${queriedKey}|present:${possiblyPresent}|${rootHash}`
    );

    return {
      filterId: this.config.filterId,
      queriedKey,
      bitPositions,
      possiblyPresent,
      chunkProofs,
      rootHash,
      proofDigest,
    };
  }

  /**
   * Publicly verifies a Bloom query proof against `expectedRootHash` without possessing the filter!
   */
  public verifyQueryProof(
    proof: BloomQueryVerificationProof,
    expectedRootHash: string
  ): { valid: boolean; reason?: string } {
    if (proof.filterId !== this.config.filterId) {
      return { valid: false, reason: 'Filter ID mismatch' };
    }
    if (proof.rootHash !== expectedRootHash) {
      return { valid: false, reason: 'Root hash mismatch' };
    }

    const expectedPositions = this.computeBitPositions(proof.queriedKey);
    if (
      expectedPositions.length !== proof.bitPositions.length ||
      expectedPositions.some((p, i) => p !== proof.bitPositions[i])
    ) {
      return { valid: false, reason: 'Bit positions do not match queriedKey hashes' };
    }

    const chunkMap = new Map<number, Buffer>();
    for (const cp of proof.chunkProofs) {
      const recomputedLeaf = hashChunk(proof.filterId, cp.chunkIndex, cp.chunkHex);
      if (recomputedLeaf !== cp.leafHash) {
        return { valid: false, reason: `Chunk ${cp.chunkIndex} leaf hash mismatch` };
      }
      let cur = recomputedLeaf;
      let reconIdx = 0;
      for (let lvl = 0; lvl < cp.merklePath.length; lvl++) {
        const step = cp.merklePath[lvl];
        if (step.direction === 'left') {
          cur = hashPair(step.siblingHash, cur);
          reconIdx |= 1 << lvl;
        } else {
          cur = hashPair(cur, step.siblingHash);
        }
      }
      if (reconIdx !== cp.chunkIndex || cur !== expectedRootHash) {
        return { valid: false, reason: `Merkle path verification failed for chunk ${cp.chunkIndex}` };
      }
      chunkMap.set(cp.chunkIndex, Buffer.from(cp.chunkHex, 'hex'));
    }

    // Re-evaluate all k probed bits from the verified chunks
    let allOne = true;
    for (const pos of expectedPositions) {
      const cIdx = Math.floor(pos / this.config.chunkBits);
      const localBit = pos % this.config.chunkBits;
      const chunkBuf = chunkMap.get(cIdx);
      if (!chunkBuf) {
        return { valid: false, reason: `Missing verified chunk ${cIdx} for bit ${pos}` };
      }
      const isSet = ((chunkBuf[localBit >> 3] >> (localBit & 7)) & 1) === 1;
      if (!isSet) allOne = false;
    }

    if (allOne !== proof.possiblyPresent) {
      return { valid: false, reason: 'Claimed possiblyPresent flag contradicts verified filter bits' };
    }

    return { valid: true };
  }

  public batchVerifyQueries(
    proofs: readonly BloomQueryVerificationProof[],
    expectedRootHash: string
  ): { allValid: boolean; presentKeys: string[]; definitelyAbsentKeys: string[]; failedKeys: string[] } {
    const presentKeys: string[] = [];
    const definitelyAbsentKeys: string[] = [];
    const failedKeys: string[] = [];

    for (const p of proofs) {
      if (this.verifyQueryProof(p, expectedRootHash).valid) {
        if (p.possiblyPresent) presentKeys.push(p.queriedKey);
        else definitelyAbsentKeys.push(p.queriedKey);
      } else {
        failedKeys.push(p.queriedKey);
      }
    }

    return {
      allValid: proofs.length > 0 && failedKeys.length === 0,
      presentKeys,
      definitelyAbsentKeys,
      failedKeys,
    };
  }

  public serializeProof(proof: BloomQueryVerificationProof): string {
    return JSON.stringify(proof);
  }

  public deserializeProof(payload: string): BloomQueryVerificationProof {
    return JSON.parse(payload) as BloomQueryVerificationProof;
  }
}
