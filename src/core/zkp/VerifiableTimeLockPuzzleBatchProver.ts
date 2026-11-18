/**
 * @file VerifiableTimeLockPuzzleBatchProver.ts
 * @description Batched Homomorphic Sequential-Squaring Time-Lock Puzzle Generator & Wesolowski
 * Batch-Proof Verifier (Rivest-Shamir-Wagner + Homomorphic Linear Puzzle Aggregation).
 * Allows N independent clients to lock secrets behind identical delay parameter T modulo N = p*q
 * and combines all N puzzles homomorphically into a SINGLE aggregate puzzle whose solution yields
 * one constant-size Wesolowski proof verifying ALL N time-lock evaluations at once!
 */

import { createHash, randomBytes } from 'node:crypto';

const TLP_PRIME_1 = 0x00c5d3e1f9a7b5c3d1e9f7a5b3c1d9e7n;
const TLP_PRIME_2 = 0x00e7f5a3b1c9d7e5f3a1b9c7d5e3f1a9n;

export interface TimeLockPuzzleItem {
  puzzleId: string;
  baseX: bigint;
  delayT: number;
  ciphertextHex: string;
  macHex: string;
  modulusN: bigint;
}

export interface TimeLockPuzzleSolution {
  puzzleId: string;
  baseX: bigint;
  delayT: number;
  outputY: bigint;
  primeL: bigint;
  proofPi: bigint;
  recoveredPlaintext: string;
}

export interface HomomorphicBatchPuzzleProof {
  batchId: string;
  delayT: number;
  modulusN: bigint;
  puzzleIds: string[];
  basesX: bigint[];
  outputsY: bigint[];
  combinedBaseX: bigint;
  combinedOutputY: bigint;
  challengePrimeL: bigint;
  batchProofPi: bigint;
  batchDigest: string;
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

function nextPrime(start: bigint): bigint {
  let c = start % 2n === 0n ? start + 1n : start;
  while (!isProbablePrime(c)) c += 2n;
  return c;
}

function xorStream(data: Buffer, maskY: bigint, puzzleId: string): Buffer {
  const out = Buffer.alloc(data.length);
  let offset = 0;
  let block = 0;
  while (offset < data.length) {
    const key = createHash('sha256')
      .update(`WorkSphere::TLPStream|${puzzleId}|${maskY.toString(16)}|${block}`)
      .digest();
    for (let i = 0; i < key.length && offset < data.length; i++, offset++) {
      out[offset] = data[offset] ^ key[i];
    }
    block++;
  }
  return out;
}

/**
 * Homomorphic Batched Time-Lock Puzzle & Wesolowski Proof Verification Engine.
 */
export class VerifiableTimeLockPuzzleBatchProver {
  private readonly modulusN: bigint;
  private readonly phiN: bigint;

  constructor() {
    const p = nextPrime(TLP_PRIME_1);
    const q = nextPrime(TLP_PRIME_2);
    this.modulusN = p * q;
    this.phiN = (p - 1n) * (q - 1n);
  }

  public getModulusN(): bigint {
    return this.modulusN;
  }

  private computeMac(puzzleId: string, maskY: bigint, ct: Buffer): string {
    return createHash('sha256')
      .update(`WorkSphere::TLPMac|${puzzleId}|${maskY.toString(16)}|${ct.toString('hex')}`)
      .digest('hex');
  }

  private derivePrimeL(tag: string, baseX: bigint, outputY: bigint, delayT: number): bigint {
    const h = createHash('sha256')
      .update(`WorkSphere::TLPWesolowskiL|${tag}|${baseX.toString(16)}|${outputY.toString(16)}|${delayT}`)
      .digest('hex');
    const cand = BigInt(`0x${h.slice(0, 16)}`) | (1n << 63n) | 1n;
    return nextPrime(cand);
  }

  private computeWesolowskiPi(baseX: bigint, delayT: number, primeL: bigint): bigint {
    let rem = 1n;
    let pi = 1n;
    for (let i = 0; i < delayT; i++) {
      rem <<= 1n;
      const bit = rem >= primeL ? 1n : 0n;
      if (bit === 1n) rem -= primeL;
      pi = (pi * pi) % this.modulusN;
      if (bit === 1n) pi = (pi * baseX) % this.modulusN;
    }
    return pi;
  }

