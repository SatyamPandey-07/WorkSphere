import { createHash } from 'crypto';

/**
 * Dynamic Zero-Knowledge Cryptographic Set Accumulator
 *
 * Implements a dynamic RSA-style universal cryptographic accumulator
 * (Boneh, Bunz, Fisch 2019 / Li, Li, Xue 2007) over composite modulus N = P1 * P2:
 *   - Deterministic hash-to-prime element mapping (Miller-Rabin primality verified)
 *   - Constant-size membership witnesses w satisfying w^x == A mod N
 *   - O(1) incremental witness update w' = w^y mod N on dynamic insertion
 *   - Constant-size Bezout non-membership witnesses (d, b) satisfying
 *     d^x * A^b == g mod N derived from extended GCD a*x + b*u == 1
 *   - Batch inclusion verification via product exponentiation
 */

const ACC_P1 = (1n << 61n) - 1n; // 2^61 - 1 (Mersenne prime)
const ACC_P2 = (1n << 89n) - 1n; // 2^89 - 1 (Mersenne prime)
const ACC_MODULUS = ACC_P1 * ACC_P2;
const ACC_BASE = 3n;

export interface MembershipWitness {
  readonly element: string;
  readonly primeRep: bigint;
  readonly witnessValue: bigint;
  readonly accumulatorValue: bigint;
  readonly witnessDigest: string;
}

export interface NonMembershipWitness {
  readonly element: string;
  readonly primeRep: bigint;
  readonly bezoutD: bigint;
  readonly bezoutB: bigint;
  readonly accumulatorValue: bigint;
  readonly witnessDigest: string;
}

export interface BatchMembershipProof {
  readonly elements: readonly string[];
  readonly primeReps: readonly bigint[];
  readonly combinedWitness: bigint;
  readonly accumulatorValue: bigint;
  readonly proofDigest: string;
}

function modN(x: bigint): bigint {
  const r = x % ACC_MODULUS;
  return r >= 0n ? r : r + ACC_MODULUS;
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

function extendedGcd(a: bigint, b: bigint): { gcd: bigint; x: bigint; y: bigint } {
  let oldR = a;
  let r = b;
  let oldS = 1n;
  let s = 0n;
  let oldT = 0n;
  let t = 1n;

  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
    [oldT, t] = [t, oldT - q * t];
  }
  return { gcd: oldR, x: oldS, y: oldT };
}

function modInverseN(a: bigint): bigint {
  const val = modN(a);
  const { gcd, x } = extendedGcd(val, ACC_MODULUS);
  if (gcd !== 1n) {
    throw new Error('Element is not invertible modulo N');
  }
  return modN(x);
}

function signedModPow(base: bigint, exp: bigint): bigint {
  if (exp >= 0n) {
    return modPow(base, exp, ACC_MODULUS);
  }
  return modPow(modInverseN(base), -exp, ACC_MODULUS);
}

const MR_BASES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];

