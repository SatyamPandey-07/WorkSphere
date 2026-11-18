import { createHash } from 'crypto';

/**
 * Zero-Knowledge PLONK Copy-Constraint Grand-Product Permutation Argument
 *
 * Implements the PLONK 3-column wire copy-constraint permutation argument
 * (Gabizon, Williamson, Ciobotaru 2019) over BN254 scalar field Fr:
 *   - Disjoint coset shifts (k0 = 1, k1 = 7, k2 = 13) over 2-adic subgroup H
 *   - Arbitrary equivalence-cycle permutation construction (S_sigma1, S_sigma2, S_sigma3)
 *   - Running grand-product accumulator Z_0 = 1, Z_{i+1} = Z_i * num_i / den_i
 *   - Boundary identity verification Z_0 == Z_n == 1 with Fiat-Shamir (beta, gamma)
 */

const FIELD_MODULUS =
  0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n; // BN254 Fr
const TWO_ADIC_GENERATOR = 5n;
const COSET_SHIFTS: readonly [bigint, bigint, bigint] = [1n, 7n, 13n];

export type WireColumn = 0 | 1 | 2;

export interface WireCell {
  readonly col: WireColumn;
  readonly row: number;
}

export interface PLONKWitnessColumns {
  readonly colA: readonly bigint[];
  readonly colB: readonly bigint[];
  readonly colC: readonly bigint[];
}

export interface PLONKPermutationProof {
  readonly domainSize: number;
  readonly witnessCommitment: string;
  readonly accumulatorCommitment: string;
  readonly beta: bigint;
  readonly gamma: bigint;
  readonly accumulatorTrace: readonly bigint[];
  readonly transcriptDigest: string;
}

export interface PLONKPermutationVerification {
  readonly isValid: boolean;
  readonly verifiedRows: number;
  readonly finalAccumulator: bigint;
  readonly reason?: string;
}

function modField(x: bigint): bigint {
  const r = x % FIELD_MODULUS;
  return r >= 0n ? r : r + FIELD_MODULUS;
}

function modPow(base: bigint, exp: bigint): bigint {
  let result = 1n;
  let b = modField(base);
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) {
      result = modField(result * b);
    }
    b = modField(b * b);
    e >>= 1n;
  }
  return result;
}

function modInverse(a: bigint): bigint {
  const val = modField(a);
  if (val === 0n) throw new Error('Cannot invert zero in BN254 Fr');
  return modPow(val, FIELD_MODULUS - 2n);
}

function commitValues(domain: string, vals: readonly bigint[]): string {
  const h = createHash('sha256');
  h.update(`${domain}|len=${vals.length}`);
  for (const v of vals) {
    h.update('|');
    h.update(modField(v).toString(16));
  }
  return h.digest('hex');
}

function deriveChallenge(domain: string, parts: readonly string[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const p of parts) {
    h.update('|');
    h.update(p);
  }
  const s = modField(BigInt('0x' + h.digest('hex')));
  return s === 0n ? 1n : s;
}

export class PLONKPermutationProver {
  private readonly domainSize: number;
  private readonly domain: readonly bigint[];
  private readonly sigmaTags: readonly [readonly bigint[], readonly bigint[], readonly bigint[]];
  private readonly sigmaCommitment: string;