  /**
   * Generates a single time-lock puzzle encrypting `plaintext` with trapdoor fast exponentiation.
   */
  public generatePuzzle(puzzleId: string, plaintext: string, delayT: number): TimeLockPuzzleItem {
    if (!Number.isInteger(delayT) || delayT < 8) {
      throw new RangeError('delayT must be an integer >= 8');
    }
    const raw = (BigInt(`0x${randomBytes(32).toString('hex')}`) % (this.modulusN - 3n)) + 2n;
    const baseX = (raw * raw) % this.modulusN;

    const expModPhi = modPow(2n, BigInt(delayT), this.phiN);
    const maskY = modPow(baseX, expModPhi, this.modulusN);
    const ct = xorStream(Buffer.from(plaintext, 'utf8'), maskY, puzzleId);
    const macHex = this.computeMac(puzzleId, maskY, ct);

    return {
      puzzleId,
      baseX,
      delayT,
      ciphertextHex: ct.toString('hex'),
      macHex,
      modulusN: this.modulusN,
    };
  }

  /**
   * Solves a time-lock puzzle honestly via T sequential squarings (without phi(N)) and produces
   * a succinct Wesolowski proof of correct sequential evaluation.
   */
  public solveAndProvePuzzle(puzzle: TimeLockPuzzleItem): TimeLockPuzzleSolution {
    if (puzzle.modulusN !== this.modulusN) throw new Error('Modulus N mismatch');
    let y = modNorm(puzzle.baseX, this.modulusN);
    for (let i = 0; i < puzzle.delayT; i++) {
      y = (y * y) % this.modulusN;
    }

    const ct = Buffer.from(puzzle.ciphertextHex, 'hex');
    if (this.computeMac(puzzle.puzzleId, y, ct) !== puzzle.macHex) {
      throw new Error('Solved time-lock key failed MAC verification');
    }
    const recoveredPlaintext = xorStream(ct, y, puzzle.puzzleId).toString('utf8');
    const primeL = this.derivePrimeL(puzzle.puzzleId, puzzle.baseX, y, puzzle.delayT);
    const proofPi = this.computeWesolowskiPi(puzzle.baseX, puzzle.delayT, primeL);

    return {
      puzzleId: puzzle.puzzleId,
      baseX: puzzle.baseX,
      delayT: puzzle.delayT,
      outputY: y,
      primeL,
      proofPi,
      recoveredPlaintext,
    };
  }

  public verifySolution(solution: TimeLockPuzzleSolution): boolean {
    const expectedL = this.derivePrimeL(
      solution.puzzleId,
      solution.baseX,
      solution.outputY,
      solution.delayT
    );
    if (expectedL !== solution.primeL) return false;
    const r = modPow(2n, BigInt(solution.delayT), solution.primeL);
    const lhs =
      (modPow(solution.proofPi, solution.primeL, this.modulusN) *
        modPow(solution.baseX, r, this.modulusN)) %
      this.modulusN;
    return lhs === modNorm(solution.outputY, this.modulusN);
  }

  private deriveBatchWeights(
    batchId: string,
    delayT: number,
    basesX: readonly bigint[],
    outputsY: readonly bigint[]
  ): bigint[] {
    const seedH = createHash('sha256');
    seedH.update(`WorkSphere::TLPBatchSeed|${batchId}|T:${delayT}`);
    for (let i = 0; i < basesX.length; i++) {
      seedH.update(`|${basesX[i].toString(16)}:${outputsY[i].toString(16)}`);
    }
    const seed = seedH.digest('hex');

    return basesX.map((_, i) => {
      const hex = createHash('sha256').update(`${seed}|w:${i}`).digest('hex');
      return (BigInt(`0x${hex.slice(0, 12)}`) | 1n);
    });
  }

