/**
 * @file VerifiableThresholdElGamalKeyGenProver.ts
 * @description Multi-Party Threshold ElGamal Key Aggregation with Schnorr Proofs-of-Possession
 * (PoP), Encrypted Share Consistency Verification, Rogue-Key Defense, Collaborative ElGamal
 * Decryption Auditing, and Portable JSON Serialization.
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface KeyGenPartyRegistration {
  partyId: string;
  publicKey: bigint;
  popNonceR: bigint;
  popChallenge: bigint;
  popResponse: bigint;
}

export interface KeyGenPartySecret {
  partyId: string;
  secretKey: bigint;
  publicKey: bigint;
  registration: KeyGenPartyRegistration;
}

export interface AggregatedElGamalCommittee {
  committeeId: string;
  acceptedPartyIds: string[];
  rejectedPartyIds: string[];
  partyPublicKeys: Map<string, bigint>;
  jointPublicKey: bigint;
  committeeDigest: string;
}

export interface CollaborativeCiphertext {
  ciphertextId: string;
  c1: bigint;
  c2: bigint;
}

export interface PartyDecryptionContribution {
  ciphertextId: string;
  partyId: string;
  partialD: bigint;
  dleqU: bigint;
  dleqV: bigint;
  challenge: bigint;
  response: bigint;
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

function modInverse(a: bigint, m: bigint): bigint {
  let t = 0n;
  let newT = 1n;
  let r = m;
  let newR = modNorm(a, m);
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  if (r > 1n) throw new Error('Not invertible');
  return t < 0n ? t + m : t;
}

function randomScalar(q: bigint): bigint {
  return (BigInt(`0x${randomBytes(16).toString('hex')}`) % (q - 2n)) + 2n;
}

function hashScalar(domain: string, parts: readonly (string | bigint)[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const part of parts) {
    h.update('|');
    h.update(typeof part === 'bigint' ? part.toString(16) : part);
  }
  return (BigInt(`0x${h.digest('hex')}`) % (SUBGROUP_Q - 1n)) + 1n;
}

/**
 * Multi-Party ElGamal Key Aggregation (n-of-n PoP-Protected Joint Key) & Collaborative Decryption Engine.
 */
export class VerifiableThresholdElGamalKeyGenProver {
  private readonly p: bigint;
  private readonly q: bigint;
  private readonly g: bigint;

  constructor(p = SAFE_PRIME_P, q = SUBGROUP_Q, g = BASE_G) {
    if (p !== 2n * q + 1n) {
      throw new Error('Safe prime invariant p = 2q + 1 is required');
    }
    this.p = p;
    this.q = q;
    this.g = g;
  }

  public isSubgroupElement(x: bigint): boolean {
    return x > 1n && x < this.p && modPow(x, this.q, this.p) === 1n;
  }

  /**
   * Generates a party's key pair and a non-interactive Schnorr Proof-of-Possession (PoP)
   * bound to `committeeId` (preventing rogue-key cancellation attacks pk_mal = pk_honest^{-1}).
   */
  public registerParty(committeeId: string, partyId: string, seedSecret?: bigint): KeyGenPartySecret {
    const secretKey = seedSecret !== undefined
      ? modNorm(seedSecret, this.q - 2n) + 2n
      : randomScalar(this.q);
    const publicKey = modPow(this.g, secretKey, this.p);

    const k = randomScalar(this.q);
    const popNonceR = modPow(this.g, k, this.p);
    const popChallenge = hashScalar('WorkSphere::JointElGamalPoP', [
      committeeId,
      partyId,
      publicKey,
      popNonceR,
    ]);
    const popResponse = modNorm(k + popChallenge * secretKey, this.q);

    return {
      partyId,
      secretKey,
      publicKey,
      registration: {
        partyId,
        publicKey,
        popNonceR,
        popChallenge,
        popResponse,
      },
    };
  }

  public verifyRegistration(committeeId: string, reg: KeyGenPartyRegistration): boolean {
    if (!this.isSubgroupElement(reg.publicKey)) return false;
    const expectedC = hashScalar('WorkSphere::JointElGamalPoP', [
      committeeId,
      reg.partyId,
      reg.publicKey,
      reg.popNonceR,
    ]);
    if (expectedC !== reg.popChallenge) return false;
    const lhs = modPow(this.g, modNorm(reg.popResponse, this.q), this.p);
    const rhs = (reg.popNonceR * modPow(reg.publicKey, reg.popChallenge, this.p)) % this.p;
    return lhs === rhs;
  }

  /**
   * Forms the joint committee public key PK = Prod pk_i mod p ONLY over parties whose PoPs verify!
   */
  public aggregateCommitteeKey(
    committeeId: string,
    registrations: readonly KeyGenPartyRegistration[]
  ): AggregatedElGamalCommittee {
    const seen = new Set<string>();
    const acceptedPartyIds: string[] = [];
    const rejectedPartyIds: string[] = [];
    const partyPublicKeys = new Map<string, bigint>();
    let jointPublicKey = 1n;

    for (const reg of registrations) {
      if (seen.has(reg.partyId) || !this.verifyRegistration(committeeId, reg)) {
        rejectedPartyIds.push(reg.partyId);
        continue;
      }
      seen.add(reg.partyId);
      acceptedPartyIds.push(reg.partyId);
      partyPublicKeys.set(reg.partyId, reg.publicKey);
      jointPublicKey = (jointPublicKey * reg.publicKey) % this.p;
    }

    if (acceptedPartyIds.length === 0) {
      throw new Error('Zero valid party registrations passed Proof-of-Possession check');
    }

    const committeeDigest = createHash('sha256')
      .update(`${committeeId}|acc:${acceptedPartyIds.join(',')}|pk:${jointPublicKey.toString(16)}`)
      .digest('hex');

    return {
      committeeId,
      acceptedPartyIds,
      rejectedPartyIds,
      partyPublicKeys,
      jointPublicKey,
      committeeDigest,
    };
  }