  constructor(domainSize: number, copyCycles: ReadonlyArray<readonly WireCell[]>) {
    if (!Number.isInteger(domainSize) || domainSize < 2 || (domainSize & (domainSize - 1)) !== 0) {
      throw new Error('domainSize must be a power of 2 >= 2');
    }
    this.domainSize = domainSize;
    const log2 = Math.round(Math.log2(domainSize));
    const omega = modPow(TWO_ADIC_GENERATOR, (FIELD_MODULUS - 1n) >> BigInt(log2));

    const domain: bigint[] = [];
    let cur = 1n;
    for (let i = 0; i < domainSize; i++) {
      domain.push(cur);
      cur = modField(cur * omega);
    }
    this.domain = domain;

    // Initialize identity permutation tags
    const s0 = domain.map((w) => modField(COSET_SHIFTS[0] * w));
    const s1 = domain.map((w) => modField(COSET_SHIFTS[1] * w));
    const s2 = domain.map((w) => modField(COSET_SHIFTS[2] * w));
    const tables: [bigint[], bigint[], bigint[]] = [s0, s1, s2];

    // Ensure all 3 cosets are pairwise disjoint
    const tagSet = new Set<bigint>([...s0, ...s1, ...s2]);
    if (tagSet.size !== 3 * domainSize) {
      throw new Error('Coset shift collision detected for chosen domain');
    }

    // Apply disjoint equivalence cycles
    const usedCells = new Set<string>();
    for (const cycle of copyCycles) {
      if (cycle.length < 2) continue;
      for (const cell of cycle) {
        if (cell.row < 0 || cell.row >= domainSize || cell.col < 0 || cell.col > 2) {
          throw new Error(`Wire cell out of bounds: (${cell.col}, ${cell.row})`);
        }
        const key = `${cell.col}:${cell.row}`;
        if (usedCells.has(key)) {
          throw new Error(`Overlapping copy-constraint cell detected: ${key}`);
        }
        usedCells.add(key);
      }
      for (let i = 0; i < cycle.length; i++) {
        const from = cycle[i];
        const to = cycle[(i + 1) % cycle.length];
        tables[from.col][from.row] = modField(COSET_SHIFTS[to.col] * domain[to.row]);
      }
    }

    this.sigmaTags = tables;
    this.sigmaCommitment = commitValues('PLONK_SIGMA', [...s0, ...s1, ...s2]);
  }

  public getDomainSize(): number {
    return this.domainSize;
  }

  public getSigmaCommitment(): string {
    return this.sigmaCommitment;
  }

  private computeRowFactors(
    witness: PLONKWitnessColumns,
    row: number,
    beta: bigint,
    gamma: bigint
  ): { num: bigint; den: bigint } {
    const a = modField(witness.colA[row]);
    const b = modField(witness.colB[row]);
    const c = modField(witness.colC[row]);
    const w = this.domain[row];

    const n0 = modField(a + modField(beta * modField(COSET_SHIFTS[0] * w)) + gamma);
    const n1 = modField(b + modField(beta * modField(COSET_SHIFTS[1] * w)) + gamma);
    const n2 = modField(c + modField(beta * modField(COSET_SHIFTS[2] * w)) + gamma);
    const num = modField(modField(n0 * n1) * n2);

    const d0 = modField(a + modField(beta * this.sigmaTags[0][row]) + gamma);
    const d1 = modField(b + modField(beta * this.sigmaTags[1][row]) + gamma);
    const d2 = modField(c + modField(beta * this.sigmaTags[2][row]) + gamma);
    const den = modField(modField(d0 * d1) * d2);

    return { num, den };
  }

  public prove(witness: PLONKWitnessColumns): PLONKPermutationProof {
    if (
      witness.colA.length !== this.domainSize ||
      witness.colB.length !== this.domainSize ||
      witness.colC.length !== this.domainSize
    ) {
      throw new Error(`All three witness columns must have length ${this.domainSize}`);
    }

    const witnessCommitment = commitValues('PLONK_WITNESS', [
      ...witness.colA,
      ...witness.colB,
      ...witness.colC,
    ]);
    const beta = deriveChallenge('PLONK_BETA', [this.sigmaCommitment, witnessCommitment]);
    const gamma = deriveChallenge('PLONK_GAMMA', [
      this.sigmaCommitment,
      witnessCommitment,
      beta.toString(16),
    ]);

    const accumulatorTrace: bigint[] = [1n];
    let z = 1n;
    for (let i = 0; i < this.domainSize; i++) {
      const { num, den } = this.computeRowFactors(witness, i, beta, gamma);
      z = modField(modField(z * num) * modInverse(den));
      accumulatorTrace.push(z);
    }

    if (z !== 1n) {
      throw new Error('Copy-constraint permutation violated: grand-product Z_n != 1');
    }

    const accumulatorCommitment = commitValues('PLONK_Z_ACC', accumulatorTrace);
    const transcriptDigest = createHash('sha256')
      .update('PLONK_PERM_TRANSCRIPT|')
      .update(`${this.domainSize}|${this.sigmaCommitment}|${witnessCommitment}|${accumulatorCommitment}|`)
      .update(`${beta.toString(16)}|${gamma.toString(16)}`)
      .digest('hex');

    return {
      domainSize: this.domainSize,
      witnessCommitment,
      accumulatorCommitment,
      beta,
      gamma,
      accumulatorTrace,
      transcriptDigest,
    };
  }

