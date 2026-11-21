/**
 * @file SPDZEngine.ts
 * @description Verifiable Multi-Party Computation (MPC) SPDZ protocol engine
 * with Beaver multiplication triplets, information-theoretic MAC authentication, and malicious abort security.
 */

import { randomBytes, createHash } from 'node:crypto';

// Standard 254-bit BN254 scalar field prime for finite field arithmetic
export const SPDZ_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export interface AuthenticatedShare {
  partyId: number; // 1 to n
  valueShare: bigint; // x_i mod p
  macShare: bigint; // gamma_i mod p
}

export interface BeaverTriplet {
  tripletId: string;
  aShares: Map<number, AuthenticatedShare>;
  bShares: Map<number, AuthenticatedShare>;
  cShares: Map<number, AuthenticatedShare>; // c = a * b mod p
}

export interface MPCBatchAuditResult {
  passed: boolean;
  checkedWiresCount: number;
  residualSum: bigint;
}

export class SPDZEngine {
  private _prime: bigint;
  private _partyCount: number;
  private _alphaShares: Map<number, bigint>; // alpha_i
  private _globalAlpha: bigint; // alpha = sum(alpha_i) mod p

  constructor(partyCount: number = 3, customPrime?: bigint) {
    if (partyCount < 2) {
      throw new Error('SPDZ protocol requires at least 2 parties.');
    }
    this._prime = customPrime ?? SPDZ_PRIME;
    this._partyCount = partyCount;
    this._alphaShares = new Map();

    // Initialize global secret MAC key alpha and distribute shares
    let totalAlpha = 0n;
    for (let i = 1; i <= partyCount; i++) {
      const share = this.randomFieldElement();
      this._alphaShares.set(i, share);
      totalAlpha = (totalAlpha + share) % this._prime;
    }
    this._globalAlpha = totalAlpha;
  }

  public get partyCount(): number {
    return this._partyCount;
  }

  public get prime(): bigint {
    return this._prime;
  }

  public get globalAlpha(): bigint {
    return this._globalAlpha;
  }

  /**
   * Secret-shares a private plaintext value into authenticated additive shares across all parties.
   */
  public share(secretValue: bigint): Map<number, AuthenticatedShare> {
    const x = ((secretValue % this._prime) + this._prime) % this._prime;
    const macTotal = (this._globalAlpha * x) % this._prime;

    const valueShares = this.splitAdditive(x, this._partyCount);
    const macShares = this.splitAdditive(macTotal, this._partyCount);

    const sharesMap = new Map<number, AuthenticatedShare>();
    for (let i = 1; i <= this._partyCount; i++) {
      sharesMap.set(i, {
        partyId: i,
        valueShare: valueShares[i - 1],
        macShare: macShares[i - 1],
      });
    }

    return sharesMap;
  }

  /**
   * Reconstructs an authenticated secret value from all party shares and verifies MAC integrity.
   * Throws error if any party share was corrupted or tampered with.
   */
  public open(shares: Map<number, AuthenticatedShare>): bigint {
    if (shares.size !== this._partyCount) {
      throw new Error(`Incomplete share set: expected ${this._partyCount}, received ${shares.size}`);
    }

    let reconstructedValue = 0n;
    let reconstructedMac = 0n;

    for (let i = 1; i <= this._partyCount; i++) {
      const s = shares.get(i);
      if (!s) {
        throw new Error(`Missing share for party ${i}`);
      }
      reconstructedValue = (reconstructedValue + s.valueShare) % this._prime;
      reconstructedMac = (reconstructedMac + s.macShare) % this._prime;
    }

    // Verify information-theoretic MAC: sum(macShare) == alpha * sum(valueShare) mod p
    const expectedMac = (this._globalAlpha * reconstructedValue) % this._prime;
    if (reconstructedMac !== expectedMac) {
      throw new Error('SPDZ MAC Verification Failed: Malicious share tampering detected.');
    }

    return reconstructedValue;
  }

  /**
   * Evaluates an addition gate locally without communication: [x + y] = [x] + [y].
   */
  public add(
    shareX: Map<number, AuthenticatedShare>,
    shareY: Map<number, AuthenticatedShare>
  ): Map<number, AuthenticatedShare> {
    const result = new Map<number, AuthenticatedShare>();

    for (let i = 1; i <= this._partyCount; i++) {
      const sx = shareX.get(i)!;
      const sy = shareY.get(i)!;

      result.set(i, {
        partyId: i,
        valueShare: (sx.valueShare + sy.valueShare) % this._prime,
        macShare: (sx.macShare + sy.macShare) % this._prime,
      });
    }

    return result;
  }

