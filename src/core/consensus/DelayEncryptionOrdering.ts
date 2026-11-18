/**
 * @file DelayEncryptionOrdering.ts
 * @description Verifiable Delay Encryption & Fair-Ordering Pipeline.
 * Protects decentralized mempools and consensus sequencing from front-running and MEV.
 * Clients seal transactions inside time-lock puzzles parameterized by sequential modular
 * squarings (VDF). Once transaction order is committed by consensus, sequencers compute
 * the time-lock output and generate succinct Wesolowski proofs verifying valid decryption
 * in O(log T) steps.
 */

import { createHash, randomBytes } from 'crypto';

// Standard 1024-bit safe RSA composite modulus N
export const DEFAULT_DELAY_MODULUS = BigInt(
  '0x' +
  'b4a7e713510e751518287960f10f8019eedabb5ae3a0deb1977b3bbc67ded3c5' +
  'b66f289369e7b88b7702808dd433cecc5edc144e82ac60ed31732bf530f69915' +
  '735ac6216e096c98d3b2222329e3b952ac64614e5be2868722eb223a00f91829' +
  '492a342a04e7ad802715e7688e0a15c3848ac9c4d31b2c4516ff712b43b2d5f3'
);

export interface DelayEncryptionParams {
  modulus: bigint;
  delaySteps: number;
}

export interface TimeLockPuzzle {
  inputX: string;
  delaySteps: number;
}

export interface DelayEncryptedPayload {
  txId: string;
  ciphertext: string;
  timeLockPuzzle: TimeLockPuzzle;
  sequenceNumber: number;
  timestamp: number;
}

export interface DelayDecryptionProof {
  txId: string;
  outputY: string;
  proofPi: string;
  challengeL: string;
  decryptedPayload: string;
}

export interface OrderedExecutionResult {
  txId: string;
  sequenceNumber: number;
  decryptedPayload: string;
  verified: boolean;
  reason?: string;
}

export class DelayEncryptionOrdering {
  public readonly modulus: bigint;
  public readonly defaultDelaySteps: number;

  constructor(delaySteps: number = 64, modulus: bigint = DEFAULT_DELAY_MODULUS) {
    if (delaySteps < 1) throw new Error('delaySteps must be at least 1');
    this.defaultDelaySteps = delaySteps;
    this.modulus = modulus;
  }

  /**
   * Modular exponentiation: base^exp mod modulus
   */
  public modPow(base: bigint, exp: bigint, mod: bigint = this.modulus): bigint {
    let res = 1n;
    let b = ((base % mod) + mod) % mod;
    let e = exp;
    while (e > 0n) {
      if (e & 1n) res = (res * b) % mod;
      b = (b * b) % mod;
      e >>= 1n;
    }
    return res;
  }

  /**
   * Deterministically derives a prime challenge L from (u, y) using Fiat-Shamir.
   */
  public derivePrimeChallenge(u: bigint, y: bigint): bigint {
    const hash = createHash('sha256')
      .update(u.toString(16) + ':' + y.toString(16))
      .digest('hex');
    let candidate = (BigInt('0x' + hash) % 0x7fffffffffffffffn) | 1n; // 63-bit odd integer
    while (!this.isPrime(candidate)) {
      candidate += 2n;
    }
    return candidate;
  }

  /**
   * Miller-Rabin primality test.
   */
  private isPrime(n: bigint, k: number = 5): boolean {
    if (n <= 1n) return false;
    if (n <= 3n) return true;
    if ((n & 1n) === 0n) return false;

    let d = n - 1n;
    let s = 0;
    while ((d & 1n) === 0n) {
      d >>= 1n;
      s++;
    }

    const bases = [2n, 3n, 5n, 7n, 11n];
    for (const a of bases) {
      if (a >= n) break;
      let x = this.modPow(a, d, n);
      if (x === 1n || x === n - 1n) continue;

      let composite = true;
      for (let r = 1; r < s; r++) {
        x = (x * x) % n;
        if (x === n - 1n) {
          composite = false;
          break;
        }
      }
      if (composite) return false;
    }
    return true;
  }

  /**
   * Masks / unmasks plaintext using XOR stream derived from key hash.
   */
  private xorMask(inputHex: string, keyScalar: bigint): string {
    const keyBuf = createHash('sha256').update(keyScalar.toString(16)).digest();
    const inBuf = Buffer.from(inputHex, 'utf-8');
    const outBuf = Buffer.alloc(inBuf.length);

    for (let i = 0; i < inBuf.length; i++) {
      outBuf[i] = inBuf[i] ^ keyBuf[i % keyBuf.length];
    }
    return outBuf.toString('hex');
  }

  private xorUnmask(cipherHex: string, keyScalar: bigint): string {
    const keyBuf = createHash('sha256').update(keyScalar.toString(16)).digest();
    const inBuf = Buffer.from(cipherHex, 'hex');
    const outBuf = Buffer.alloc(inBuf.length);

    for (let i = 0; i < inBuf.length; i++) {
      outBuf[i] = inBuf[i] ^ keyBuf[i % keyBuf.length];
    }
    return outBuf.toString('utf-8');
  }

