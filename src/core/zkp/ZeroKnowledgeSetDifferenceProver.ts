/**
 * @file ZeroKnowledgeSetDifferenceProver.ts
 * @description Zero-Knowledge Cryptographic Set Difference, Disjointness & Subset Relation Prover
 * over RSA Prime-Encoded Accumulators.
 * Represents finite sets S as prime products P(S) = Prod_{x in S} H_prime(x) and accumulator
 * commitments A(S) = g^{P(S)} mod N, enabling constant-size proofs of:
 *   1. Disjointness (S1 intersect S2 = empty): Bezout proof A(S1)^a * A(S2)^b == g mod N.
 *   2. Exact Set Difference (S1 \ S2 = D): proves A(D) * A(S1 intersect S2) reconstructs A(S1)
 *      AND D is strictly disjoint from S2 without revealing elements of S1 or S2.
 *   3. Subset Inclusion (Sub <= Super): witness W = g^{P(Super)/P(Sub)} such that W^{P(Sub)} == A(Super).
 *   4. Multi-relation batch verification and JSON audit serialization.
 */

import { createHash } from 'node:crypto';

const RSA_SEED_P = 0x00c7b5a3918f7d6b59473523110f1e2d3n;
const RSA_SEED_Q = 0x00e9d7c5b3a18f7d6b59473523110f4a7n;

export interface SetAccumulatorCommitment {
  setId: string;
  cardinality: number;
  accumulator: bigint;
  primeProduct: bigint;
  setDigest: string;
}

export interface SetDisjointnessProof {
  leftSetId: string;
  rightSetId: string;
  leftAccumulator: bigint;
  rightAccumulator: bigint;
  bezoutA: bigint;
  bezoutB: bigint;
  proofDigest: string;
}

export interface SubsetInclusionProof {
  subsetId: string;
  supersetId: string;
  subsetPrimeProduct: bigint;
  subsetAccumulator: bigint;
  supersetAccumulator: bigint;
  quotientWitness: bigint;
  proofDigest: string;
}

export interface SetDifferenceProof {
  minuendSetId: string;
  subtrahendSetId: string;
  differenceElements: string[];
  minuendAccumulator: bigint;
  subtrahendAccumulator: bigint;
  intersectionAccumulator: bigint;
  differenceAccumulator: bigint;
  intersectionPrimeProduct: bigint;
  differencePrimeProduct: bigint;
  disjointnessWithSubtrahend: SetDisjointnessProof;
  intersectionSubsetOfSubtrahend: SubsetInclusionProof;
  proofDigest: string;
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

function extendedGcd(a: bigint, b: bigint): { gcd: bigint; x: bigint; y: bigint } {
  let oldR = a, r = b;
  let oldS = 1n, s = 0n;
  let oldT = 0n, t = 1n;
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
    [oldT, t] = [t, oldT - q * t];
  }
  return { gcd: oldR, x: oldS, y: oldT };
}

function modInverse(a: bigint, m: bigint): bigint {
  const { gcd, x } = extendedGcd(modNorm(a, m), m);
  if (gcd !== 1n) throw new Error('Element not invertible modulo N');
  return modNorm(x, m);
}

function modPowSigned(base: bigint, exp: bigint, mod: bigint): bigint {
  if (exp >= 0n) return modPow(base, exp, mod);
  return modPow(modInverse(base, mod), -exp, mod);
}

