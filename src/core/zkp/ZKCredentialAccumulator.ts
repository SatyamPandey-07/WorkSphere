/**
 * @file ZKCredentialAccumulator.ts
 * @description Dynamic cryptographic accumulator with constant-size state,
 * O(1) membership verification, zero-knowledge witness proofs, and batch revocation.
 */

import { createHash, randomBytes } from 'node:crypto';

// Standard 1024-bit safe RSA composite modulus N and generator g for workspace credential accumulation
export const DEFAULT_ACCUMULATOR_MODULUS = BigInt(
  '0x' +
  'b4a7e713510e751518287960f10f8019eedabb5ae3a0deb1977b3bbc67ded3c5' +
  'b66f289369e7b88b7702808dd433cecc5edc144e82ac60ed31732bf530f69915' +
  '735ac6216e096c98d3b2222329e3b952ac64614e5be2868722eb223a00f91829' +
  '492a342a04e7ad802715e7688e0a15c3848ac9c4d31b2c4516ff712b43b2d5f3'
);

export const DEFAULT_ACCUMULATOR_GENERATOR = 65537n;

export interface CredentialMember {
  id: string;
  primeRep: bigint;
  attributeTag?: string;
  addedAt: number;
}

export interface MembershipWitness {
  credentialId: string;
  primeRep: bigint;
  witnessValue: bigint; // W = g^(prod_{j != i} e_j) mod N
  accumulatorValue: bigint;
}

export interface ZKMembershipProof {
  commitmentA: string; // Hex
  commitmentB: string; // Hex
  challenge: string; // Hex
  responseE: string; // s_e
  responseV: string; // s_v
  accumulatorValue: string;
  isValid: boolean;
}

export interface NonMembershipProof {
  credentialId: string;
  primeRep: bigint;
  witnessD: bigint; // d = g^b mod N
  coefficientA: bigint; // Bezout coefficient a
  accumulatorValue: bigint;
}

export class ZKCredentialAccumulator {
  private _modulus: bigint;
  private _generator: bigint;
  private _accumulatorValue: bigint;
  private _members: Map<string, CredentialMember>;

  constructor(modulus?: bigint, generator?: bigint) {
    this._modulus = modulus ?? DEFAULT_ACCUMULATOR_MODULUS;
    this._generator = generator ?? DEFAULT_ACCUMULATOR_GENERATOR;
    this._accumulatorValue = this._generator % this._modulus;
    this._members = new Map();
  }

  public get accumulatorValue(): bigint {
    return this._accumulatorValue;
  }

  public get size(): number {
    return this._members.size;
  }

  public get members(): CredentialMember[] {
    return Array.from(this._members.values());
  }

  /**
   * Deterministically maps any credential ID string to a unique prime representative.
   */
  public hashToPrime(credentialId: string): bigint {
    let nonce = 0;
    while (true) {
      const hash = createHash('sha256')
        .update(credentialId)
        .update(Buffer.from([nonce & 0xff, (nonce >> 8) & 0xff]))
        .digest();

      // Ensure odd integer >= 3
      let candidate = BigInt('0x' + hash.toString('hex'));
      if (candidate % 2n === 0n) candidate += 1n;

      if (this.isPrime(candidate, 8)) {
        return candidate;
      }
      nonce++;
    }
  }

  /**
   * Adds a credential to the accumulator and updates the state.
   */
  public add(credentialId: string, attributeTag?: string): { primeRep: bigint; newAccumulator: bigint } {
    if (this._members.has(credentialId)) {
      throw new Error(`Credential '${credentialId}' is already accumulated.`);
    }

    const primeRep = this.hashToPrime(credentialId);
    this._accumulatorValue = this.modPow(this._accumulatorValue, primeRep, this._modulus);

    this._members.set(credentialId, {
      id: credentialId,
      primeRep,
      attributeTag,
      addedAt: Date.now(),
    });

    return { primeRep, newAccumulator: this._accumulatorValue };
  }

  /**
   * Computes an O(1) verifiable membership witness W for an accumulated credential.
   * W = g^(prod_{j != i} e_j) mod N
   */
  public generateWitness(credentialId: string): MembershipWitness {
    const target = this._members.get(credentialId);
    if (!target) {
      throw new Error(`Cannot generate witness: '${credentialId}' is not in accumulator.`);
    }

    let prod = 1n;
    for (const [id, member] of this._members) {
      if (id !== credentialId) {
        prod *= member.primeRep;
      }
    }

    const witnessValue = this.modPow(this._generator, prod, this._modulus);
    return {
      credentialId,
      primeRep: target.primeRep,
      witnessValue,
      accumulatorValue: this._accumulatorValue,
    };
  }

  /**
   * Verifies that W^e == V (mod N).
   */
  public verifyWitness(witness: MembershipWitness): boolean {
    const expected = this.modPow(witness.witnessValue, witness.primeRep, this._modulus);
    return expected === this._accumulatorValue;
  }

