/**
 * @file VerifiableHashBasedLamportOneTimeSig.ts
 * @description Post-Quantum Hash-Based Lamport-Diffie One-Time Signature (LD-OTS) &
 * Merkle Signature Scheme (MSS) Multi-Message Verifier.
 * Relies EXCLUSIVELY on SHA-256 preimage resistance (zero number-theoretic assumptions ->
 * immune to Shor's quantum algorithm!):
 *   1. Generates 256 pairs of 256-bit secret preimages (sk0[i], sk1[i]) and public hashes (pk0[i], pk1[i]).
 *   2. Signs a message m by hashing d = SHA256(m) and revealing sk_{d_bit[i]}[i] for all 256 bits.
 *   3. Wraps K = 2^h independent Lamport one-time keys inside a Merkle Authentication Tree (MSS)
 *      under ONE single compact 256-bit quantum-resistant master public key!
 */

import { createHash, randomBytes } from 'node:crypto';

export interface LamportKeyPair {
  leafIndex: number;
  sk0: string[]; // 256 hex preimages
  sk1: string[]; // 256 hex preimages
  pk0: string[]; // 256 SHA-256 digests
  pk1: string[]; // 256 SHA-256 digests
  publicKeyDigest: string;
  used: boolean;
}

export interface LamportSignature {
  leafIndex: number;
  message: string;
  messageDigestHex: string;
  revealedPreimages: string[]; // 256 revealed preimages
  publicKey0: string[];
  publicKey1: string[];
  merklePath: Array<{ direction: 'left' | 'right'; siblingHash: string }>;
  masterRootHash: string;
  sigDigest: string;
}

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hashPair(left: string, right: string): string {
  return createHash('sha256')
    .update('\x01')
    .update(Buffer.from(left, 'hex'))
    .update(Buffer.from(right, 'hex'))
    .digest('hex');
}

function hashLamportPublicKey(pk0: readonly string[], pk1: readonly string[]): string {
  const h = createHash('sha256');
  h.update('WorkSphere::LamportPK');
  for (let i = 0; i < 256; i++) {
    h.update(pk0[i]);
    h.update(pk1[i]);
  }
  return h.digest('hex');
}

function getDigestBit(digestBuf: Buffer, bitIndex: number): 0 | 1 {
  const byteIdx = bitIndex >> 3;
  const bitOff = 7 - (bitIndex & 7);
  return ((digestBuf[byteIdx] >> bitOff) & 1) === 1 ? 1 : 0;
}

/**
 * Post-Quantum Merkle-Lamport One-Time Signature Scheme (MSS-LD-OTS).
 */
export class VerifiableHashBasedLamportOneTimeSig {
  private readonly treeHeight: number;
  private readonly keyCount: number;
  private readonly keys: LamportKeyPair[] = [];
  private readonly merkleLevels: string[][] = [];
  private nextAvailableIndex = 0;