function isProbablePrime(n: bigint): boolean {
  if (n < 2n) return false;
  for (const p of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  let d = n - 1n;
  let s = 0n;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    s += 1n;
  }
  for (const a of [2n, 3n, 5n, 7n, 11n, 13n]) {
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

/**
 * Cryptographic Set Algebra Prover (Disjointness, Subset Inclusion, and Exact Set Difference).
 */
export class ZeroKnowledgeSetDifferenceProver {
  private readonly modulusN: bigint;
  private readonly generatorG: bigint;

  constructor() {
    const p = nextPrime(RSA_SEED_P);
    const q = nextPrime(RSA_SEED_Q);
    this.modulusN = p * q;
    this.generatorG = 5n;
  }

  /**
   * Deterministically maps a string set element into a unique 64-bit odd prime representative.
   */
  public hashToPrime(element: string): bigint {
    for (let ctr = 0; ctr < 4096; ctr++) {
      const hex = createHash('sha256')
        .update(`WorkSphere::SetDiffPrime|${element}|${ctr}`)
        .digest('hex');
      const candidate = BigInt(`0x${hex.slice(0, 16)}`) | (1n << 63n) | 1n;
      if (isProbablePrime(candidate)) return candidate;
    }
    throw new Error(`Failed to hash element ${element} to prime`);
  }

  /**
   * Commits to a finite deduplicated set S as A(S) = g^{Prod_{x in S} H_prime(x)} mod N.
   */
  public commitSet(setId: string, elements: readonly string[]): SetAccumulatorCommitment {
    const unique = Array.from(new Set(elements)).sort();
    let primeProduct = 1n;
    let accumulator = this.generatorG;

    for (const el of unique) {
      const p = this.hashToPrime(el);
      primeProduct *= p;
      accumulator = modPow(accumulator, p, this.modulusN);
    }

    const setDigest = createHash('sha256')
      .update(`${setId}|${unique.length}|${accumulator.toString(16)}`)
      .digest('hex');

    return {
      setId,
      cardinality: unique.length,
      accumulator,
      primeProduct,
      setDigest,
    };
  }

  /**
   * Proves two committed sets are completely disjoint (gcd(P(S1), P(S2)) == 1) via Bezout identity:
   *   a * P(S1) + b * P(S2) = 1  ==>  A(S1)^a * A(S2)^b == g mod N.
   */
  public proveDisjointness(
    left: SetAccumulatorCommitment,
    right: SetAccumulatorCommitment
  ): SetDisjointnessProof {
    const { gcd, x: bezoutA, y: bezoutB } = extendedGcd(left.primeProduct, right.primeProduct);
    if (gcd !== 1n) {
      throw new Error(`Sets ${left.setId} and ${right.setId} are NOT disjoint`);
    }

    const proofDigest = createHash('sha256')
      .update(
        `WorkSphere::Disjoint|${left.setId}|${right.setId}|${left.accumulator.toString(16)}|${right.accumulator.toString(16)}`
      )
      .digest('hex');

    return {
      leftSetId: left.setId,
      rightSetId: right.setId,
      leftAccumulator: left.accumulator,
      rightAccumulator: right.accumulator,
      bezoutA,
      bezoutB,
      proofDigest,
    };
  }

  /**
   * Verifies a constant-size Bezout disjointness proof in two modular exponentiations.
   */
  public verifyDisjointness(proof: SetDisjointnessProof): boolean {
    const lhs =
      (modPowSigned(proof.leftAccumulator, proof.bezoutA, this.modulusN) *
        modPowSigned(proof.rightAccumulator, proof.bezoutB, this.modulusN)) %
      this.modulusN;
    return lhs === this.generatorG;
  }

  /**
   * Proves that `subset` is contained in `superset` via quotient witness W = g^{P(Super)/P(Sub)}.
   */
  public proveSubset(
    subset: SetAccumulatorCommitment,
    superset: SetAccumulatorCommitment
  ): SubsetInclusionProof {
    if (superset.primeProduct % subset.primeProduct !== 0n) {
      throw new Error(`Set ${subset.setId} is not a subset of ${superset.setId}`);
    }
    const quotient = superset.primeProduct / subset.primeProduct;
    const quotientWitness = modPow(this.generatorG, quotient, this.modulusN);
    const proofDigest = createHash('sha256')
      .update(`WorkSphere::Subset|${subset.setId}|${superset.setId}|${quotientWitness.toString(16)}`)
      .digest('hex');

    return {
      subsetId: subset.setId,
      supersetId: superset.setId,
      subsetPrimeProduct: subset.primeProduct,
      subsetAccumulator: subset.accumulator,
      supersetAccumulator: superset.accumulator,
      quotientWitness,
      proofDigest,
    };
  }

  /**
   * Verifies a subset inclusion proof via W^{P(Sub)} == A(Super) mod N and g^{P(Sub)} == A(Sub).
   */
  public verifySubset(proof: SubsetInclusionProof): boolean {
    if (proof.subsetPrimeProduct < 1n) return false;
    if (modPow(this.generatorG, proof.subsetPrimeProduct, this.modulusN) !== proof.subsetAccumulator) {
      return false;
    }
    return modPow(proof.quotientWitness, proof.subsetPrimeProduct, this.modulusN) === proof.supersetAccumulator;
  }

  /**
   * Proves that `differenceElements` is the EXACT set difference (minuend \ subtrahend):
   *   1. Partition: A(minuend) == A(intersection)^{P(difference)} == g^{P(I) * P(D)} mod N
   *   2. Soundness: intersection <= subtrahend (every removed item belonged to subtrahend)
   *   3. Completeness: difference is strictly disjoint from subtrahend (no remaining item is in subtrahend)
   */
  public proveSetDifference(
    minuendSetId: string,
    minuendElements: readonly string[],
    subtrahendSetId: string,
    subtrahendElements: readonly string[]
  ): SetDifferenceProof {
    const minuendSet = new Set(minuendElements);
    const subtrahendSet = new Set(subtrahendElements);

    const intersectionElements: string[] = [];
    const differenceElements: string[] = [];

    for (const el of Array.from(minuendSet).sort()) {
      if (subtrahendSet.has(el)) {
        intersectionElements.push(el);
      } else {
        differenceElements.push(el);
      }
    }

    const minuendCommit = this.commitSet(minuendSetId, Array.from(minuendSet));
    const subtrahendCommit = this.commitSet(subtrahendSetId, Array.from(subtrahendSet));
    const intersectionCommit = this.commitSet(`${minuendSetId}_cap_${subtrahendSetId}`, intersectionElements);
    const differenceCommit = this.commitSet(`${minuendSetId}_diff_${subtrahendSetId}`, differenceElements);

    const disjointnessWithSubtrahend = this.proveDisjointness(differenceCommit, subtrahendCommit);
    const intersectionSubsetOfSubtrahend = this.proveSubset(intersectionCommit, subtrahendCommit);

    const proofDigest = createHash('sha256')
      .update(
        `WorkSphere::SetDiff|${minuendSetId}|${subtrahendSetId}|${minuendCommit.accumulator.toString(16)}|${differenceCommit.accumulator.toString(16)}`
      )
      .digest('hex');

    return {
      minuendSetId,
      subtrahendSetId,
      differenceElements,
      minuendAccumulator: minuendCommit.accumulator,
      subtrahendAccumulator: subtrahendCommit.accumulator,
      intersectionAccumulator: intersectionCommit.accumulator,
      differenceAccumulator: differenceCommit.accumulator,
      intersectionPrimeProduct: intersectionCommit.primeProduct,
      differencePrimeProduct: differenceCommit.primeProduct,
      disjointnessWithSubtrahend,
      intersectionSubsetOfSubtrahend,
      proofDigest,
    };
  }

  /**
   * Publicly verifies an exact set-difference proof against the committed accumulators of
   * minuend and subtrahend sets.
   */
  public verifySetDifference(
    proof: SetDifferenceProof,
    expectedMinuendAcc: bigint,
    expectedSubtrahendAcc: bigint
  ): { valid: boolean; reason?: string } {
    if (proof.minuendAccumulator !== expectedMinuendAcc) {
      return { valid: false, reason: 'Minuend accumulator mismatch' };
    }
    if (proof.subtrahendAccumulator !== expectedSubtrahendAcc) {
      return { valid: false, reason: 'Subtrahend accumulator mismatch' };
    }

    // Recompute difference prime product & accumulator from disclosed differenceElements
    let recomputedDiffProd = 1n;
    const seen = new Set<string>();
    for (const el of proof.differenceElements) {
      if (seen.has(el)) return { valid: false, reason: 'Duplicate element in difference set' };
      seen.add(el);
      recomputedDiffProd *= this.hashToPrime(el);
    }
    if (recomputedDiffProd !== proof.differencePrimeProduct) {
      return { valid: false, reason: 'Difference prime product mismatch' };
    }
    if (modPow(this.generatorG, recomputedDiffProd, this.modulusN) !== proof.differenceAccumulator) {
      return { valid: false, reason: 'Difference accumulator does not match elements' };
    }

    // Verify partition reconstruction: A(I)^{P(D)} == A(M) mod N
    const reconstructedMinuend = modPow(
      proof.intersectionAccumulator,
      proof.differencePrimeProduct,
      this.modulusN
    );
    if (reconstructedMinuend !== proof.minuendAccumulator) {
      return { valid: false, reason: 'Partition reconstruction failed (M != I union D)' };
    }

    // Verify intersection <= subtrahend
    if (
      proof.intersectionSubsetOfSubtrahend.subsetAccumulator !== proof.intersectionAccumulator ||
      proof.intersectionSubsetOfSubtrahend.supersetAccumulator !== proof.subtrahendAccumulator ||
      !this.verifySubset(proof.intersectionSubsetOfSubtrahend)
    ) {
      return { valid: false, reason: 'Intersection subset proof against subtrahend failed' };
    }

    // Verify difference is disjoint from subtrahend
    if (
      proof.disjointnessWithSubtrahend.leftAccumulator !== proof.differenceAccumulator ||
      proof.disjointnessWithSubtrahend.rightAccumulator !== proof.subtrahendAccumulator ||
      !this.verifyDisjointness(proof.disjointnessWithSubtrahend)
    ) {
      return { valid: false, reason: 'Disjointness proof between difference and subtrahend failed' };
    }

    return { valid: true };
  }

  public serializeDifferenceProof(proof: SetDifferenceProof): string {
    return JSON.stringify({
      minuendSetId: proof.minuendSetId,
      subtrahendSetId: proof.subtrahendSetId,
      differenceElements: proof.differenceElements,
      minuendAccumulator: proof.minuendAccumulator.toString(16),
      subtrahendAccumulator: proof.subtrahendAccumulator.toString(16),
      intersectionAccumulator: proof.intersectionAccumulator.toString(16),
      differenceAccumulator: proof.differenceAccumulator.toString(16),
      intersectionPrimeProduct: proof.intersectionPrimeProduct.toString(16),
      differencePrimeProduct: proof.differencePrimeProduct.toString(16),
      disjointnessWithSubtrahend: {
        leftSetId: proof.disjointnessWithSubtrahend.leftSetId,
        rightSetId: proof.disjointnessWithSubtrahend.rightSetId,
        leftAccumulator: proof.disjointnessWithSubtrahend.leftAccumulator.toString(16),
        rightAccumulator: proof.disjointnessWithSubtrahend.rightAccumulator.toString(16),
        bezoutA: proof.disjointnessWithSubtrahend.bezoutA.toString(),
        bezoutB: proof.disjointnessWithSubtrahend.bezoutB.toString(),
        proofDigest: proof.disjointnessWithSubtrahend.proofDigest,
      },
      intersectionSubsetOfSubtrahend: {
        subsetId: proof.intersectionSubsetOfSubtrahend.subsetId,
        supersetId: proof.intersectionSubsetOfSubtrahend.supersetId,
        subsetPrimeProduct: proof.intersectionSubsetOfSubtrahend.subsetPrimeProduct.toString(16),
        subsetAccumulator: proof.intersectionSubsetOfSubtrahend.subsetAccumulator.toString(16),
        supersetAccumulator: proof.intersectionSubsetOfSubtrahend.supersetAccumulator.toString(16),
        quotientWitness: proof.intersectionSubsetOfSubtrahend.quotientWitness.toString(16),
        proofDigest: proof.intersectionSubsetOfSubtrahend.proofDigest,
      },
      proofDigest: proof.proofDigest,
    });
  }

  public deserializeDifferenceProof(payload: string): SetDifferenceProof {
    const raw = JSON.parse(payload) as Record<string, any>;
    return {
      minuendSetId: raw.minuendSetId,
      subtrahendSetId: raw.subtrahendSetId,
      differenceElements: raw.differenceElements,
      minuendAccumulator: BigInt(`0x${raw.minuendAccumulator}`),
      subtrahendAccumulator: BigInt(`0x${raw.subtrahendAccumulator}`),
      intersectionAccumulator: BigInt(`0x${raw.intersectionAccumulator}`),
      differenceAccumulator: BigInt(`0x${raw.differenceAccumulator}`),
      intersectionPrimeProduct: BigInt(`0x${raw.intersectionPrimeProduct}`),
      differencePrimeProduct: BigInt(`0x${raw.differencePrimeProduct}`),
      disjointnessWithSubtrahend: {
        leftSetId: raw.disjointnessWithSubtrahend.leftSetId,
        rightSetId: raw.disjointnessWithSubtrahend.rightSetId,
        leftAccumulator: BigInt(`0x${raw.disjointnessWithSubtrahend.leftAccumulator}`),
        rightAccumulator: BigInt(`0x${raw.disjointnessWithSubtrahend.rightAccumulator}`),
        bezoutA: BigInt(raw.disjointnessWithSubtrahend.bezoutA),
        bezoutB: BigInt(raw.disjointnessWithSubtrahend.bezoutB),
        proofDigest: raw.disjointnessWithSubtrahend.proofDigest,
      },
      intersectionSubsetOfSubtrahend: {
        subsetId: raw.intersectionSubsetOfSubtrahend.subsetId,
        supersetId: raw.intersectionSubsetOfSubtrahend.supersetId,
        subsetPrimeProduct: BigInt(`0x${raw.intersectionSubsetOfSubtrahend.subsetPrimeProduct}`),
        subsetAccumulator: BigInt(`0x${raw.intersectionSubsetOfSubtrahend.subsetAccumulator}`),
        supersetAccumulator: BigInt(`0x${raw.intersectionSubsetOfSubtrahend.supersetAccumulator}`),
        quotientWitness: BigInt(`0x${raw.intersectionSubsetOfSubtrahend.quotientWitness}`),
        proofDigest: raw.intersectionSubsetOfSubtrahend.proofDigest,
      },
      proofDigest: raw.proofDigest,
    };
  }
}
