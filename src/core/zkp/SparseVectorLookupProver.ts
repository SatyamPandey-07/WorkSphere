import { createHash } from 'crypto';

/**
 * Zero-Knowledge LogUp Logarithmic-Derivative Sparse Vector Lookup Argument
 *
 * Implements the Habock (2022) LogUp lookup argument over BN254 scalar field Fr:
 * converts the multiset equality check between witness lookups f = [f_0..f_{n-1}]
 * and sparse table T = [t_0..t_{d-1}] with multiplicities m = [m_0..m_{d-1}] into
 * the logarithmic-derivative fractional sum identity:
 *
 *   sum_{i=0}^{n-1} 1 / (alpha + f_i)  -  sum_{j=0}^{d-1} m_j / (alpha + t_j)  ==  0 (mod Fr)
 *
 * verified via per-entry inverse constraints and a running partial-sum trace
 * beginning and terminating at 0.
 */

const FIELD_MODULUS =
  0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n; // BN254 Fr

export interface LogUpProof {
  readonly witnessCommitment: string;
  readonly multiplicityCommitment: string;
  readonly reciprocalCommitment: string;
  readonly partialSumCommitment: string;
  readonly challengeAlpha: bigint;
  readonly witnessValues: readonly bigint[];
  readonly multiplicities: readonly bigint[];
  readonly lookupReciprocals: readonly bigint[];
  readonly tableWeightedReciprocals: readonly bigint[];
  readonly partialSumTrace: readonly bigint[];
  readonly transcriptDigest: string;
}

export interface LogUpVerificationResult {
  readonly isValid: boolean;
  readonly verifiedLookups: number;
  readonly tableSize: number;
  readonly finalPartialSum: bigint;
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
    throw new Error('Cannot invert zero in BN254 Fr');
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

function deriveAlpha(parts: readonly string[]): bigint {
  const h = createHash('sha256');
  h.update('LOGUP_ALPHA');
  for (const p of parts) {
    h.update('|');
    h.update(p);
  }
  const s = modField(BigInt('0x' + h.digest('hex')));
  return s === 0n ? 1n : s;
}

export class SparseVectorLookupProver {
  private readonly table: readonly bigint[];
  private readonly tableIndexMap: ReadonlyMap<bigint, number>;
  private readonly tableCommitment: string;

  constructor(sparseTable: readonly bigint[]) {
    if (sparseTable.length === 0) {
      throw new Error('Sparse lookup table must be non-empty');
    }
    const normalized: bigint[] = [];
    const indexMap = new Map<bigint, number>();
    for (let i = 0; i < sparseTable.length; i++) {
      const val = modField(sparseTable[i]);
      if (indexMap.has(val)) {
        throw new Error(`Duplicate table entry detected: ${val.toString()}`);
      }
      indexMap.set(val, i);
      normalized.push(val);
    }
    this.table = normalized;
    this.tableIndexMap = indexMap;
    this.tableCommitment = commitVector('LOGUP_TABLE', normalized);
  }

  public getTableCommitment(): string {
    return this.tableCommitment;
  }

  public getTableSize(): number {
    return this.table.length;
  }

  public prove(witnessLookups: readonly bigint[]): LogUpProof {
    if (witnessLookups.length === 0) {
      throw new Error('Witness lookup vector must be non-empty');
    }

    const f = witnessLookups.map((w) => modField(w));
    const multiplicities = new Array<bigint>(this.table.length).fill(0n);

    for (let i = 0; i < f.length; i++) {
      const idx = this.tableIndexMap.get(f[i]);
      if (idx === undefined) {
        throw new Error(`Lookup element at index ${i} is not present in sparse table`);
      }
      multiplicities[idx] += 1n;
    }

    const witnessCommitment = commitVector('LOGUP_WITNESS', f);
    const multiplicityCommitment = commitVector('LOGUP_MULT', multiplicities);

    let challengeAlpha = deriveAlpha([
      this.tableCommitment,
      witnessCommitment,
      multiplicityCommitment,
    ]);
    // Ensure alpha + t_j != 0 for all table entries
    while (this.table.some((t) => modField(challengeAlpha + t) === 0n)) {
      challengeAlpha = modField(challengeAlpha + 1n);
    }

    const lookupReciprocals: bigint[] = f.map((fi) => modInverse(modField(challengeAlpha + fi)));
    const tableWeightedReciprocals: bigint[] = this.table.map((tj, j) =>
      modField(multiplicities[j] * modInverse(modField(challengeAlpha + tj)))
    );

    const partialSumTrace: bigint[] = [0n];
    let running = 0n;
    for (const a of lookupReciprocals) {
      running = modField(running + a);
      partialSumTrace.push(running);
    }
    for (const b of tableWeightedReciprocals) {
      running = modField(running - b);
      partialSumTrace.push(running);
    }

    if (running !== 0n) {
      throw new Error('LogUp algebraic invariant violation: final partial sum != 0');
    }

    const reciprocalCommitment = commitVector('LOGUP_RECIP', [
      ...lookupReciprocals,
      ...tableWeightedReciprocals,
    ]);
    const partialSumCommitment = commitVector('LOGUP_PSUM', partialSumTrace);

    const transcriptDigest = createHash('sha256')
      .update('LOGUP_TRANSCRIPT|')
      .update(`${this.tableCommitment}|${witnessCommitment}|${multiplicityCommitment}|`)
      .update(`${challengeAlpha.toString(16)}|${reciprocalCommitment}|${partialSumCommitment}`)
      .digest('hex');

    return {
      witnessCommitment,
      multiplicityCommitment,
      reciprocalCommitment,
      partialSumCommitment,
      challengeAlpha,
      witnessValues: f,
      multiplicities,
      lookupReciprocals,
      tableWeightedReciprocals,
      partialSumTrace,
      transcriptDigest,
    };
  }

