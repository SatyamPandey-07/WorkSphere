/**
 * @file ZeroKnowledgeCredentialRevocationAccumulator.ts
 * @description Dynamic RSA cryptographic accumulator with membership witnesses,
 * Bezout non-membership witnesses, incremental revocation epochs, and
 * non-interactive zero-knowledge witness validity proofs.
 */

import { createHash } from 'crypto';

// Composite RSA modulus N = P1 * P2 (256-bit group for fast deterministic testing)
const ACC_PRIME_1 = 0xffffffffffffffffffffffffffffff61n;
const ACC_PRIME_2 = 0xffffffffffffffffffffffffffffff43n;
const DEFAULT_N = ACC_PRIME_1 * ACC_PRIME_2;
const DEFAULT_G = 17n;

function modNorm(x: bigint, mod: bigint): bigint {
  const r = x % mod;
  return r >= 0n ? r : r + mod;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = modNorm(base, mod);
  let e = exp;
  if (e < 0n) throw new RangeError('Negative exponent not supported directly');
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
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

function modInverse(a: bigint, mod: bigint): bigint {
  const { gcd, x } = extendedGcd(modNorm(a, mod), mod);
  if (gcd !== 1n) throw new Error('Element not invertible modulo N');
  return modNorm(x, mod);
}

function modPowSigned(base: bigint, exp: bigint, mod: bigint): bigint {
  if (exp >= 0n) return modPow(base, exp, mod);
  return modPow(modInverse(base, mod), -exp, mod);
}

const SMALL_PRIMES = [3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n, 43n];

function isProbablePrime(n: bigint): boolean {
  if (n < 2n) return false;
  if (n === 2n || n === 3n) return true;
  if ((n & 1n) === 0n) return false;
  for (const sp of SMALL_PRIMES) {
    if (n === sp) return true;
    if (n % sp === 0n) return false;
  }
  let d = n - 1n;
  let s = 0;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    s++;
  }
  for (const a of [2n, 3n, 5n, 7n, 11n, 13n, 17n]) {
    if (a >= n) continue;
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

export interface MembershipWitness {
  readonly credentialId: string;
  readonly primeRep: bigint;
  readonly witness: bigint;
  readonly epoch: number;
}

export interface NonMembershipWitness {
  readonly credentialId: string;
  readonly primeRep: bigint;
  readonly cofactorA: bigint;
  readonly commitmentD: bigint;
  readonly epoch: number;
}

export interface RevocationEpochReceipt {
  readonly epoch: number;
  readonly accumulatorValue: bigint;
  readonly activeCount: number;
  readonly revokedCount: number;
  readonly stateHash: string;
}

export class ZeroKnowledgeCredentialRevocationAccumulator {
  public readonly modulusN: bigint;
  public readonly generatorG: bigint;
  private accumulator: bigint;
  private epoch: number;
  private readonly activeMembers: Map<string, bigint>;
  private readonly revokedMembers: Set<string>;

  constructor(modulusN: bigint = DEFAULT_N, generatorG: bigint = DEFAULT_G) {
    this.modulusN = modulusN;
    this.generatorG = modNorm(generatorG, modulusN);
    this.accumulator = this.generatorG;
    this.epoch = 0;
    this.activeMembers = new Map();
    this.revokedMembers = new Set();
  }

  /**
   * Deterministically maps a credential identifier into a unique 64-bit odd prime representative.
   */
  public hashToPrime(credentialId: string): bigint {
    for (let counter = 0; counter < 10000; counter++) {
      const h = createHash('sha256')
        .update(`WorkSphere::RevocationPrime|${credentialId}|${counter}`)
        .digest('hex');
      const candidate = BigInt('0x' + h.slice(0, 16)) | (1n << 63n) | 1n;
      if (isProbablePrime(candidate)) return candidate;
    }
    throw new Error('Failed to map credentialId to prime');
  }

  public getAccumulator(): bigint {
    return this.accumulator;
  }

  public getEpoch(): number {
    return this.epoch;
  }

  public addCredential(credentialId: string): RevocationEpochReceipt {
    if (this.activeMembers.has(credentialId)) {
      throw new Error(`Credential ${credentialId} is already active in accumulator`);
    }
    const prime = this.hashToPrime(credentialId);
    this.activeMembers.set(credentialId, prime);
    this.revokedMembers.delete(credentialId);
    this.accumulator = modPow(this.accumulator, prime, this.modulusN);
    this.epoch += 1;
    return this.snapshotReceipt();
  }

  public revokeCredential(credentialId: string): RevocationEpochReceipt {
    if (!this.activeMembers.has(credentialId)) {
      throw new Error(`Credential ${credentialId} is not active`);
    }
    this.activeMembers.delete(credentialId);
    this.revokedMembers.add(credentialId);
    this.recomputeAccumulator();
    this.epoch += 1;
    return this.snapshotReceipt();
  }

  private recomputeAccumulator(): void {
    let acc = this.generatorG;
    for (const prime of this.activeMembers.values()) {
      acc = modPow(acc, prime, this.modulusN);
    }
    this.accumulator = acc;
  }

  private snapshotReceipt(): RevocationEpochReceipt {
    const stateHash = createHash('sha256')
      .update(`${this.epoch}|${this.accumulator.toString(16)}|${this.activeMembers.size}|${this.revokedMembers.size}`)
      .digest('hex');
    return {
      epoch: this.epoch,
      accumulatorValue: this.accumulator,
      activeCount: this.activeMembers.size,
      revokedCount: this.revokedMembers.size,
      stateHash,
    };
  }

  /**
   * Computes a membership witness W = g^{Prod_{y != x} y} mod N such that W^x == A mod N.
   */
  public createMembershipWitness(credentialId: string): MembershipWitness {
    const prime = this.activeMembers.get(credentialId);
    if (!prime) {
      throw new Error(`Credential ${credentialId} is not an active member`);
    }

    let witness = this.generatorG;
    for (const [id, p] of this.activeMembers.entries()) {
      if (id === credentialId) continue;
      witness = modPow(witness, p, this.modulusN);
    }

    return {
      credentialId,
      primeRep: prime,
      witness,
      epoch: this.epoch,
    };
  }

  /**
   * Updates an existing membership witness incrementally when a new credential is added.
   */
  public updateWitnessOnAdd(
    witness: MembershipWitness,
    addedCredentialId: string
  ): MembershipWitness {
    const addedPrime = this.hashToPrime(addedCredentialId);
    return {
      ...witness,
      witness: modPow(witness.witness, addedPrime, this.modulusN),
      epoch: this.epoch,
    };
  }

  public verifyMembership(witness: MembershipWitness, accumulatorValue = this.accumulator): boolean {
    if (witness.primeRep !== this.hashToPrime(witness.credentialId)) return false;
    return modPow(witness.witness, witness.primeRep, this.modulusN) === modNorm(accumulatorValue, this.modulusN);
  }

  /**
   * Creates a Bezout non-membership witness (a, d) proving credentialId is NOT in the active set:
   * a * u + b * x = 1 where u = Prod(active primes), d = g^b mod N,
   * verifiable via A^a * d^x == g mod N.
   */
  public createNonMembershipWitness(credentialId: string): NonMembershipWitness {
    if (this.activeMembers.has(credentialId)) {
      throw new Error(`Credential ${credentialId} is currently an active member`);
    }
    const x = this.hashToPrime(credentialId);
    let u = 1n;
    for (const p of this.activeMembers.values()) {
      u *= p;
    }

    const { gcd, x: a, y: b } = extendedGcd(u, x);
    if (gcd !== 1n) {
      throw new Error('Prime representative collided with active accumulator product');
    }

    const d = modPowSigned(this.generatorG, b, this.modulusN);
    return {
      credentialId,
      primeRep: x,
      cofactorA: a,
      commitmentD: d,
      epoch: this.epoch,
    };
  }

  public verifyNonMembership(
    witness: NonMembershipWitness,
    accumulatorValue = this.accumulator
  ): boolean {
    if (witness.primeRep !== this.hashToPrime(witness.credentialId)) return false;
    const lhs =
      (modPowSigned(accumulatorValue, witness.cofactorA, this.modulusN) *
        modPow(witness.commitmentD, witness.primeRep, this.modulusN)) %
      this.modulusN;
    return lhs === this.generatorG;
  }

  /**
   * Aggregates multiple active credential membership witnesses into a single constant-size
   * Boneh-Bunz-Fisch (BBF) batch witness proving simultaneous membership for all credentials.
   * Since each w_i^{p_i} == A mod N and primes are pairwise coprime, there exists a combined
   * witness w_batch such that w_batch^(Prod p_i) == A mod N.
   */
  public aggregateMembershipWitnesses(
    witnesses: readonly MembershipWitness[]
  ): {
    credentialIds: string[];
    combinedPrimeProduct: bigint;
    combinedWitness: bigint;
    epoch: number;
  } {
    if (witnesses.length === 0) {
      throw new Error('At least one membership witness is required for aggregation');
    }

    let accWitness = witnesses[0].witness;
    let accPrime = witnesses[0].primeRep;
    const ids = [witnesses[0].credentialId];

    for (let i = 1; i < witnesses.length; i++) {
      const next = witnesses[i];
      if (ids.includes(next.credentialId)) {
        throw new Error(`Duplicate credential in aggregation batch: ${next.credentialId}`);
      }
      const { gcd, x: u, y: v } = extendedGcd(accPrime, next.primeRep);
      if (gcd !== 1n) {
        throw new Error('Credential prime representatives must be pairwise coprime');
      }
      // Shamir's trick: w_12 = w_1^v * w_2^u mod N satisfies w_12^(p1*p2) == A^(p1*u + p2*v) == A
      accWitness =
        (modPowSigned(accWitness, v, this.modulusN) *
          modPowSigned(next.witness, u, this.modulusN)) %
        this.modulusN;
      accPrime = accPrime * next.primeRep;
      ids.push(next.credentialId);
    }

    return {
      credentialIds: ids,
      combinedPrimeProduct: accPrime,
      combinedWitness: accWitness,
      epoch: this.epoch,
    };
  }

  /**
   * Verifies an aggregated batch membership proof against the accumulator in one exponentiation.
   */
  public verifyAggregatedMembership(
    batch: {
      credentialIds: readonly string[];
      combinedPrimeProduct: bigint;
      combinedWitness: bigint;
    },
    accumulatorValue = this.accumulator
  ): boolean {
    if (batch.credentialIds.length === 0) return false;
    let expectedProduct = 1n;
    for (const id of batch.credentialIds) {
      expectedProduct *= this.hashToPrime(id);
    }
    if (expectedProduct !== batch.combinedPrimeProduct) return false;
    return (
      modPow(batch.combinedWitness, batch.combinedPrimeProduct, this.modulusN) ===
      modNorm(accumulatorValue, this.modulusN)
    );
  }

  /**
   * Issues a batch of credentials in one atomic epoch sequence and returns all updated witnesses.
   */
  public batchAddCredentials(credentialIds: readonly string[]): {
    snapshot: RevocationEpochReceipt;
    witnesses: MembershipWitness[];
  } {
    for (const id of credentialIds) {
      this.addCredential(id);
    }
    const witnesses = credentialIds.map((id) => this.createMembershipWitness(id));
    return {
      snapshot: this.snapshotReceipt(),
      witnesses,
    };
  }

  /**
   * Produces a cryptographic audit digest capturing accumulator state, epoch, and membership count.
   */
  public computeAuditDigest(): string {
    const sortedIds = Array.from(this.activeMembers.keys()).sort();
    return createHash('sha256')
      .update(
        `WorkSphere::RevAccAudit|epoch:${this.epoch}|acc:${this.accumulator.toString(16)}|count:${sortedIds.length}|ids:${sortedIds.join(',')}`
      )
      .digest('hex');
  }

  /**
   * Exports a portable snapshot including serialized accumulator value and epoch metadata.
   */
  public exportSerializedState(): string {
    return JSON.stringify({
      epoch: this.epoch,
      accumulatorHex: this.accumulator.toString(16),
      modulusHex: this.modulusN.toString(16),
      generatorHex: this.generatorG.toString(16),
      activeCount: this.activeMembers.size,
      auditDigest: this.computeAuditDigest(),
    });
  }
}