  constructor(treeHeight = 3, masterSeedHex?: string) {
    if (!Number.isInteger(treeHeight) || treeHeight < 1 || treeHeight > 6) {
      throw new RangeError('treeHeight must be between 1 and 6 (2..64 one-time keys)');
    }
    this.treeHeight = treeHeight;
    this.keyCount = 1 << treeHeight;
    const seed = masterSeedHex ?? randomBytes(32).toString('hex');

    const leafHashes: string[] = [];
    for (let idx = 0; idx < this.keyCount; idx++) {
      const kp = this.deriveOneTimeKeyPair(seed, idx);
      this.keys.push(kp);
      leafHashes.push(kp.publicKeyDigest);
    }

    this.merkleLevels.push(leafHashes);
    let cur = leafHashes;
    while (cur.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        next.push(hashPair(cur[i], cur[i + 1]));
      }
      this.merkleLevels.push(next);
      cur = next;
    }
  }

  private deriveOneTimeKeyPair(seed: string, leafIndex: number): LamportKeyPair {
    const sk0: string[] = new Array(256);
    const sk1: string[] = new Array(256);
    const pk0: string[] = new Array(256);
    const pk1: string[] = new Array(256);

    for (let i = 0; i < 256; i++) {
      const s0 = sha256Hex(`WorkSphere::LDOTS|${seed}|leaf:${leafIndex}|b:0|i:${i}`);
      const s1 = sha256Hex(`WorkSphere::LDOTS|${seed}|leaf:${leafIndex}|b:1|i:${i}`);
      sk0[i] = s0;
      sk1[i] = s1;
      pk0[i] = sha256Hex(s0);
      pk1[i] = sha256Hex(s1);
    }

    return {
      leafIndex,
      sk0,
      sk1,
      pk0,
      pk1,
      publicKeyDigest: hashLamportPublicKey(pk0, pk1),
      used: false,
    };
  }

  public getMasterPublicKey(): string {
    return this.merkleLevels[this.merkleLevels.length - 1][0];
  }

  public getRemainingKeys(): number {
    return this.keyCount - this.nextAvailableIndex;
  }

  private buildMerklePath(leafIndex: number): Array<{ direction: 'left' | 'right'; siblingHash: string }> {
    const path: Array<{ direction: 'left' | 'right'; siblingHash: string }> = [];
    let idx = leafIndex;
    for (let lvl = 0; lvl < this.merkleLevels.length - 1; lvl++) {
      const isRight = (idx & 1) === 1;
      const sibIdx = isRight ? idx - 1 : idx + 1;
      path.push({
        direction: isRight ? 'left' : 'right',
        siblingHash: this.merkleLevels[lvl][sibIdx],
      });
      idx >>= 1;
    }
    return path;
  }

  /**
   * Signs `message` using the next unused one-time Lamport leaf key and permanently marks it spent
   * (strict one-time-use enforcement against quantum/classical multi-use key leakage!).
   */
  public signNextOneTime(message: string): LamportSignature {
    if (this.nextAvailableIndex >= this.keyCount) {
      throw new Error('All Merkle-Lamport one-time keys have been exhausted');
    }
    const leafIndex = this.nextAvailableIndex++;
    const kp = this.keys[leafIndex];
    if (kp.used) throw new Error(`One-time key at index ${leafIndex} already spent`);
    kp.used = true;

    const digestBuf = createHash('sha256').update(`WorkSphere::LDOTSMsg|${message}`).digest();
    const messageDigestHex = digestBuf.toString('hex');
    const revealedPreimages: string[] = new Array(256);

    for (let i = 0; i < 256; i++) {
      const bit = getDigestBit(digestBuf, i);
      revealedPreimages[i] = bit === 0 ? kp.sk0[i] : kp.sk1[i];
    }

    const merklePath = this.buildMerklePath(leafIndex);
    const masterRootHash = this.getMasterPublicKey();
    const sigDigest = sha256Hex(`WorkSphere::LDOTSSig|${leafIndex}|${messageDigestHex}|${masterRootHash}`);

    return {
      leafIndex,
      message,
      messageDigestHex,
      revealedPreimages,
      publicKey0: [...kp.pk0],
      publicKey1: [...kp.pk1],
      merklePath,
      masterRootHash,
      sigDigest,
    };
  }

  /**
   * Publicly verifies a post-quantum Merkle-Lamport signature against `expectedMasterRootHash`!
   */
  public verifySignature(
    sig: LamportSignature,
    expectedMasterRootHash: string
  ): { valid: boolean; reason?: string } {
    if (
      sig.revealedPreimages.length !== 256 ||
      sig.publicKey0.length !== 256 ||
      sig.publicKey1.length !== 256
    ) {
      return { valid: false, reason: 'Invalid Lamport signature array dimensions' };
    }

    const digestBuf = createHash('sha256').update(`WorkSphere::LDOTSMsg|${sig.message}`).digest();
    if (digestBuf.toString('hex') !== sig.messageDigestHex) {
      return { valid: false, reason: 'Message digest mismatch' };
    }

    // 1. Verify all 256 revealed SHA-256 preimages against the bit-selected public key halves
    for (let i = 0; i < 256; i++) {
      const bit = getDigestBit(digestBuf, i);
      const expectedPk = bit === 0 ? sig.publicKey0[i] : sig.publicKey1[i];
      if (sha256Hex(sig.revealedPreimages[i]) !== expectedPk) {
        return { valid: false, reason: `Preimage verification failed at bit ${i}` };
      }
    }

    // 2. Verify leaf Lamport public key authenticates up to expectedMasterRootHash
    let curHash = hashLamportPublicKey(sig.publicKey0, sig.publicKey1);
    let reconIdx = 0;
    for (let lvl = 0; lvl < sig.merklePath.length; lvl++) {
      const step = sig.merklePath[lvl];
      if (step.direction === 'left') {
        curHash = hashPair(step.siblingHash, curHash);
        reconIdx |= 1 << lvl;
      } else {
        curHash = hashPair(curHash, step.siblingHash);
      }
    }

    if (reconIdx !== sig.leafIndex) {
      return { valid: false, reason: 'Merkle authentication path index mismatch' };
    }
    if (curHash !== expectedMasterRootHash || sig.masterRootHash !== expectedMasterRootHash) {
      return { valid: false, reason: 'Master Merkle root hash mismatch' };
    }

    return { valid: true };
  }

  /**
   * Audits a batch of Merkle-Lamport signatures and checks for dangerous leaf-index reuse!
   */
  public auditSignatureBatch(
    signatures: readonly LamportSignature[],
    expectedMasterRootHash: string
  ): {
    allValid: boolean;
    reusedLeafIndices: number[];
    invalidIndices: number[];
  } {
    const seenLeaves = new Set<number>();
    const reusedLeafIndices: number[] = [];
    const invalidIndices: number[] = [];

    for (let i = 0; i < signatures.length; i++) {
      const sig = signatures[i];
      if (!this.verifySignature(sig, expectedMasterRootHash).valid) {
        invalidIndices.push(i);
      }
      if (seenLeaves.has(sig.leafIndex)) {
        reusedLeafIndices.push(sig.leafIndex);
      } else {
        seenLeaves.add(sig.leafIndex);
      }
    }

    return {
      allValid: signatures.length > 0 && invalidIndices.length === 0 && reusedLeafIndices.length === 0,
      reusedLeafIndices,
      invalidIndices,
    };
  }

  public serializeSignature(sig: LamportSignature): string {
    return JSON.stringify(sig);
  }

  public deserializeSignature(payload: string): LamportSignature {
    return JSON.parse(payload) as LamportSignature;
  }
}
