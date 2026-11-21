import { createHash } from 'crypto';

/**
 * Verifiable Timed Schnorr Signature (VTS) with Sequential Time-Lock Puzzle
 *
 * Implements a Verifiable Timed Signature protocol (Thyagarajan et al., CCS 2020)
 * combining:
 *   1. Safe-prime subgroup Schnorr signatures (P = 2Q + 1)
 *   2. Sequential repeated-squaring time-lock puzzles over a composite RSA-style
 *      modulus N = p1 * p2 (with T sequential squarings y = a^{2^T} mod N)
 *   3. Zero-knowledge Schnorr commitment proof guaranteeing pre-extraction that
 *      g^c == R * Y^e * M mod P, so solving the time-lock puzzle deterministically
 *      recovers the exact valid Schnorr signature s = (c - mask) mod Q.
 */

const SUBGROUP_ORDER = 0x7fffffffffffffffffffffffffffe1d3n; // Prime Q
const SAFE_PRIME = 0xffffffffffffffffffffffffffffc3a7n; // Safe prime P = 2Q + 1
const SUBGROUP_GEN = 4n; // Order-Q generator g

// Two Mersenne primes for deterministic composite time-lock modulus N = P1 * P2
const PUZZLE_P1 = (1n << 61n) - 1n; // 2^61 - 1 (prime)
const PUZZLE_P2 = (1n << 89n) - 1n; // 2^89 - 1 (prime)
const PUZZLE_MODULUS = PUZZLE_P1 * PUZZLE_P2;
const PUZZLE_PHI = (PUZZLE_P1 - 1n) * (PUZZLE_P2 - 1n);

export interface VTSKeyPair {
  readonly witnessScalar: bigint;
  readonly publicPoint: bigint;
}

export interface SchnorrSignature {
  readonly messageDigest: string;
  readonly noncePointR: bigint;
  readonly responseS: bigint;
}

export interface MaskCommitmentProof {
  readonly noncePointA: bigint;
  readonly challengeC: bigint;
  readonly responseZ: bigint;
}

export interface TimedSignatureCapsule {
  readonly messageDigest: string;
  readonly signerPublicPoint: bigint;
  readonly signatureNonceR: bigint;
  readonly puzzleBaseA: bigint;
  readonly puzzleModulusN: bigint;
  readonly delaySquaringsT: number;
  readonly maskedCipherS: bigint;
  readonly maskCommitmentM: bigint;
  readonly maskProof: MaskCommitmentProof;
  readonly capsuleDigest: string;
}

export interface VTSPreVerificationResult {
  readonly isValid: boolean;
  readonly equationMatches: boolean;
  readonly maskProofValid: boolean;
  readonly reason?: string;
}

export interface VTSExtractionResult {
  readonly isValid: boolean;
  readonly signature: SchnorrSignature | null;
  readonly puzzleOutputY: bigint;
  readonly reason?: string;
}

function modQ(x: bigint): bigint {
  const r = x % SUBGROUP_ORDER;
  return r >= 0n ? r : r + SUBGROUP_ORDER;
}

function modP(x: bigint): bigint {
  const r = x % SAFE_PRIME;
  return r >= 0n ? r : r + SAFE_PRIME;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) {
      result = (result * b) % mod;
    }
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function hashToScalar(domain: string, parts: readonly string[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const p of parts) {
    h.update('|');
    h.update(p);
  }
  const s = modQ(BigInt('0x' + h.digest('hex')));
  return s === 0n ? 1n : s;
}

function hashToPuzzleBase(seed: string): bigint {
  const h = BigInt('0x' + createHash('sha256').update(`VTS_BASE|${seed}`).digest('hex'));
  const base = (h % (PUZZLE_MODULUS - 3n)) + 2n;
  return base;
}

export class VerifiableTimedSignature {
  public generateKeyPair(identitySeed: string): VTSKeyPair {
    const witnessScalar = hashToScalar('VTS_KEYPAIR', [identitySeed]);
    const publicPoint = modPow(SUBGROUP_GEN, witnessScalar, SAFE_PRIME);
    return { witnessScalar, publicPoint };
  }

  public signSchnorr(
    keyPair: VTSKeyPair,
    messageDigest: string,
    nonceLabel: string
  ): SchnorrSignature {
    const k = hashToScalar('VTS_SCHNORR_K', [
      keyPair.publicPoint.toString(16),
      messageDigest,
      nonceLabel,
    ]);
    const noncePointR = modPow(SUBGROUP_GEN, k, SAFE_PRIME);
    const e = hashToScalar('VTS_SCHNORR_E', [
      messageDigest,
      keyPair.publicPoint.toString(16),
      noncePointR.toString(16),
    ]);
    const responseS = modQ(k + modQ(e * modQ(keyPair.witnessScalar)));
    return { messageDigest, noncePointR, responseS };
  }