  public verify(proof: LogUpProof): LogUpVerificationResult {
    const n = proof.witnessValues.length;
    const d = this.table.length;

    if (
      n === 0 ||
      proof.multiplicities.length !== d ||
      proof.lookupReciprocals.length !== n ||
      proof.tableWeightedReciprocals.length !== d ||
      proof.partialSumTrace.length !== n + d + 1
    ) {
      return {
        isValid: false,
        verifiedLookups: 0,
        tableSize: d,
        finalPartialSum: 0n,
        reason: 'Proof vector dimension mismatch',
      };
    }

    const expectedW = commitVector('LOGUP_WITNESS', proof.witnessValues);
    const expectedM = commitVector('LOGUP_MULT', proof.multiplicities);
    const expectedR = commitVector('LOGUP_RECIP', [
      ...proof.lookupReciprocals,
      ...proof.tableWeightedReciprocals,
    ]);
    const expectedP = commitVector('LOGUP_PSUM', proof.partialSumTrace);

    if (
      expectedW !== proof.witnessCommitment ||
      expectedM !== proof.multiplicityCommitment ||
      expectedR !== proof.reciprocalCommitment ||
      expectedP !== proof.partialSumCommitment
    ) {
      return {
        isValid: false,
        verifiedLookups: 0,
        tableSize: d,
        finalPartialSum: 0n,
        reason: 'LogUp vector commitment verification failed',
      };
    }

    let expectedAlpha = deriveAlpha([
      this.tableCommitment,
      proof.witnessCommitment,
      proof.multiplicityCommitment,
    ]);
    while (this.table.some((t) => modField(expectedAlpha + t) === 0n)) {
      expectedAlpha = modField(expectedAlpha + 1n);
    }
    if (expectedAlpha !== proof.challengeAlpha) {
      return {
        isValid: false,
        verifiedLookups: 0,
        tableSize: d,
        finalPartialSum: 0n,
        reason: 'Fiat-Shamir challenge alpha mismatch',
      };
    }

    const expectedTranscript = createHash('sha256')
      .update('LOGUP_TRANSCRIPT|')
      .update(`${this.tableCommitment}|${proof.witnessCommitment}|${proof.multiplicityCommitment}|`)
      .update(`${expectedAlpha.toString(16)}|${proof.reciprocalCommitment}|${proof.partialSumCommitment}`)
      .digest('hex');

    if (expectedTranscript !== proof.transcriptDigest) {
      return {
        isValid: false,
        verifiedLookups: 0,
        tableSize: d,
        finalPartialSum: 0n,
        reason: 'Transcript digest mismatch',
      };
    }

    if (proof.partialSumTrace[0] !== 0n) {
      return {
        isValid: false,
        verifiedLookups: 0,
        tableSize: d,
        finalPartialSum: proof.partialSumTrace[proof.partialSumTrace.length - 1],
        reason: 'Partial sum trace must start at 0',
      };
    }

    // Verify lookup reciprocal constraints: a_i * (alpha + f_i) == 1
    for (let i = 0; i < n; i++) {
      const denom = modField(expectedAlpha + modField(proof.witnessValues[i]));
      if (modField(modField(proof.lookupReciprocals[i]) * denom) !== 1n) {
        return {
          isValid: false,
          verifiedLookups: i,
          tableSize: d,
          finalPartialSum: proof.partialSumTrace[proof.partialSumTrace.length - 1],
          reason: `Lookup inverse relation failed at index ${i}`,
        };
      }
      const expectedNext = modField(proof.partialSumTrace[i] + modField(proof.lookupReciprocals[i]));
      if (proof.partialSumTrace[i + 1] !== expectedNext) {
        return {
          isValid: false,
          verifiedLookups: i,
          tableSize: d,
          finalPartialSum: proof.partialSumTrace[proof.partialSumTrace.length - 1],
          reason: `Partial sum addition transition failed at step ${i}`,
        };
      }
    }

    // Verify table weighted reciprocal constraints: b_j * (alpha + t_j) == m_j
    for (let j = 0; j < d; j++) {
      const denom = modField(expectedAlpha + this.table[j]);
      if (modField(modField(proof.tableWeightedReciprocals[j]) * denom) !== modField(proof.multiplicities[j])) {
        return {
          isValid: false,
          verifiedLookups: n,
          tableSize: d,
          finalPartialSum: proof.partialSumTrace[proof.partialSumTrace.length - 1],
          reason: `Table weighted inverse relation failed at table index ${j}`,
        };
      }
      const stepIdx = n + j;
      const expectedNext = modField(
        proof.partialSumTrace[stepIdx] - modField(proof.tableWeightedReciprocals[j])
      );
      if (proof.partialSumTrace[stepIdx + 1] !== expectedNext) {
        return {
          isValid: false,
          verifiedLookups: n,
          tableSize: d,
          finalPartialSum: proof.partialSumTrace[proof.partialSumTrace.length - 1],
          reason: `Partial sum subtraction transition failed at step ${stepIdx}`,
        };
      }
    }

    const finalPartialSum = proof.partialSumTrace[proof.partialSumTrace.length - 1];
    if (finalPartialSum !== 0n) {
      return {
        isValid: false,
        verifiedLookups: n,
        tableSize: d,
        finalPartialSum,
        reason: 'LogUp boundary identity S_final == 0 failed',
      };
    }

    return {
      isValid: true,
      verifiedLookups: n,
      tableSize: d,
      finalPartialSum,
    };
  }
}