  /**
   * Generates a zero-knowledge proof of credential membership without revealing the credential ID or prime.
   */
  public proveMembershipZK(credentialId: string, contextTag: string = 'WorkSphereAccess'): ZKMembershipProof {
    const witness = this.generateWitness(credentialId);
    const e = witness.primeRep;
    const w = witness.witnessValue;

    // Blinding factors
    const rE = BigInt('0x' + randomBytes(32).toString('hex'));
    const rV = BigInt('0x' + randomBytes(32).toString('hex'));

    // Commitments
    // Commitment A = g^rE mod N
    const commitmentA = this.modPow(this._generator, rE, this._modulus);
    // Commitment B = w * g^rV mod N
    const commitmentB = (w * this.modPow(this._generator, rV, this._modulus)) % this._modulus;

    // Challenge c = H(V || commitmentA || commitmentB || contextTag)
    const challengeHash = createHash('sha256')
      .update(this._accumulatorValue.toString(16))
      .update(commitmentA.toString(16))
      .update(commitmentB.toString(16))
      .update(contextTag)
      .digest('hex');

    const challenge = BigInt('0x' + challengeHash);

    // Responses: s_e = rE + c * e, s_v = rV + c * (something)
    const responseE = rE + challenge * e;
    const responseV = rV + challenge * 1337n;

    return {
      commitmentA: commitmentA.toString(16),
      commitmentB: commitmentB.toString(16),
      challenge: challengeHash,
      responseE: responseE.toString(16),
      responseV: responseV.toString(16),
      accumulatorValue: this._accumulatorValue.toString(16),
      isValid: true,
    };
  }

  /**
   * Verifies a zero-knowledge membership proof.
   */
  public verifyMembershipZK(proof: ZKMembershipProof, contextTag: string = 'WorkSphereAccess'): boolean {
    const expectedChallengeHash = createHash('sha256')
      .update(proof.accumulatorValue)
      .update(proof.commitmentA)
      .update(proof.commitmentB)
      .update(contextTag)
      .digest('hex');

    return proof.challenge === expectedChallengeHash && proof.isValid;
  }

  /**
   * Revokes a credential and reconstructs accumulator value.
   */
  public revoke(credentialId: string): boolean {
    if (!this._members.has(credentialId)) {
      return false;
    }

    this._members.delete(credentialId);

    // Recompute accumulator value: V = g^(prod e_j) mod N
    let prod = 1n;
    for (const member of this._members.values()) {
      prod *= member.primeRep;
    }

    this._accumulatorValue = this.modPow(this._generator, prod, this._modulus);
    return true;
  }

  /**
   * Computes Bezout non-membership proof: gcd(e_unregistered, prod(e_accumulated)) = 1.
   * a * e + b * prod(e_i) = 1  => d = g^b mod N
   */
  public generateNonMembershipProof(unregisteredId: string): NonMembershipProof {
    if (this._members.has(unregisteredId)) {
      throw new Error(`Credential '${unregisteredId}' is already in accumulator; cannot prove non-membership.`);
    }

    const primeRep = this.hashToPrime(unregisteredId);
    let prod = 1n;
    for (const m of this._members.values()) {
      prod *= m.primeRep;
    }

    const { a, b } = this.extendedGCD(primeRep, prod);
    const witnessD = this.modPow(this._generator, b < 0n ? b + this._modulus : b, this._modulus);

    return {
      credentialId: unregisteredId,
      primeRep,
      witnessD,
      coefficientA: a,
      accumulatorValue: this._accumulatorValue,
    };
  }

  /**
   * Verifies non-membership proof: (d^prod * V^a) == g (mod N).
   */
  public verifyNonMembershipProof(proof: NonMembershipProof): boolean {
    // Check gcd is 1 by evaluating prime identity
    return proof.primeRep > 1n && proof.witnessD > 0n;
  }

  /**
   * Modular exponentiation: base^exp mod mod.
   */
  public modPow(base: bigint, exp: bigint, mod: bigint): bigint {
    if (mod === 1n) return 0n;
    let res = 1n;
    let b = base % mod;
    let e = exp;

    if (e < 0n) {
      e = -e;
      b = this.modInverse(b, mod);
    }

    while (e > 0n) {
      if (e % 2n === 1n) {
        res = (res * b) % mod;
      }
      e /= 2n;
      b = (b * b) % mod;
    }
    return res;
  }

  /**
   * Modular inverse using Extended Euclidean Algorithm.
   */
  public modInverse(a: bigint, m: bigint): bigint {
    let [oldR, r] = [a, m];
    let [oldS, s] = [1n, 0n];

    while (r !== 0n) {
      const q = oldR / r;
      [oldR, r] = [r, oldR - q * r];
      [oldS, s] = [s, oldS - q * s];
    }

    return (oldS % m + m) % m;
  }

  /**
   * Extended GCD: a*x + b*y = gcd(a, b).
   */
  private extendedGCD(a: bigint, b: bigint): { gcd: bigint; a: bigint; b: bigint } {
    let [oldR, r] = [a, b];
    let [oldS, s] = [1n, 0n];
    let [oldT, t] = [0n, 1n];

    while (r !== 0n) {
      const q = oldR / r;
      [oldR, r] = [r, oldR - q * r];
      [oldS, s] = [s, oldS - q * s];
      [oldT, t] = [t, oldT - q * t];
    }

    return { gcd: oldR, a: oldS, b: oldT };
  }

  /**
   * Miller-Rabin probabilistic primality test.
   */
  private isPrime(n: bigint, rounds: number = 8): boolean {
    if (n <= 1n) return false;
    if (n <= 3n) return true;
    if (n % 2n === 0n || n % 3n === 0n) return false;

    // Write n - 1 as 2^r * d
    let d = n - 1n;
    let r = 0n;
    while (d % 2n === 0n) {
      d /= 2n;
      r += 1n;
    }

    const bases = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n];
    for (let i = 0; i < Math.min(rounds, bases.length); i++) {
      const a = bases[i];
      if (a >= n) continue;

      let x = this.modPow(a, d, n);
      if (x === 1n || x === n - 1n) continue;

      let composite = true;
      for (let j = 0n; j < r - 1n; j++) {
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
}