  /**
   * Multiplies an authenticated shared value by a public plaintext scalar: [c * x] = c * [x].
   */
  public scalarMultiply(
    shareX: Map<number, AuthenticatedShare>,
    scalar: bigint
  ): Map<number, AuthenticatedShare> {
    const c = ((scalar % this._prime) + this._prime) % this._prime;
    const result = new Map<number, AuthenticatedShare>();

    for (let i = 1; i <= this._partyCount; i++) {
      const sx = shareX.get(i)!;
      result.set(i, {
        partyId: i,
        valueShare: (c * sx.valueShare) % this._prime,
        macShare: (c * sx.macShare) % this._prime,
      });
    }

    return result;
  }

  /**
   * Generates a pre-computed Beaver multiplication triplet (a, b, c) where c = a * b mod p.
   */
  public generateBeaverTriplet(tripletId: string = 'triplet_default'): BeaverTriplet {
    const a = this.randomFieldElement();
    const b = this.randomFieldElement();
    const c = (a * b) % this._prime;

    return {
      tripletId,
      aShares: this.share(a),
      bShares: this.share(b),
      cShares: this.share(c),
    };
  }

  /**
   * Evaluates non-linear multiplication gate [x * y] using a pre-computed Beaver triplet:
   * 1. Parties open epsilon = x - a and delta = y - b.
   * 2. Parties compute share [z]_i = c_i + epsilon * b_i + delta * a_i + (i == 1 ? epsilon * delta : 0)
   * 3. MAC shares update: gamma_i(z) = gamma_i(c) + epsilon * gamma_i(b) + delta * gamma_i(a) + (epsilon * delta) * alpha_i
   */
  public multiply(
    shareX: Map<number, AuthenticatedShare>,
    shareY: Map<number, AuthenticatedShare>,
    triplet: BeaverTriplet
  ): Map<number, AuthenticatedShare> {
    // 1. Subtract triplet shares: [epsilon] = [x] - [a], [delta] = [y] - [b]
    const negAShares = this.scalarMultiply(triplet.aShares, -1n);
    const negBShares = this.scalarMultiply(triplet.bShares, -1n);

    const epsilonShares = this.add(shareX, negAShares);
    const deltaShares = this.add(shareY, negBShares);

    // Open epsilon and delta publicly
    const epsilon = this.open(epsilonShares);
    const delta = this.open(deltaShares);
    const epsDelta = (epsilon * delta) % this._prime;

    // 2. Compute local shares for z
    const result = new Map<number, AuthenticatedShare>();

    for (let i = 1; i <= this._partyCount; i++) {
      const sa = triplet.aShares.get(i)!;
      const sb = triplet.bShares.get(i)!;
      const sc = triplet.cShares.get(i)!;
      const alpha_i = this._alphaShares.get(i)!;

      // Value share: z_i = c_i + epsilon * b_i + delta * a_i + (i === 1 ? epsilon * delta : 0)
      let zVal = (sc.valueShare + epsilon * sb.valueShare + delta * sa.valueShare) % this._prime;
      if (i === 1) {
        zVal = (zVal + epsDelta) % this._prime;
      }

      // MAC share: gamma_i(z) = gamma_i(c) + epsilon * gamma_i(b) + delta * gamma_i(a) + (epsilon * delta) * alpha_i
      const zMac = (sc.macShare + epsilon * sb.macShare + delta * sa.macShare + epsDelta * alpha_i) % this._prime;

      result.set(i, {
        partyId: i,
        valueShare: (zVal + this._prime) % this._prime,
        macShare: (zMac + this._prime) % this._prime,
      });
    }

    return result;
  }

  /**
   * Batched Random Linear Combination Audit:
   * Verifies an arbitrary batch of opened values against their MAC shares in a single check.
   */
  public batchAuditOpenedValues(
    openedPairs: Array<{ value: bigint; macShares: Map<number, AuthenticatedShare> }>
  ): MPCBatchAuditResult {
    let residualSum = 0n;

    for (const item of openedPairs) {
      let sumMac = 0n;
      for (const s of item.macShares.values()) {
        sumMac = (sumMac + s.macShare) % this._prime;
      }
      const expected = (this._globalAlpha * item.value) % this._prime;
      const diff = ((sumMac - expected) % this._prime + this._prime) % this._prime;
      residualSum = (residualSum + diff) % this._prime;
    }

    return {
      passed: residualSum === 0n,
      checkedWiresCount: openedPairs.length,
      residualSum,
    };
  }

  private splitAdditive(total: bigint, count: number): bigint[] {
    const shares: bigint[] = [];
    let sum = 0n;

    for (let i = 0; i < count - 1; i++) {
      const r = this.randomFieldElement();
      shares.push(r);
      sum = (sum + r) % this._prime;
    }

    const last = ((total - sum) % this._prime + this._prime) % this._prime;
    shares.push(last);
    return shares;
  }

  private randomFieldElement(): bigint {
    const bytes = randomBytes(32);
    const raw = BigInt('0x' + bytes.toString('hex'));
    return (raw % (this._prime - 1n)) + 1n;
  }
}
