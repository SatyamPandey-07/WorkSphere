/**
 * @file WeightedThresholdEncryption.ts
 * @description Weighted Threshold ElGamal Encryption & Decryption Engine for PoS Committees.
 * Maps non-uniform integer validator stake weights to multi-slot Shamir shares over BN254,
 * attaches Chaum-Pedersen DLEQ verifiability proofs to every weighted partial decryption,
 * and reconstructs ciphertexts once cumulative verified stake meets threshold weight W.
 */

import { createHash, randomBytes } from 'crypto';

export const WTE_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const WTE_GENERATOR = 3n;

export class WTEFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = WTE_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = WTE_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = WTE_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = WTE_PRIME): bigint {
    let res = 1n;
    let b = ((base % p) + p) % p;
    let e = exponent < 0n ? (exponent % (p - 1n)) + (p - 1n) : exponent % (p - 1n);
    while (e > 0n) {
      if (e & 1n) res = (res * b) % p;
      b = (b * b) % p;
      e >>= 1n;
    }
    return res;
  }

  public static inv(val: bigint, p: bigint = WTE_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('WTEFieldMath: Division by zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = WTE_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    const v = BigInt('0x' + h) % p;
    return v === 0n ? 1n : v;
  }

  public static randomScalar(p: bigint = WTE_PRIME): bigint {
    const b = randomBytes(32);
    const v = BigInt('0x' + b.toString('hex')) % p;
    return v === 0n ? 1n : v;
  }
}

export interface WeightedValidatorSpec {
  validatorId: string;
  weight: number;
}

export interface AssignedSlotShare {
  slotIndex: number;
  shareVal: bigint;
  publicPoint: bigint;
}

export interface WeightedValidatorAllocation {
  validatorId: string;
  weight: number;
  slots: AssignedSlotShare[];
}

export interface WeightedCiphertext {
  c1: bigint;
  c2: bigint;
}

export interface SlotDLEQProof {
  commG: bigint;
  commC1: bigint;
  challenge: bigint;
  response: bigint;
}

export interface SlotDecryptionShare {
  slotIndex: number;
  partialPoint: bigint;
  proof: SlotDLEQProof;
}

export interface WeightedDecryptionBundle {
  validatorId: string;
  weight: number;
  slotShares: SlotDecryptionShare[];
}

export interface WeightedDecryptionResult {
  success: boolean;
  plaintext?: bigint;
  verifiedWeight: number;
  requiredWeight: number;
  reason?: string;
}

export class WeightedThresholdEncryption {
  public readonly prime: bigint;
  public readonly g: bigint;
  private slotPublicKeys: Map<number, bigint> = new Map();
  private validatorSlots: Map<string, Set<number>> = new Map();
  private weightThreshold: number = 0;
  private groupPublicKey: bigint = 0n;

  constructor(prime: bigint = WTE_PRIME, g: bigint = WTE_GENERATOR) {
    this.prime = prime;
    this.g = g;
  }

  /**
   * Allocates weight-proportional Shamir share slots to validators for threshold weight W.
   */
  public allocateWeightedShares(
    masterVal: bigint,
    weightThreshold: number,
    validators: WeightedValidatorSpec[]
  ): { groupPublicKey: bigint; allocations: Map<string, WeightedValidatorAllocation> } {
    const totalWeight = validators.reduce((acc, v) => acc + v.weight, 0);
    if (weightThreshold < 1 || weightThreshold > totalWeight) {
      throw new Error(`Invalid weight threshold ${weightThreshold} for total weight ${totalWeight}`);
    }

    this.weightThreshold = weightThreshold;
    this.slotPublicKeys.clear();
    this.validatorSlots.clear();

    const normMaster = ((masterVal % this.prime) + this.prime) % this.prime;
    const coeffs: bigint[] = [normMaster];
    for (let k = 1; k < weightThreshold; k++) {
      coeffs.push(WTEFieldMath.randomScalar(this.prime));
    }

    this.groupPublicKey = WTEFieldMath.mul(normMaster, this.g, this.prime);
    const allocations = new Map<string, WeightedValidatorAllocation>();

    let nextSlot = 1;
    for (const v of validators) {
      if (v.weight < 1) throw new Error(`Validator ${v.validatorId} weight must be >= 1`);
      const slots: AssignedSlotShare[] = [];
      const slotSet = new Set<number>();

      for (let w = 0; w < v.weight; w++) {
        const slotIdx = nextSlot++;
        const x = BigInt(slotIdx);
        let y = 0n;
        let xPow = 1n;
        for (let c = 0; c < coeffs.length; c++) {
          y = WTEFieldMath.add(y, WTEFieldMath.mul(coeffs[c], xPow, this.prime), this.prime);
          xPow = WTEFieldMath.mul(xPow, x, this.prime);
        }

        const publicPoint = WTEFieldMath.mul(y, this.g, this.prime);
        this.slotPublicKeys.set(slotIdx, publicPoint);
        slotSet.add(slotIdx);
        slots.push({ slotIndex: slotIdx, shareVal: y, publicPoint });
      }

      this.validatorSlots.set(v.validatorId, slotSet);
      allocations.set(v.validatorId, {
        validatorId: v.validatorId,
        weight: v.weight,
        slots,
      });
    }

    return { groupPublicKey: this.groupPublicKey, allocations };
  }

  /**
   * Encrypts a numeric plaintext under the weighted group public key.
   */
  public encrypt(plaintext: bigint, groupPubKey: bigint = this.groupPublicKey): WeightedCiphertext {
    const m = ((plaintext % this.prime) + this.prime) % this.prime;
    const r = WTEFieldMath.randomScalar(this.prime);
    const c1 = WTEFieldMath.mul(r, this.g, this.prime);
    const c2 = WTEFieldMath.add(m, WTEFieldMath.mul(r, groupPubKey, this.prime), this.prime);
    return { c1, c2 };
  }