function isProbablePrime(n: bigint): boolean {
  if (n < 2n) return false;
  for (const p of MR_BASES) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  let d = n - 1n;
  let s = 0;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    s++;
  }
  for (const a of MR_BASES) {
    let x = modPow(a, d, n);
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

export class ZKInclusionAccumulator {
  private accumulatorValue: bigint = ACC_BASE;
  private readonly members = new Map<string, bigint>(); // element -> primeRep

  public hashToPrime(element: string): bigint {
    const digest = createHash('sha256').update(`ZK_ACC_PRIME|${element}`).digest('hex');
    // Construct deterministic 60-bit odd candidate (guaranteed < P1 and coprime to N)
    let candidate = (BigInt('0x' + digest.slice(0, 15)) | (1n << 59n) | 1n);
    while (!isProbablePrime(candidate)) {
      candidate += 2n;
    }
    return candidate;
  }

  public getAccumulatorValue(): bigint {
    return this.accumulatorValue;
  }

  public getMemberCount(): number {
    return this.members.size;
  }

  public addElement(element: string): { primeRep: bigint; newAccumulator: bigint } {
    if (this.members.has(element)) {
      return { primeRep: this.members.get(element)!, newAccumulator: this.accumulatorValue };
    }
    const primeRep = this.hashToPrime(element);
    this.members.set(element, primeRep);
    this.accumulatorValue = modPow(this.accumulatorValue, primeRep, ACC_MODULUS);
    return { primeRep, newAccumulator: this.accumulatorValue };
  }

  public addBatch(elements: readonly string[]): bigint {
    for (const el of elements) {
      this.addElement(el);
    }
    return this.accumulatorValue;
  }

  public createMembershipWitness(element: string): MembershipWitness {
    const primeRep = this.members.get(element);
    if (primeRep === undefined) {
      throw new Error(`Element "${element}" is not accumulated in set`);
    }

    let witnessValue = ACC_BASE;
    for (const [el, p] of this.members.entries()) {
      if (el !== element) {
        witnessValue = modPow(witnessValue, p, ACC_MODULUS);
      }
    }

    const witnessDigest = createHash('sha256')
      .update(`ZK_ACC_MEM|${element}|${primeRep.toString(16)}|${witnessValue.toString(16)}|${this.accumulatorValue.toString(16)}`)
      .digest('hex');

    return {
      element,
      primeRep,
      witnessValue,
      accumulatorValue: this.accumulatorValue,
      witnessDigest,
    };
  }

  /**
   * O(1) incremental membership witness update when a new element is inserted.
   */
  public updateWitnessOnInsertion(
    existingWitness: MembershipWitness,
    addedElement: string,
    newAccumulatorValue: bigint
  ): MembershipWitness {
    const addedPrime = this.hashToPrime(addedElement);
    const updatedValue = modPow(existingWitness.witnessValue, addedPrime, ACC_MODULUS);
    const witnessDigest = createHash('sha256')
      .update(
        `ZK_ACC_MEM|${existingWitness.element}|${existingWitness.primeRep.toString(16)}|${updatedValue.toString(16)}|${newAccumulatorValue.toString(16)}`
      )
      .digest('hex');

    return {
      element: existingWitness.element,
      primeRep: existingWitness.primeRep,
      witnessValue: updatedValue,
      accumulatorValue: newAccumulatorValue,
      witnessDigest,
    };
  }

  public verifyMembership(witness: MembershipWitness): boolean {
    if (this.hashToPrime(witness.element) !== witness.primeRep) {
      return false;
    }
    const expectedDigest = createHash('sha256')
      .update(
        `ZK_ACC_MEM|${witness.element}|${witness.primeRep.toString(16)}|${witness.witnessValue.toString(16)}|${witness.accumulatorValue.toString(16)}`
      )
      .digest('hex');
    if (expectedDigest !== witness.witnessDigest) {
      return false;
    }
    return modPow(witness.witnessValue, witness.primeRep, ACC_MODULUS) === witness.accumulatorValue;
  }

  public createBatchMembershipProof(elements: readonly string[]): BatchMembershipProof {
    if (elements.length === 0) {
      throw new Error('Batch membership proof requires at least one element');
    }
    const targetSet = new Set(elements);
    const primeReps: bigint[] = [];
    for (const el of targetSet) {
      const p = this.members.get(el);
      if (p === undefined) {
        throw new Error(`Element "${el}" is not accumulated`);
      }
      primeReps.push(p);
    }

    let combinedWitness = ACC_BASE;
    for (const [el, p] of this.members.entries()) {
      if (!targetSet.has(el)) {
        combinedWitness = modPow(combinedWitness, p, ACC_MODULUS);
      }
    }

    const orderedElements = [...targetSet];
    const proofDigest = createHash('sha256')
      .update(`ZK_ACC_BATCH|${orderedElements.join(',')}|${combinedWitness.toString(16)}|${this.accumulatorValue.toString(16)}`)
      .digest('hex');

    return {
      elements: orderedElements,
      primeReps,
      combinedWitness,
      accumulatorValue: this.accumulatorValue,
      proofDigest,
    };
  }

  public verifyBatchMembership(proof: BatchMembershipProof): boolean {
    if (proof.elements.length === 0 || proof.elements.length !== proof.primeReps.length) {
      return false;
    }
    const expectedDigest = createHash('sha256')
      .update(`ZK_ACC_BATCH|${proof.elements.join(',')}|${proof.combinedWitness.toString(16)}|${proof.accumulatorValue.toString(16)}`)
      .digest('hex');
    if (expectedDigest !== proof.proofDigest) {
      return false;
    }

    let cur = proof.combinedWitness;
    for (let i = 0; i < proof.elements.length; i++) {
      const p = this.hashToPrime(proof.elements[i]);
      if (p !== proof.primeReps[i]) return false;
      cur = modPow(cur, p, ACC_MODULUS);
    }
    return cur === proof.accumulatorValue;
  }

  public createNonMembershipWitness(element: string): NonMembershipWitness {
    if (this.members.has(element)) {
      throw new Error(`Element "${element}" is already in the accumulator`);
    }
    const x = this.hashToPrime(element);
    let u = 1n;
    for (const p of this.members.values()) {
      u *= p;
    }
    const { gcd, x: bezoutA, y: bezoutB } = extendedGcd(x, u);
    if (gcd !== 1n) {
      throw new Error('Prime representative is not coprime to accumulated product');
    }

    const bezoutD = signedModPow(ACC_BASE, bezoutA);
    const witnessDigest = createHash('sha256')
      .update(
        `ZK_ACC_NONMEM|${element}|${x.toString(16)}|${bezoutD.toString(16)}|${bezoutB.toString(16)}|${this.accumulatorValue.toString(16)}`
      )
      .digest('hex');

    return {
      element,
      primeRep: x,
      bezoutD,
      bezoutB,
      accumulatorValue: this.accumulatorValue,
      witnessDigest,
    };
  }

  public verifyNonMembership(witness: NonMembershipWitness): boolean {
    if (this.hashToPrime(witness.element) !== witness.primeRep) {
      return false;
    }
    const expectedDigest = createHash('sha256')
      .update(
        `ZK_ACC_NONMEM|${witness.element}|${witness.primeRep.toString(16)}|${witness.bezoutD.toString(16)}|${witness.bezoutB.toString(16)}|${witness.accumulatorValue.toString(16)}`
      )
      .digest('hex');
    if (expectedDigest !== witness.witnessDigest) {
      return false;
    }

    // Verify d^x * A^b == g mod N
    const left = modPow(witness.bezoutD, witness.primeRep, ACC_MODULUS);
    const right = signedModPow(witness.accumulatorValue, witness.bezoutB);
    return modN(left * right) === ACC_BASE;
  }
}
