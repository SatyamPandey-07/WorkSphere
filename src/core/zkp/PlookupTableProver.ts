import { createHash } from 'crypto';

/**
 * Plookup Grand-Product Table Membership Argument
 *
 * Implements the Plookup protocol (Gabizon & Williamson 2020) over BN254 Fr:
 * proves that every element in a witness vector f = [f_0, ..., f_{n-1}] belongs
 * to a preprocessed public lookup table t = [t_0, ..., t_{d-1}] by sorting the
 * concatenation s = sort_t(f || t) and proving the randomized grand-product
 * polynomial identity:
 *
 *   (1 + beta)^n * prod_{i=0}^{n-1} (gamma + f_i)
 *     * prod_{j=0}^{d-2} (gamma*(1 + beta) + t_j + beta*t_{j+1})
 *   == prod_{k=0}^{n+d-2} (gamma*(1 + beta) + s_k + beta*s_{k+1})
 */

const FIELD_MODULUS =
  0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n; // BN254 Fr

export interface PlookupProof {
  readonly witnessCommitment: string;
  readonly sortedCommitment: string;
  readonly accumulatorCommitment: string;
  readonly beta: bigint;
  readonly gamma: bigint;
  readonly witnessValues: readonly bigint[];
  readonly sortedValues: readonly bigint[];
  readonly accumulatorTrace: readonly bigint[];
  readonly numeratorProduct: bigint;
  readonly denominatorProduct: bigint;
  readonly transcriptDigest: string;
}

export interface PlookupVerificationResult {
  readonly isValid: boolean;
  readonly witnessLength: number;
  readonly tableSize: number;
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
  if (val === 0n) {
    throw new Error('Cannot invert zero in BN254 scalar field');
  }
  return modPow(val, FIELD_MODULUS - 2n);
}

function commitVector(domain: string, values: readonly bigint[]): string {
  const h = createHash('sha256');
  h.update(domain);
  h.update(`|len=${values.length}`);
  for (const v of values) {
    h.update('|');
    h.update(modField(v).toString(16));
  }
  return h.digest('hex');
}

function deriveChallenge(domain: string, parts: readonly string[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const part of parts) {
    h.update('|');
    h.update(part);
  }
  const scalar = modField(BigInt('0x' + h.digest('hex')));
  return scalar === 0n ? 1n : scalar;
}

export class PlookupTableProver {
  private readonly table: readonly bigint[];
  private readonly tableIndexMap: ReadonlyMap<bigint, number>;
  private readonly tableCommitment: string;

  constructor(tableEntries: readonly bigint[]) {
    if (tableEntries.length < 2) {
      throw new Error('Plookup table must contain at least 2 distinct field elements');
    }
    const normalized: bigint[] = [];
    const indexMap = new Map<bigint, number>();
    for (let i = 0; i < tableEntries.length; i++) {
      const val = modField(tableEntries[i]);
      if (indexMap.has(val)) {
        throw new Error(`Duplicate table element detected: ${val.toString()}`);
      }
      indexMap.set(val, i);
      normalized.push(val);
    }
    this.table = normalized;
    this.tableIndexMap = indexMap;
    this.tableCommitment = commitVector('PLOOKUP_TABLE', normalized);
  }

  public getTableCommitment(): string {
    return this.tableCommitment;
  }

  public getTableSize(): number {
    return this.table.length;
  }