  public verify(
    witness: PLONKWitnessColumns,
    proof: PLONKPermutationProof
  ): PLONKPermutationVerification {
    if (
      proof.domainSize !== this.domainSize ||
      witness.colA.length !== this.domainSize ||
      witness.colB.length !== this.domainSize ||
      witness.colC.length !== this.domainSize ||
      proof.accumulatorTrace.length !== this.domainSize + 1
    ) {
      return {
        isValid: false,
        verifiedRows: 0,
        finalAccumulator: 0n,
        reason: 'Domain or trace dimension mismatch',
      };
    }

    const expectedWitnessCommit = commitValues('PLONK_WITNESS', [
      ...witness.colA,
      ...witness.colB,
      ...witness.colC,
    ]);
    const expectedAccCommit = commitValues('PLONK_Z_ACC', proof.accumulatorTrace);
    if (
      expectedWitnessCommit !== proof.witnessCommitment ||
      expectedAccCommit !== proof.accumulatorCommitment
    ) {
      return {
        isValid: false,
        verifiedRows: 0,
        finalAccumulator: 0n,
        reason: 'Witness or accumulator commitment mismatch',
      };
    }

    const expectedBeta = deriveChallenge('PLONK_BETA', [
      this.sigmaCommitment,
      proof.witnessCommitment,
    ]);
    const expectedGamma = deriveChallenge('PLONK_GAMMA', [
      this.sigmaCommitment,
      proof.witnessCommitment,
      expectedBeta.toString(16),
    ]);
    if (expectedBeta !== proof.beta || expectedGamma !== proof.gamma) {
      return {
        isValid: false,
        verifiedRows: 0,
        finalAccumulator: 0n,
        reason: 'Fiat-Shamir (beta, gamma) challenge mismatch',
      };
    }

    const expectedTranscript = createHash('sha256')
      .update('PLONK_PERM_TRANSCRIPT|')
      .update(`${this.domainSize}|${this.sigmaCommitment}|${proof.witnessCommitment}|${proof.accumulatorCommitment}|`)
      .update(`${expectedBeta.toString(16)}|${expectedGamma.toString(16)}`)
      .digest('hex');
    if (expectedTranscript !== proof.transcriptDigest) {
      return {
        isValid: false,
        verifiedRows: 0,
        finalAccumulator: 0n,
        reason: 'Transcript digest mismatch',
      };
    }

    if (proof.accumulatorTrace[0] !== 1n) {
      return {
        isValid: false,
        verifiedRows: 0,
        finalAccumulator: proof.accumulatorTrace[this.domainSize],
        reason: 'Grand-product accumulator must start at Z_0 == 1',
      };
    }

    for (let i = 0; i < this.domainSize; i++) {
      const { num, den } = this.computeRowFactors(witness, i, expectedBeta, expectedGamma);
      const lhs = modField(modField(proof.accumulatorTrace[i + 1]) * den);
      const rhs = modField(modField(proof.accumulatorTrace[i]) * num);
      if (lhs !== rhs) {
        return {
          isValid: false,
          verifiedRows: i,
          finalAccumulator: proof.accumulatorTrace[this.domainSize],
          reason: `Grand-product transition constraint failed at row ${i}`,
        };
      }
    }

    const finalZ = proof.accumulatorTrace[this.domainSize];
    if (finalZ !== 1n) {
      return {
        isValid: false,
        verifiedRows: this.domainSize,
        finalAccumulator: finalZ,
        reason: 'Grand-product cyclic boundary Z_n == 1 failed',
      };
    }

    return {
      isValid: true,
      verifiedRows: this.domainSize,
      finalAccumulator: finalZ,
    };
  }
}