  public encodeValue(val: bigint): bigint {
    if (val < 0n || val >= this.q) throw new RangeError('Value out of subgroup range');
    return modPow(this.g, val, this.p);
  }

  public encryptUnderJointKey(
    ciphertextId: string,
    jointPublicKey: bigint,
    messageElement: bigint
  ): CollaborativeCiphertext {
    const r = randomScalar(this.q);
    return {
      ciphertextId,
      c1: modPow(this.g, r, this.p),
      c2: (modNorm(messageElement, this.p) * modPow(jointPublicKey, r, this.p)) % this.p,
    };
  }

  /**
   * Computes a party's partial decryption D_i = c1^{sk_i} with a Chaum-Pedersen DLEQ proof.
   */
  public produceDecryptionContribution(
    committeeId: string,
    ciphertext: CollaborativeCiphertext,
    party: KeyGenPartySecret
  ): PartyDecryptionContribution {
    const partialD = modPow(ciphertext.c1, party.secretKey, this.p);
    const k = randomScalar(this.q);
    const dleqU = modPow(this.g, k, this.p);
    const dleqV = modPow(ciphertext.c1, k, this.p);

    const challenge = hashScalar('WorkSphere::JointElGamalDecryptDLEQ', [
      committeeId,
      ciphertext.ciphertextId,
      party.partyId,
      party.publicKey,
      ciphertext.c1,
      partialD,
      dleqU,
      dleqV,
    ]);
    const response = modNorm(k + challenge * party.secretKey, this.q);

    return {
      ciphertextId: ciphertext.ciphertextId,
      partyId: party.partyId,
      partialD,
      dleqU,
      dleqV,
      challenge,
      response,
    };
  }

  public verifyDecryptionContribution(
    committeeId: string,
    ciphertext: CollaborativeCiphertext,
    contribution: PartyDecryptionContribution,
    expectedPartyPublicKey: bigint
  ): boolean {
    if (contribution.ciphertextId !== ciphertext.ciphertextId) return false;
    const expectedC = hashScalar('WorkSphere::JointElGamalDecryptDLEQ', [
      committeeId,
      ciphertext.ciphertextId,
      contribution.partyId,
      expectedPartyPublicKey,
      ciphertext.c1,
      contribution.partialD,
      contribution.dleqU,
      contribution.dleqV,
    ]);
    if (expectedC !== contribution.challenge) return false;

    const lhsU = modPow(this.g, modNorm(contribution.response, this.q), this.p);
    const rhsU = (contribution.dleqU * modPow(expectedPartyPublicKey, contribution.challenge, this.p)) % this.p;
    if (lhsU !== rhsU) return false;

    const lhsV = modPow(ciphertext.c1, modNorm(contribution.response, this.q), this.p);
    const rhsV = (contribution.dleqV * modPow(contribution.partialD, contribution.challenge, this.p)) % this.p;
    return lhsV === rhsV;
  }

  /**
   * Collaboratively decrypts a ciphertext using all accepted committee members' verified shares.
   */
  public combineCollaborativeDecryption(
    committee: AggregatedElGamalCommittee,
    ciphertext: CollaborativeCiphertext,
    contributions: readonly PartyDecryptionContribution[]
  ): {
    valid: boolean;
    recoveredElement?: bigint;
    faultyPartyIds: string[];
    missingPartyIds: string[];
  } {
    const contribMap = new Map<string, PartyDecryptionContribution>();
    const faultyPartyIds: string[] = [];

    for (const c of contributions) {
      const expectedPk = committee.partyPublicKeys.get(c.partyId);
      if (
        expectedPk === undefined ||
        contribMap.has(c.partyId) ||
        !this.verifyDecryptionContribution(committee.committeeId, ciphertext, c, expectedPk)
      ) {
        faultyPartyIds.push(c.partyId);
        continue;
      }
      contribMap.set(c.partyId, c);
    }

    const missingPartyIds = committee.acceptedPartyIds.filter((id) => !contribMap.has(id));
    if (faultyPartyIds.length > 0 || missingPartyIds.length > 0) {
      return { valid: false, faultyPartyIds, missingPartyIds };
    }

    let jointD = 1n;
    for (const id of committee.acceptedPartyIds) {
      jointD = (jointD * contribMap.get(id)!.partialD) % this.p;
    }
    const recoveredElement = (ciphertext.c2 * modInverse(jointD, this.p)) % this.p;
    return { valid: true, recoveredElement, faultyPartyIds: [], missingPartyIds: [] };
  }

  public serializeContribution(c: PartyDecryptionContribution): string {
    return JSON.stringify({
      ...c,
      partialD: c.partialD.toString(16),
      dleqU: c.dleqU.toString(16),
      dleqV: c.dleqV.toString(16),
      challenge: c.challenge.toString(16),
      response: c.response.toString(16),
    });
  }

  public deserializeContribution(payload: string): PartyDecryptionContribution {
    const raw = JSON.parse(payload) as Record<string, string>;
    return {
      ciphertextId: raw.ciphertextId,
      partyId: raw.partyId,
      partialD: BigInt(`0x${raw.partialD}`),
      dleqU: BigInt(`0x${raw.dleqU}`),
      dleqV: BigInt(`0x${raw.dleqV}`),
      challenge: BigInt(`0x${raw.challenge}`),
      response: BigInt(`0x${raw.response}`),
    };
  }
}