  /**
   * Encrypts plaintext transaction under a time-lock puzzle.
   */
  public encryptPayload(
    txId: string,
    plaintext: string,
    sequenceNumber: number,
    delaySteps?: number
  ): DelayEncryptedPayload {
    const T = delaySteps ?? this.defaultDelaySteps;

    // Pick random base u in Z_N^*
    const randBytes = randomBytes(32);
    const u = (BigInt('0x' + randBytes.toString('hex')) % (this.modulus - 3n)) + 2n;

    // Sequential squaring to compute y = u^{2^T} mod N
    let y = u;
    for (let i = 0; i < T; i++) {
      y = (y * y) % this.modulus;
    }

    const ciphertext = this.xorMask(plaintext, y);

    return {
      txId,
      ciphertext,
      timeLockPuzzle: {
        inputX: u.toString(16),
        delaySteps: T,
      },
      sequenceNumber,
      timestamp: Date.now(),
    };
  }

  /**
   * Sequencer solves time-lock puzzle and generates succinct Wesolowski VDF proof.
   */
  public solveAndProve(payload: DelayEncryptedPayload): DelayDecryptionProof {
    const u = BigInt('0x' + payload.timeLockPuzzle.inputX);
    const T = payload.timeLockPuzzle.delaySteps;

    // Compute y = u^{2^T} mod N
    let y = u;
    for (let i = 0; i < T; i++) {
      y = (y * y) % this.modulus;
    }

    // Derive Fiat-Shamir prime challenge L
    const L = this.derivePrimeChallenge(u, y);

    // Compute quotient q = floor(2^T / L) and proof pi = u^q mod N
    // Long division in base 2 for q = floor(2^T / L)
    let q = 0n;
    let r = 1n; // remainder tracking 2^i mod L
    for (let i = 0; i < T; i++) {
      r <<= 1n;
      let bit = 0n;
      if (r >= L) {
        bit = 1n;
        r -= L;
      }
      q = (q << 1n) | bit;
    }

    const pi = this.modPow(u, q, this.modulus);
    const decryptedPayload = this.xorUnmask(payload.ciphertext, y);

    return {
      txId: payload.txId,
      outputY: y.toString(16),
      proofPi: pi.toString(16),
      challengeL: L.toString(16),
      decryptedPayload,
    };
  }

  /**
   * Verifies Wesolowski VDF proof and executes transaction in O(log T) steps.
   */
  public verifyAndExecute(
    payload: DelayEncryptedPayload,
    proof: DelayDecryptionProof
  ): OrderedExecutionResult {
    if (payload.txId !== proof.txId) {
      return { txId: payload.txId, sequenceNumber: payload.sequenceNumber, decryptedPayload: '', verified: false, reason: 'Transaction ID mismatch' };
    }

    const u = BigInt('0x' + payload.timeLockPuzzle.inputX);
    const y = BigInt('0x' + proof.outputY);
    const pi = BigInt('0x' + proof.proofPi);
    const L = BigInt('0x' + proof.challengeL);
    const T = BigInt(payload.timeLockPuzzle.delaySteps);

    // 1. Verify Fiat-Shamir challenge L
    const expectedL = this.derivePrimeChallenge(u, y);
    if (L !== expectedL) {
      return { txId: payload.txId, sequenceNumber: payload.sequenceNumber, decryptedPayload: '', verified: false, reason: 'Challenge L mismatch' };
    }

    // 2. Compute r = 2^T mod L
    const r = this.modPow(2n, T, L);

    // 3. Verify algebraic identity: pi^L * u^r == y (mod N)
    const piPowL = this.modPow(pi, L, this.modulus);
    const uPowR = this.modPow(u, r, this.modulus);
    const lhs = (piPowL * uPowR) % this.modulus;

    if (lhs !== y) {
      return { txId: payload.txId, sequenceNumber: payload.sequenceNumber, decryptedPayload: '', verified: false, reason: 'VDF verification identity check failed' };
    }

    // 4. Verify decrypted payload matches ciphertext unmask
    const reconstructedPlaintext = this.xorUnmask(payload.ciphertext, y);
    if (reconstructedPlaintext !== proof.decryptedPayload) {
      return { txId: payload.txId, sequenceNumber: payload.sequenceNumber, decryptedPayload: '', verified: false, reason: 'Decrypted payload mismatch' };
    }

    return {
      txId: payload.txId,
      sequenceNumber: payload.sequenceNumber,
      decryptedPayload: proof.decryptedPayload,
      verified: true,
    };
  }

  /**
   * Processes a sequenced batch ensuring strictly monotonic order and proof validity.
   */
  public processOrderedBatch(
    payloads: DelayEncryptedPayload[],
    proofs: DelayDecryptionProof[]
  ): OrderedExecutionResult[] {
    if (payloads.length !== proofs.length) {
      throw new Error('Batch payload and proof count mismatch');
    }

    const proofMap = new Map<string, DelayDecryptionProof>(proofs.map((p) => [p.txId, p]));
    const sortedPayloads = [...payloads].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    const results: OrderedExecutionResult[] = [];
    let lastSeq = -1;

    for (const payload of sortedPayloads) {
      if (payload.sequenceNumber <= lastSeq) {
        results.push({
          txId: payload.txId,
          sequenceNumber: payload.sequenceNumber,
          decryptedPayload: '',
          verified: false,
          reason: 'Non-monotonic sequence number detected in batch',
        });
        continue;
      }
      lastSeq = payload.sequenceNumber;

      const proof = proofMap.get(payload.txId);
      if (!proof) {
        results.push({
          txId: payload.txId,
          sequenceNumber: payload.sequenceNumber,
          decryptedPayload: '',
          verified: false,
          reason: 'Missing decryption proof for transaction',
        });
        continue;
      }

      results.push(this.verifyAndExecute(payload, proof));
    }

    return results;
  }
}