  /**
   * Produces a weighted decryption bundle with Chaum-Pedersen DLEQ proofs for every assigned slot.
   */
  public createWeightedBundle(
    allocation: WeightedValidatorAllocation,
    c1: bigint
  ): WeightedDecryptionBundle {
    const slotShares: SlotDecryptionShare[] = allocation.slots.map((slot) => {
      const partialPoint = WTEFieldMath.mul(slot.shareVal, c1, this.prime);
      const k = WTEFieldMath.randomScalar(this.prime);
      const commG = WTEFieldMath.mul(k, this.g, this.prime);
      const commC1 = WTEFieldMath.mul(k, c1, this.prime);

      const transcript = [
        allocation.validatorId,
        slot.slotIndex,
        this.g.toString(16),
        slot.publicPoint.toString(16),
        c1.toString(16),
        partialPoint.toString(16),
        commG.toString(16),
        commC1.toString(16),
      ].join(':');

      const challenge = WTEFieldMath.hashToScalar(transcript, this.prime);
      const response = WTEFieldMath.add(k, WTEFieldMath.mul(challenge, slot.shareVal, this.prime), this.prime);

      return {
        slotIndex: slot.slotIndex,
        partialPoint,
        proof: { commG, commC1, challenge, response },
      };
    });

    return {
      validatorId: allocation.validatorId,
      weight: allocation.weight,
      slotShares,
    };
  }

  /**
   * Verifies every DLEQ proof in a validator's weighted bundle.
   */
  public verifyWeightedBundle(bundle: WeightedDecryptionBundle, c1: bigint): boolean {
    const allowedSlots = this.validatorSlots.get(bundle.validatorId);
    if (!allowedSlots || bundle.slotShares.length !== allowedSlots.size) return false;

    const seen = new Set<number>();
    for (const slot of bundle.slotShares) {
      if (!allowedSlots.has(slot.slotIndex) || seen.has(slot.slotIndex)) return false;
      seen.add(slot.slotIndex);

      const pk = this.slotPublicKeys.get(slot.slotIndex);
      if (pk === undefined) return false;

      const transcript = [
        bundle.validatorId,
        slot.slotIndex,
        this.g.toString(16),
        pk.toString(16),
        c1.toString(16),
        slot.partialPoint.toString(16),
        slot.proof.commG.toString(16),
        slot.proof.commC1.toString(16),
      ].join(':');

      const expectedChal = WTEFieldMath.hashToScalar(transcript, this.prime);
      if (slot.proof.challenge !== expectedChal) return false;

      const lhsG = WTEFieldMath.mul(slot.proof.response, this.g, this.prime);
      const rhsG = WTEFieldMath.add(
        slot.proof.commG,
        WTEFieldMath.mul(slot.proof.challenge, pk, this.prime),
        this.prime
      );
      if (lhsG !== rhsG) return false;

      const lhsC1 = WTEFieldMath.mul(slot.proof.response, c1, this.prime);
      const rhsC1 = WTEFieldMath.add(
        slot.proof.commC1,
        WTEFieldMath.mul(slot.proof.challenge, slot.partialPoint, this.prime),
        this.prime
      );
      if (lhsC1 !== rhsC1) return false;
    }

    return true;
  }

  /**
   * Reconstructs the plaintext once verified validator bundles reach threshold weight W.
   */
  public reconstructPlaintext(
    ciphertext: WeightedCiphertext,
    bundles: WeightedDecryptionBundle[]
  ): WeightedDecryptionResult {
    const verifiedSlots: SlotDecryptionShare[] = [];
    const seenValidators = new Set<string>();

    for (const bundle of bundles) {
      if (seenValidators.has(bundle.validatorId)) continue;
      if (!this.verifyWeightedBundle(bundle, ciphertext.c1)) {
        return {
          success: false,
          verifiedWeight: verifiedSlots.length,
          requiredWeight: this.weightThreshold,
          reason: `Bundle from validator ${bundle.validatorId} failed DLEQ verification`,
        };
      }
      seenValidators.add(bundle.validatorId);
      verifiedSlots.push(...bundle.slotShares);
    }

    if (verifiedSlots.length < this.weightThreshold) {
      return {
        success: false,
        verifiedWeight: verifiedSlots.length,
        requiredWeight: this.weightThreshold,
        reason: `Insufficient verified stake weight: ${verifiedSlots.length} < ${this.weightThreshold}`,
      };
    }

    const active = verifiedSlots.slice(0, this.weightThreshold);
    const xs = active.map((s) => BigInt(s.slotIndex));
    let sharedMask = 0n;

    for (let i = 0; i < this.weightThreshold; i++) {
      let num = 1n;
      let den = 1n;
      for (let j = 0; j < this.weightThreshold; j++) {
        if (i === j) continue;
        num = WTEFieldMath.mul(num, WTEFieldMath.sub(0n, xs[j], this.prime), this.prime);
        den = WTEFieldMath.mul(den, WTEFieldMath.sub(xs[i], xs[j], this.prime), this.prime);
      }
      const lambda = WTEFieldMath.mul(num, WTEFieldMath.inv(den, this.prime), this.prime);
      sharedMask = WTEFieldMath.add(
        sharedMask,
        WTEFieldMath.mul(lambda, active[i].partialPoint, this.prime),
        this.prime
      );
    }

    const plaintext = WTEFieldMath.sub(ciphertext.c2, sharedMask, this.prime);
    return {
      success: true,
      plaintext,
      verifiedWeight: verifiedSlots.length,
      requiredWeight: this.weightThreshold,
    };
  }
}