  public prove(witness: readonly bigint[]): PlookupProof {
    if (witness.length === 0) {
      throw new Error('Witness vector must be non-empty');
    }

    const f = witness.map((w) => modField(w));
    for (let i = 0; i < f.length; i++) {
      if (!this.tableIndexMap.has(f[i])) {
        throw new Error(`Witness value at index ${i} is not present in the lookup table`);
      }
    }

    // Sort concatenation s = sort_t(f || t) by table order
    const combined = [...f, ...this.table];
    combined.sort((a, b) => this.tableIndexMap.get(a)! - this.tableIndexMap.get(b)!);

    const witnessCommitment = commitVector('PLOOKUP_WITNESS', f);
    const sortedCommitment = commitVector('PLOOKUP_SORTED', combined);

    const beta = deriveChallenge('PLOOKUP_BETA', [
      this.tableCommitment,
      witnessCommitment,
      sortedCommitment,
    ]);
    const gamma = deriveChallenge('PLOOKUP_GAMMA', [
      this.tableCommitment,
      witnessCommitment,
      sortedCommitment,
      beta.toString(16),
    ]);

    const onePlusBeta = modField(1n + beta);
    const gammaScaled = modField(gamma * onePlusBeta);

    // Build numerator factors (length n + d - 1) and denominator factors (length n + d - 1)
    const numFactors: bigint[] = [];
    for (let i = 0; i < f.length; i++) {
      numFactors.push(modField(onePlusBeta * modField(gamma + f[i])));
    }
    for (let j = 0; j < this.table.length - 1; j++) {
      numFactors.push(
        modField(gammaScaled + this.table[j] + modField(beta * this.table[j + 1]))
      );
    }

    const denFactors: bigint[] = [];
    for (let k = 0; k < combined.length - 1; k++) {
      denFactors.push(
        modField(gammaScaled + combined[k] + modField(beta * combined[k + 1]))
      );
    }

    const accumulatorTrace: bigint[] = [1n];
    let z = 1n;
    let numeratorProduct = 1n;
    let denominatorProduct = 1n;

    for (let idx = 0; idx < numFactors.length; idx++) {
      numeratorProduct = modField(numeratorProduct * numFactors[idx]);
      denominatorProduct = modField(denominatorProduct * denFactors[idx]);
      z = modField(modField(z * numFactors[idx]) * modInverse(denFactors[idx]));
      accumulatorTrace.push(z);
    }

    const accumulatorCommitment = commitVector('PLOOKUP_ACC', accumulatorTrace);
    const transcriptDigest = createHash('sha256')
      .update('PLOOKUP_TRANSCRIPT|')
      .update(this.tableCommitment)
      .update('|')
      .update(witnessCommitment)
      .update('|')
      .update(sortedCommitment)
      .update('|')
      .update(accumulatorCommitment)
      .update(`|${beta.toString(16)}|${gamma.toString(16)}`)
      .digest('hex');

    return {
      witnessCommitment,
      sortedCommitment,
      accumulatorCommitment,
      beta,
      gamma,
      witnessValues: f,
      sortedValues: combined,
      accumulatorTrace,
      numeratorProduct,
      denominatorProduct,
      transcriptDigest,
    };
  }

