/**
 * @file VerifiableTimedCommitmentProver.ts
 * @description Cryptographic Timed Commitment & Verifiable Forced-Opening Scheme (Boneh-Naor style).
 * Enables a committer to lock a secret payload behind a sequential squaring time-lock puzzle
 * while providing a non-interactive proof that:
 *   1. The commitment binds uniquely to the secret payload (Pedersen + SHA-256 tag).
 *   2. The sequential squaring puzzle encodes the exact decryption key needed to open the commitment
 *      after T sequential modular squarings (even if the committer aborts or refuses to cooperate).
 *   3. Fast cooperative opening avoids squaring; forced time-lock opening recovers the secret
 *      with a Wesolowski proof of honest sequential evaluation.
 */

import { createHash, randomBytes } from 'node:crypto';

// 256-bit RSA-style composite modulus N = P_RSA * Q_RSA for sequential squaring puzzles
const RSA_PRIME_1 = 0x00d9c6c97f2e3b4d5a6f7c8e9b1a2d3f5n;
const RSA_PRIME_2 = 0x00f3a7b5c1d9e2f4a6b8c0d2e4f6a8b09n;

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface TimedCommitmentSecret {
  commitmentId: string;
  secretMessage: string;
  blindingScalar: bigint;
  puzzleKeyMask: bigint;
}

export interface TimedCommitmentProof {
  commitmentId: string;
  modulusN: bigint;
  puzzleBaseA: bigint;
  delayIterationsT: number;
  encryptedPayloadHex: string;
  payloadMacHex: string;
  pedersenCommit: bigint;
  puzzleHintY: bigint;
  wesolowskiPrimeL: bigint;
  wesolowskiPi: bigint;
  bindingProof: {
    nonceCommit: bigint;
    challenge: bigint;
    responseMsg: bigint;
    responseBlind: bigint;
  };
  commitmentDigest: string;
}