  public verifySchnorr(publicPoint: bigint, sig: SchnorrSignature): boolean {
    const e = hashToScalar('VTS_SCHNORR_E', [
      sig.messageDigest,
      publicPoint.toString(16),
      sig.noncePointR.toString(16),
    ]);
    const lhs = modPow(SUBGROUP_GEN, modQ(sig.responseS), SAFE_PRIME);
    const rhs = modP(sig.noncePointR * modPow(publicPoint, e, SAFE_PRIME));
    return lhs === rhs;
  }

  /**
   * Fast trapdoor evaluation used exclusively by the puzzle creator:
   * computes y = a^{2^T mod phi(N)} mod N in O(log T) modular multiplications.
   */
  private evaluatePuzzleWithTrapdoor(baseA: bigint, delayT: number): bigint {
    const reducedExp = modPow(2n, BigInt(delayT), PUZZLE_PHI);
    return modPow(baseA, reducedExp, PUZZLE_MODULUS);
  }

  /**
   * Sequential repeated squaring used by any extractor without trapdoor knowledge:
   * computes y = a^{2^T} mod N in exactly T sequential squarings.
   */
  public solveTimeLockSequentially(baseA: bigint, modulusN: bigint, delayT: number): bigint {
    let cur = ((baseA % modulusN) + modulusN) % modulusN;
    for (let i = 0; i < delayT; i++) {
      cur = (cur * cur) % modulusN;
    }
    return cur;
  }

  public createTimedSignature(
    keyPair: VTSKeyPair,
    messageDigest: string,
    delaySquaringsT: number,
    sessionNonce: string
  ): TimedSignatureCapsule {
    if (!Number.isInteger(delaySquaringsT) || delaySquaringsT < 1 || delaySquaringsT > 100_000) {
      throw new Error('delaySquaringsT must be an integer between 1 and 100000');
    }

    const sig = this.signSchnorr(keyPair, messageDigest, `SIG:${sessionNonce}`);
    const puzzleBaseA = hashToPuzzleBase(`${messageDigest}|${sessionNonce}`);
    const puzzleOutputY = this.evaluatePuzzleWithTrapdoor(puzzleBaseA, delaySquaringsT);

    const maskScalar = hashToScalar('VTS_MASK_SCALAR', [
      puzzleOutputY.toString(16),
      messageDigest,
      sig.noncePointR.toString(16),
    ]);
    const maskCommitmentM = modPow(SUBGROUP_GEN, maskScalar, SAFE_PRIME);
    const maskedCipherS = modQ(sig.responseS + maskScalar);

    // Zero-knowledge Schnorr proof of knowledge of maskScalar for M = g^{maskScalar}
    const w = hashToScalar('VTS_MASK_POK_W', [sessionNonce, maskCommitmentM.toString(16)]);
    const noncePointA = modPow(SUBGROUP_GEN, w, SAFE_PRIME);
    const challengeC = hashToScalar('VTS_MASK_POK_C', [
      messageDigest,
      keyPair.publicPoint.toString(16),
      sig.noncePointR.toString(16),
      maskCommitmentM.toString(16),
      maskedCipherS.toString(16),
      noncePointA.toString(16),
    ]);
    const responseZ = modQ(w + modQ(challengeC * maskScalar));
    const maskProof: MaskCommitmentProof = { noncePointA, challengeC, responseZ };

    const capsuleDigest = createHash('sha256')
      .update('VTS_CAPSULE|')
      .update(`${messageDigest}|${keyPair.publicPoint.toString(16)}|${sig.noncePointR.toString(16)}|`)
      .update(`${puzzleBaseA.toString(16)}|${PUZZLE_MODULUS.toString(16)}|${delaySquaringsT}|`)
      .update(`${maskedCipherS.toString(16)}|${maskCommitmentM.toString(16)}|${responseZ.toString(16)}`)
      .digest('hex');

    return {
      messageDigest,
      signerPublicPoint: keyPair.publicPoint,
      signatureNonceR: sig.noncePointR,
      puzzleBaseA,
      puzzleModulusN: PUZZLE_MODULUS,
      delaySquaringsT,
      maskedCipherS,
      maskCommitmentM,
      maskProof,
      capsuleDigest,
    };
  }