  /**
   * Homomorphically folds N solved time-lock puzzles sharing delay T into ONE single constant-size
   * Wesolowski batch proof over X_agg = Prod x_i^{w_i} and Y_agg = Prod y_i^{w_i} mod N!
   */
  public aggregateBatchProof(
    batchId: string,
    puzzles: readonly TimeLockPuzzleItem[]
  ): {
    batchProof: HomomorphicBatchPuzzleProof;
    recoveredPlaintexts: Map<string, string>;
  } {
    if (puzzles.length === 0) throw new Error('At least one puzzle is required for batch aggregation');
    const delayT = puzzles[0].delayT;
    for (const pz of puzzles) {
      if (pz.delayT !== delayT || pz.modulusN !== this.modulusN) {
        throw new Error('All puzzles in a homomorphic batch must share delayT and modulusN');
      }
    }

    const puzzleIds: string[] = [];
    const basesX: bigint[] = [];
    const outputsY: bigint[] = [];
    const recoveredPlaintexts = new Map<string, string>();

    for (const pz of puzzles) {
      let y = modNorm(pz.baseX, this.modulusN);
      for (let i = 0; i < delayT; i++) y = (y * y) % this.modulusN;
      const ct = Buffer.from(pz.ciphertextHex, 'hex');
      if (this.computeMac(pz.puzzleId, y, ct) !== pz.macHex) {
        throw new Error(`MAC verification failed for puzzle ${pz.puzzleId}`);
      }
      puzzleIds.push(pz.puzzleId);
      basesX.push(pz.baseX);
      outputsY.push(y);
      recoveredPlaintexts.set(pz.puzzleId, xorStream(ct, y, pz.puzzleId).toString('utf8'));
    }

    const weights = this.deriveBatchWeights(batchId, delayT, basesX, outputsY);
    let combinedBaseX = 1n;
    let combinedOutputY = 1n;
    for (let i = 0; i < puzzles.length; i++) {
      combinedBaseX = (combinedBaseX * modPow(basesX[i], weights[i], this.modulusN)) % this.modulusN;
      combinedOutputY = (combinedOutputY * modPow(outputsY[i], weights[i], this.modulusN)) % this.modulusN;
    }

    const challengePrimeL = this.derivePrimeL(batchId, combinedBaseX, combinedOutputY, delayT);
    const batchProofPi = this.computeWesolowskiPi(combinedBaseX, delayT, challengePrimeL);
    const batchDigest = createHash('sha256')
      .update(`${batchId}|n:${puzzles.length}|T:${delayT}|${combinedOutputY.toString(16)}`)
      .digest('hex');

    return {
      batchProof: {
        batchId,
        delayT,
        modulusN: this.modulusN,
        puzzleIds,
        basesX,
        outputsY,
        combinedBaseX,
        combinedOutputY,
        challengePrimeL,
        batchProofPi,
        batchDigest,
      },
      recoveredPlaintexts,
    };
  }

  /**
   * Publicly verifies ALL N time-lock evaluations in ONE constant-size Wesolowski equation!
   */
  public verifyBatchProof(proof: HomomorphicBatchPuzzleProof): boolean {
    if (proof.modulusN !== this.modulusN || proof.basesX.length === 0 || proof.basesX.length !== proof.outputsY.length) {
      return false;
    }
    const weights = this.deriveBatchWeights(proof.batchId, proof.delayT, proof.basesX, proof.outputsY);
    let expX = 1n;
    let expY = 1n;
    for (let i = 0; i < proof.basesX.length; i++) {
      expX = (expX * modPow(proof.basesX[i], weights[i], this.modulusN)) % this.modulusN;
      expY = (expY * modPow(proof.outputsY[i], weights[i], this.modulusN)) % this.modulusN;
    }
    if (expX !== proof.combinedBaseX || expY !== proof.combinedOutputY) return false;

    const expectedL = this.derivePrimeL(proof.batchId, expX, expY, proof.delayT);
    if (expectedL !== proof.challengePrimeL) return false;

    const r = modPow(2n, BigInt(proof.delayT), proof.challengePrimeL);
    const lhs =
      (modPow(proof.batchProofPi, proof.challengePrimeL, this.modulusN) *
        modPow(expX, r, this.modulusN)) %
      this.modulusN;
    return lhs === expY;
  }

  public serializeBatchProof(proof: HomomorphicBatchPuzzleProof): string {
    return JSON.stringify({
      ...proof,
      modulusN: proof.modulusN.toString(16),
      basesX: proof.basesX.map((x) => x.toString(16)),
      outputsY: proof.outputsY.map((y) => y.toString(16)),
      combinedBaseX: proof.combinedBaseX.toString(16),
      combinedOutputY: proof.combinedOutputY.toString(16),
      challengePrimeL: proof.challengePrimeL.toString(16),
      batchProofPi: proof.batchProofPi.toString(16),
    });
  }

  public deserializeBatchProof(payload: string): HomomorphicBatchPuzzleProof {
    const raw = JSON.parse(payload) as Record<string, any>;
    return {
      ...raw,
      modulusN: BigInt(`0x${raw.modulusN}`),
      basesX: raw.basesX.map((x: string) => BigInt(`0x${x}`)),
      outputsY: raw.outputsY.map((y: string) => BigInt(`0x${y}`)),
      combinedBaseX: BigInt(`0x${raw.combinedBaseX}`),
      combinedOutputY: BigInt(`0x${raw.combinedOutputY}`),
      challengePrimeL: BigInt(`0x${raw.challengePrimeL}`),
      batchProofPi: BigInt(`0x${raw.batchProofPi}`),
    } as HomomorphicBatchPuzzleProof;
  }
}