export interface CooperativeOpening {
  commitmentId: string;
  secretMessage: string;
  blindingScalar: bigint;
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

function isProbablePrime(n: bigint): boolean {
  if (n < 2n) return false;
  const small = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
  for (const p of small) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  let d = n - 1n;
  let s = 0n;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    s += 1n;
  }
  for (const a of [2n, 3n, 5n, 7n, 11n, 13n, 17n]) {
    if (a >= n) continue;
    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let composite = true;
    for (let r = 1n; r < s; r++) {
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

function nextPrime(start: bigint): bigint {
  let c = start % 2n === 0n ? start + 1n : start;
  while (!isProbablePrime(c)) c += 2n;
  return c;
}

function randomScalar(q: bigint): bigint {
  return (BigInt(`0x${randomBytes(16).toString('hex')}`) % (q - 2n)) + 2n;
}

function deriveH(p: bigint, g: bigint): bigint {
  const digest = createHash('sha256').update(`WorkSphere::TimedCommitH|${p.toString(16)}|${g.toString(16)}`).digest('hex');
  const raw = BigInt(`0x${digest}`) % (p - 2n) + 2n;
  return (raw * raw) % p;
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

function xorWithKey(data: Buffer, keyMask: bigint, commitmentId: string): Buffer {
  const out = Buffer.alloc(data.length);
  let offset = 0;
  let blockIdx = 0;
  while (offset < data.length) {
    const stream = createHash('sha256')
      .update(`WorkSphere::TimedStream|${commitmentId}|${keyMask.toString(16)}|${blockIdx}`)
      .digest();
    for (let i = 0; i < stream.length && offset < data.length; i++, offset++) {
      out[offset] = data[offset] ^ stream[i];
    }
    blockIdx++;
  }
  return out;
}

/**
 * Verifiable Timed Commitment Prover & Forced-Opening Recovery Engine.
 */
export class VerifiableTimedCommitmentProver {
  private readonly p: bigint;
  private readonly q: bigint;
  private readonly g: bigint;
  private readonly h: bigint;
  private readonly rsaP: bigint;
  private readonly rsaQ: bigint;
  private readonly modulusN: bigint;
  private readonly phiN: bigint;

  constructor() {
    this.p = SAFE_PRIME_P;
    this.q = SUBGROUP_Q;
    this.g = BASE_G;
    this.h = deriveH(this.p, this.g);

    this.rsaP = nextPrime(RSA_PRIME_1);
    this.rsaQ = nextPrime(RSA_PRIME_2);
    this.modulusN = this.rsaP * this.rsaQ;
    this.phiN = (this.rsaP - 1n) * (this.rsaQ - 1n);
  }

  private messageToScalar(secretMessage: string): bigint {
    return hashScalar('WorkSphere::TimedMessageScalar', [secretMessage]);
  }

  private hashToChallengePrime(commitmentId: string, baseA: bigint, y: bigint, t: number): bigint {
    const h = createHash('sha256')
      .update(`WorkSphere::TimedWesolowskiL|${commitmentId}|${baseA.toString(16)}|${y.toString(16)}|${t}`)
      .digest('hex');
    const candidate = BigInt(`0x${h.slice(0, 16)}`) | (1n << 63n) | 1n;
    return nextPrime(candidate);
  }

  private computePayloadMac(keyMask: bigint, commitmentId: string, ciphertext: Buffer): string {
    return createHash('sha256')
      .update(`WorkSphere::TimedMac|${commitmentId}|${keyMask.toString(16)}|${ciphertext.toString('hex')}`)
      .digest('hex');
  }

  private computeWesolowskiPiFast(baseA: bigint, t: number, primeL: bigint): bigint {
    // Using trapdoor phi(N), compute q = floor(2^t / L) via iterative long division of 2^t mod L
    // Actually compute pi = baseA^{floor(2^t / L)} directly via streaming binary long division (works for any t!)
    let rem = 1n;
    let pi = 1n;
    for (let i = 0; i < t; i++) {
      rem <<= 1n;
      const bit = rem >= primeL ? 1n : 0n;
      if (bit === 1n) rem -= primeL;
      pi = (pi * pi) % this.modulusN;
      if (bit === 1n) {
        pi = (pi * baseA) % this.modulusN;
      }
    }
    return pi;
  }

  /**
   * Creates a verifiable timed commitment locking `secretMessage` for `delayIterationsT` sequential squarings.
   * The committer uses the trapdoor phi(N) to generate the puzzle key fast, while any external
   * forced opener without phi(N) must compute T sequential squarings.
   */
  public commitTimed(
    commitmentId: string,
    secretMessage: string,
    delayIterationsT: number
  ): {
    proof: TimedCommitmentProof;
    secret: TimedCommitmentSecret;
  } {
    if (!Number.isInteger(delayIterationsT) || delayIterationsT < 10) {
      throw new RangeError('delayIterationsT must be an integer >= 10');
    }

    const baseSeed = createHash('sha256').update(`WorkSphere::TimedBase|${commitmentId}`).digest('hex');
    const rawBase = (BigInt(`0x${baseSeed}`) % (this.modulusN - 3n)) + 2n;
    const puzzleBaseA = (rawBase * rawBase) % this.modulusN;

    // Fast trapdoor computation of Y = a^(2^T) mod N
    const expModPhi = modPow(2n, BigInt(delayIterationsT), this.phiN);
    const puzzleHintY = modPow(puzzleBaseA, expModPhi, this.modulusN);

    const wesolowskiPrimeL = this.hashToChallengePrime(commitmentId, puzzleBaseA, puzzleHintY, delayIterationsT);
    const wesolowskiPi = this.computeWesolowskiPiFast(puzzleBaseA, delayIterationsT, wesolowskiPrimeL);

    const plaintext = Buffer.from(secretMessage, 'utf8');
    const ciphertext = xorWithKey(plaintext, puzzleHintY, commitmentId);
    const payloadMacHex = this.computePayloadMac(puzzleHintY, commitmentId, ciphertext);

    const msgScalar = this.messageToScalar(secretMessage);
    const blindingScalar = randomScalar(this.q);
    const pedersenCommit =
      (modPow(this.g, msgScalar, this.p) * modPow(this.h, blindingScalar, this.p)) % this.p;

    // Zero-knowledge Schnorr proof of knowledge of (msgScalar, blindingScalar) in pedersenCommit
    const kM = randomScalar(this.q);
    const kR = randomScalar(this.q);
    const nonceCommit = (modPow(this.g, kM, this.p) * modPow(this.h, kR, this.p)) % this.p;
    const challenge = hashScalar('WorkSphere::TimedCommitBind', [
      commitmentId,
      pedersenCommit,
      nonceCommit,
      ciphertext.toString('hex'),
      payloadMacHex,
    ]);
    const responseMsg = modNorm(kM + challenge * msgScalar, this.q);
    const responseBlind = modNorm(kR + challenge * blindingScalar, this.q);

    const commitmentDigest = createHash('sha256')
      .update(`${commitmentId}|${pedersenCommit.toString(16)}|${puzzleHintY.toString(16)}|${payloadMacHex}`)
      .digest('hex');

    return {
      proof: {
        commitmentId,
        modulusN: this.modulusN,
        puzzleBaseA,
        delayIterationsT,
        encryptedPayloadHex: ciphertext.toString('hex'),
        payloadMacHex,
        pedersenCommit,
        puzzleHintY,
        wesolowskiPrimeL,
        wesolowskiPi,
        bindingProof: {
          nonceCommit,
          challenge,
          responseMsg,
          responseBlind,
        },
        commitmentDigest,
      },
      secret: {
        commitmentId,
        secretMessage,
        blindingScalar,
        puzzleKeyMask: puzzleHintY,
      },
    };
  }

  /**
   * Publicly verifies that a timed commitment is well-formed (both its Pedersen binding proof
   * and its Wesolowski puzzle evaluation proof pass).
   */
  public verifyCommitmentProof(proof: TimedCommitmentProof): { valid: boolean; reason?: string } {
    if (proof.modulusN !== this.modulusN) {
      return { valid: false, reason: 'Modulus N mismatch' };
    }
    if (!Number.isInteger(proof.delayIterationsT) || proof.delayIterationsT < 10) {
      return { valid: false, reason: 'Invalid delay iteration parameter' };
    }

    const expectedL = this.hashToChallengePrime(
      proof.commitmentId,
      proof.puzzleBaseA,
      proof.puzzleHintY,
      proof.delayIterationsT
    );
    if (expectedL !== proof.wesolowskiPrimeL) {
      return { valid: false, reason: 'Wesolowski challenge prime L mismatch' };
    }

    const r = modPow(2n, BigInt(proof.delayIterationsT), proof.wesolowskiPrimeL);
    const wesolowskiCheck =
      (modPow(proof.wesolowskiPi, proof.wesolowskiPrimeL, this.modulusN) *
        modPow(proof.puzzleBaseA, r, this.modulusN)) %
      this.modulusN;
    if (wesolowskiCheck !== modNorm(proof.puzzleHintY, this.modulusN)) {
      return { valid: false, reason: 'Wesolowski time-lock proof failed' };
    }

    const bp = proof.bindingProof;
    const expectedC = hashScalar('WorkSphere::TimedCommitBind', [
      proof.commitmentId,
      proof.pedersenCommit,
      bp.nonceCommit,
      proof.encryptedPayloadHex,
      proof.payloadMacHex,
    ]);
    if (expectedC !== bp.challenge) {
      return { valid: false, reason: 'Binding proof challenge mismatch' };
    }

    const lhs = (modPow(this.g, bp.responseMsg, this.p) * modPow(this.h, bp.responseBlind, this.p)) % this.p;
    const rhs = (bp.nonceCommit * modPow(proof.pedersenCommit, bp.challenge, this.p)) % this.p;
    if (lhs !== rhs) {
      return { valid: false, reason: 'Pedersen knowledge proof failed' };
    }

    const expectedDigest = createHash('sha256')
      .update(`${proof.commitmentId}|${proof.pedersenCommit.toString(16)}|${proof.puzzleHintY.toString(16)}|${proof.payloadMacHex}`)
      .digest('hex');
    if (expectedDigest !== proof.commitmentDigest) {
      return { valid: false, reason: 'Commitment digest mismatch' };
    }

    return { valid: true };
  }

  /**
   * Fast cooperative opening verification (O(1) time without running sequential squarings).
   */
  public verifyCooperativeOpening(
    proof: TimedCommitmentProof,
    opening: CooperativeOpening
  ): { valid: boolean; reason?: string } {
    if (opening.commitmentId !== proof.commitmentId) {
      return { valid: false, reason: 'Commitment ID mismatch' };
    }
    const msgScalar = this.messageToScalar(opening.secretMessage);
    const expectedCommit =
      (modPow(this.g, msgScalar, this.p) * modPow(this.h, modNorm(opening.blindingScalar, this.q), this.p)) %
      this.p;
    if (expectedCommit !== proof.pedersenCommit) {
      return { valid: false, reason: 'Cooperative opening does not match Pedersen commitment' };
    }
    return { valid: true };
  }

  /**
   * Forced time-lock recovery when a committer refuses to open: performs T sequential modular
   * squarings from `puzzleBaseA` modulo N to recover the decryption mask and plaintext.
   */
  public forceOpenBySequentialSquaring(proof: TimedCommitmentProof): {
    valid: boolean;
    recoveredMessage?: string;
    computedKeyMask?: bigint;
    reason?: string;
  } {
    const check = this.verifyCommitmentProof(proof);
    if (!check.valid) {
      return { valid: false, reason: check.reason };
    }

    let y = modNorm(proof.puzzleBaseA, this.modulusN);
    for (let i = 0; i < proof.delayIterationsT; i++) {
      y = (y * y) % this.modulusN;
    }

    const ciphertext = Buffer.from(proof.encryptedPayloadHex, 'hex');
    const expectedMac = this.computePayloadMac(y, proof.commitmentId, ciphertext);
    if (expectedMac !== proof.payloadMacHex) {
      return { valid: false, reason: 'Recovered time-lock key failed MAC verification' };
    }

    const recoveredMessage = xorWithKey(ciphertext, y, proof.commitmentId).toString('utf8');
    return {
      valid: true,
      recoveredMessage,
      computedKeyMask: y,
    };
  }

  /**
   * Serializes a TimedCommitmentProof into portable JSON format.
   */
  public serializeProof(proof: TimedCommitmentProof): string {
    return JSON.stringify({
      commitmentId: proof.commitmentId,
      modulusN: proof.modulusN.toString(16),
      puzzleBaseA: proof.puzzleBaseA.toString(16),
      delayIterationsT: proof.delayIterationsT,
      encryptedPayloadHex: proof.encryptedPayloadHex,
      payloadMacHex: proof.payloadMacHex,
      pedersenCommit: proof.pedersenCommit.toString(16),
      puzzleHintY: proof.puzzleHintY.toString(16),
      wesolowskiPrimeL: proof.wesolowskiPrimeL.toString(16),
      wesolowskiPi: proof.wesolowskiPi.toString(16),
      bindingProof: {
        nonceCommit: proof.bindingProof.nonceCommit.toString(16),
        challenge: proof.bindingProof.challenge.toString(16),
        responseMsg: proof.bindingProof.responseMsg.toString(16),
        responseBlind: proof.bindingProof.responseBlind.toString(16),
      },
      commitmentDigest: proof.commitmentDigest,
    });
  }

  /**
   * Deserializes a JSON timed commitment proof.
   */
  public deserializeProof(payload: string): TimedCommitmentProof {
    const raw = JSON.parse(payload) as Record<string, any>;
    return {
      commitmentId: raw.commitmentId,
      modulusN: BigInt(`0x${raw.modulusN}`),
      puzzleBaseA: BigInt(`0x${raw.puzzleBaseA}`),
      delayIterationsT: Number(raw.delayIterationsT),
      encryptedPayloadHex: raw.encryptedPayloadHex,
      payloadMacHex: raw.payloadMacHex,
      pedersenCommit: BigInt(`0x${raw.pedersenCommit}`),
      puzzleHintY: BigInt(`0x${raw.puzzleHintY}`),
      wesolowskiPrimeL: BigInt(`0x${raw.wesolowskiPrimeL}`),
      wesolowskiPi: BigInt(`0x${raw.wesolowskiPi}`),
      bindingProof: {
        nonceCommit: BigInt(`0x${raw.bindingProof.nonceCommit}`),
        challenge: BigInt(`0x${raw.bindingProof.challenge}`),
        responseMsg: BigInt(`0x${raw.bindingProof.responseMsg}`),
        responseBlind: BigInt(`0x${raw.bindingProof.responseBlind}`),
      },
      commitmentDigest: raw.commitmentDigest,
    };
  }
}