  public verify(proof: PlookupProof): PlookupVerificationResult {
    const n = proof.witnessValues.length;
    const d = this.table.length;
    const expectedSortedLen = n + d;

    if (n === 0 || proof.sortedValues.length !== expectedSortedLen) {
      return {
        isValid: false,
        witnessLength: n,
        tableSize: d,
        finalAccumulator: 0n,
        reason: 'Invalid witness or sorted vector length',
      };
    }

    if (proof.accumulatorTrace.length !== expectedSortedLen) {
      return {
        isValid: false,
        witnessLength: n,
        tableSize: d,
        finalAccumulator: 0n,
        reason: 'Accumulator trace length mismatch',
      };
    }

    const recomputedWitnessCommit = commitVector('PLOOKUP_WITNESS', proof.witnessValues);
    const recomputedSortedCommit = commitVector('PLOOKUP_SORTED', proof.sortedValues);
    const recomputedAccCommit = commitVector('PLOOKUP_ACC', proof.accumulatorTrace);

    if (
      recomputedWitnessCommit !== proof.witnessCommitment ||
      recomputedSortedCommit !== proof.sortedCommitment ||
      recomputedAccCommit !== proof.accumulatorCommitment
    ) {
      return {
        isValid: false,
        witnessLength: n,
        tableSize: d,
        finalAccumulator: 0n,
        reason: 'Vector commitment verification failed',
      };
    }

    const expectedBeta = deriveChallenge('PLOOKUP_BETA', [
      this.tableCommitment,
      proof.witnessCommitment,
      proof.sortedCommitment,
    ]);
    const expectedGamma = deriveChallenge('PLOOKUP_GAMMA', [
      this.tableCommitment,
      proof.witnessCommitment,
      proof.sortedCommitment,
      expectedBeta.toString(16),
    ]);

    if (expectedBeta !== proof.beta || expectedGamma !== proof.gamma) {
      return {
        isValid: false,
        witnessLength: n,
        tableSize: d,
        finalAccumulator: 0n,
        reason: 'Fiat-Shamir challenge mismatch',
      };
    }

    const expectedTranscript = createHash('sha256')
      .update('PLOOKUP_TRANSCRIPT|')
      .update(this.tableCommitment)
      .update('|')
      .update(proof.witnessCommitment)
      .update('|')
      .update(proof.sortedCommitment)
      .update('|')
      .update(proof.accumulatorCommitment)
      .update(`|${expectedBeta.toString(16)}|${expectedGamma.toString(16)}`)
      .digest('hex');

    if (expectedTranscript !== proof.transcriptDigest) {
      return {
        isValid: false,
        witnessLength: n,
        tableSize: d,
        finalAccumulator: 0n,
        reason: 'Transcript digest verification failed',
      };
    }

    if (proof.accumulatorTrace[0] !== 1n) {
      return {
        isValid: false,
        witnessLength: n,
        tableSize: d,
        finalAccumulator: proof.accumulatorTrace[proof.accumulatorTrace.length - 1],
        reason: 'Grand-product accumulator must initialize to 1',
      };
    }

    const onePlusBeta = modField(1n + expectedBeta);
    const gammaScaled = modField(expectedGamma * onePlusBeta);

    const numFactors: bigint[] = [];
    for (let i = 0; i < n; i++) {
      numFactors.push(modField(onePlusBeta * modField(expectedGamma + modField(proof.witnessValues[i]))));
    }
    for (let j = 0; j < d - 1; j++) {
      numFactors.push(
        modField(gammaScaled + this.table[j] + modField(expectedBeta * this.table[j + 1]))
      );
    }

    let lhs = 1n;
    let rhs = 1n;
    for (let k = 0; k < expectedSortedLen - 1; k++) {
      const denFactor = modField(
        gammaScaled +
          modField(proof.sortedValues[k]) +
          modField(expectedBeta * modField(proof.sortedValues[k + 1]))
      );
      lhs = modField(lhs * numFactors[k]);
      rhs = modField(rhs * denFactor);

      // Verify transition constraint: Z_{k+1} * den_k == Z_k * num_k
      const expectedStepLhs = modField(proof.accumulatorTrace[k + 1] * denFactor);
      const expectedStepRhs = modField(proof.accumulatorTrace[k] * numFactors[k]);
      if (expectedStepLhs !== expectedStepRhs) {
        return {
          isValid: false,
          witnessLength: n,
          tableSize: d,
          finalAccumulator: proof.accumulatorTrace[expectedSortedLen - 1],
          reason: `Grand-product recurrence failed at step ${k}`,
        };
      }
    }

    const finalZ = proof.accumulatorTrace[expectedSortedLen - 1];
    if (finalZ !== 1n || lhs !== rhs || lhs !== proof.numeratorProduct || rhs !== proof.denominatorProduct) {
      return {
        isValid: false,
        witnessLength: n,
        tableSize: d,
        finalAccumulator: finalZ,
        reason: 'Grand-product boundary identity Z_final == 1 failed',
      };
    }

    return {
      isValid: true,
      witnessLength: n,
      tableSize: d,
      finalAccumulator: finalZ,
    };
  }
}