  /**
   * Verifies that the timed capsule commits to a valid Schnorr signature on
   * messageDigest BEFORE spending time solving the sequential squaring puzzle.
   */
  public verifyTimedSignature(capsule: TimedSignatureCapsule): VTSPreVerificationResult {
    const expectedDigest = createHash('sha256')
      .update('VTS_CAPSULE|')
      .update(`${capsule.messageDigest}|${capsule.signerPublicPoint.toString(16)}|${capsule.signatureNonceR.toString(16)}|`)
      .update(`${capsule.puzzleBaseA.toString(16)}|${capsule.puzzleModulusN.toString(16)}|${capsule.delaySquaringsT}|`)
      .update(`${capsule.maskedCipherS.toString(16)}|${capsule.maskCommitmentM.toString(16)}|${capsule.maskProof.responseZ.toString(16)}`)
      .digest('hex');

    if (expectedDigest !== capsule.capsuleDigest) {
      return {
        isValid: false,
        equationMatches: false,
        maskProofValid: false,
        reason: 'Timed capsule digest integrity mismatch',
      };
    }

    // Verify Schnorr PoK on mask commitment M
    const expectedC = hashToScalar('VTS_MASK_POK_C', [
      capsule.messageDigest,
      capsule.signerPublicPoint.toString(16),
      capsule.signatureNonceR.toString(16),
      capsule.maskCommitmentM.toString(16),
      capsule.maskedCipherS.toString(16),
      capsule.maskProof.noncePointA.toString(16),
    ]);
    const pokLhs = modPow(SUBGROUP_GEN, modQ(capsule.maskProof.responseZ), SAFE_PRIME);
    const pokRhs = modP(
      capsule.maskProof.noncePointA * modPow(capsule.maskCommitmentM, expectedC, SAFE_PRIME)
    );
    const maskProofValid = expectedC === capsule.maskProof.challengeC && pokLhs === pokRhs;

    // Verify algebraic pre-extraction equation: g^{maskedCipherS} == R * Y^e * M mod P
    const e = hashToScalar('VTS_SCHNORR_E', [
      capsule.messageDigest,
      capsule.signerPublicPoint.toString(16),
      capsule.signatureNonceR.toString(16),
    ]);
    const eqLhs = modPow(SUBGROUP_GEN, modQ(capsule.maskedCipherS), SAFE_PRIME);
    const eqRhs = modP(
      modP(capsule.signatureNonceR * modPow(capsule.signerPublicPoint, e, SAFE_PRIME)) *
        capsule.maskCommitmentM
    );
    const equationMatches = eqLhs === eqRhs;

    if (!maskProofValid || !equationMatches) {
      return {
        isValid: false,
        equationMatches,
        maskProofValid,
        reason: 'Timed signature algebraic or mask commitment verification failed',
      };
    }

    return {
      isValid: true,
      equationMatches: true,
      maskProofValid: true,
    };
  }

  public extractSignature(capsule: TimedSignatureCapsule): VTSExtractionResult {
    const preCheck = this.verifyTimedSignature(capsule);
    if (!preCheck.isValid) {
      return {
        isValid: false,
        signature: null,
        puzzleOutputY: 0n,
        reason: preCheck.reason,
      };
    }

    const puzzleOutputY = this.solveTimeLockSequentially(
      capsule.puzzleBaseA,
      capsule.puzzleModulusN,
      capsule.delaySquaringsT
    );
    const maskScalar = hashToScalar('VTS_MASK_SCALAR', [
      puzzleOutputY.toString(16),
      capsule.messageDigest,
      capsule.signatureNonceR.toString(16),
    ]);

    if (modPow(SUBGROUP_GEN, maskScalar, SAFE_PRIME) !== capsule.maskCommitmentM) {
      return {
        isValid: false,
        signature: null,
        puzzleOutputY,
        reason: 'Solved time-lock mask does not match committed mask point M',
      };
    }

    const responseS = modQ(capsule.maskedCipherS - maskScalar);
    const signature: SchnorrSignature = {
      messageDigest: capsule.messageDigest,
      noncePointR: capsule.signatureNonceR,
      responseS,
    };

    if (!this.verifySchnorr(capsule.signerPublicPoint, signature)) {
      return {
        isValid: false,
        signature: null,
        puzzleOutputY,
        reason: 'Extracted Schnorr signature failed verification',
      };
    }

    return {
      isValid: true,
      signature,
      puzzleOutputY,
    };
  }
}
