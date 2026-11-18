import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Threshold Schnorr Adaptor Signature Engine.
 *
 * Implements (t, n) Feldman-VSS threshold Schnorr adaptor signatures over a safe-prime
 * quadratic-residue subgroup:
 *  1. Trusted/DKG key split of secret x into t-of-n shares with verifiable commitments A_k = g^{a_k}.
 *  2. Adaptor statement T = g^y (public witness point) with Schnorr knowledge proof of y.
 *  3. Threshold pre-signature generation: quorum combines partial nonces R_i and partial
 *     pre-signatures s'_i with challenge c = H(R_agg * T, X, m) to obtain a verifiable
 *     pre-signature (R_agg, s') satisfying g^{s'} = R_agg * X^c.
 *  4. Adaptor completion: anyone holding adaptor secret y computes final valid Schnorr
 *     signature (R_final = R_agg * T, s_final = s' + y mod Q).
 *  5. Witness extraction: given (preSignature, finalSignature), any observer extracts
 *     y = (s_final - s') mod Q and verifies g^y == T (enabling atomic swaps & scriptless scripts).
 */

export const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
export const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
export const BASE_G = 4n;

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

function modScalar(v: bigint): bigint {
  return ((v % SUBGROUP_Q) + SUBGROUP_Q) % SUBGROUP_Q;
}

function modInv(a: bigint, m: bigint): bigint {
  let t = 0n;
  let newT = 1n;
  let r = m;
  let newR = ((a % m) + m) % m;
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  if (r > 1n) throw new Error('Scalar not invertible');
  return t < 0n ? t + m : t;
}

function randomScalar(): bigint {
  const bytes = randomBytes(16);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return (v % (SUBGROUP_Q - 2n)) + 1n;
}

function hashToScalar(...parts: string[]): bigint {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return modScalar(BigInt('0x' + h.digest('hex').slice(0, 32)));
}

export interface ThresholdSignerShare {
  id: number;
  secretShare: bigint;
  publicShare: bigint;
}

export interface ThresholdKeySetup {
  threshold: number;
  participants: number[];
  groupPublicKey: bigint;
  feldmanCommitments: bigint[];
  shares: ThresholdSignerShare[];
}

export interface AdaptorWitnessPair {
  adaptorSecret: bigint;
  adaptorPoint: bigint;
  dlogProofR: bigint;
  dlogProofS: bigint;
}

export interface PartialAdaptorPreSig {
  signerId: number;
  noncePoint: bigint;
  partialS: bigint;
}

export interface ThresholdAdaptorPreSignature {
  message: string;
  groupPublicKey: bigint;
  adaptorPoint: bigint;
  aggregateNonce: bigint;
  challenge: bigint;
  preS: bigint;
  participatingIds: number[];
}

export interface CompletedSchnorrSignature {
  message: string;
  groupPublicKey: bigint;
  finalR: bigint;
  finalS: bigint;
}

export class VerifiableThresholdSchnorrAdaptor {
  public setupThresholdKey(threshold: number, participantIds: number[]): ThresholdKeySetup {
    if (threshold < 1 || threshold > participantIds.length) {
      throw new RangeError('Threshold must be between 1 and participant count');
    }
    const unique = new Set(participantIds);
    if (unique.size !== participantIds.length || participantIds.some((id) => id <= 0)) {
      throw new Error('Participant IDs must be unique positive integers');
    }

    const coeffs: bigint[] = [];
    for (let i = 0; i < threshold; i++) {
      coeffs.push(randomScalar());
    }
    const feldmanCommitments = coeffs.map((c) => modPow(BASE_G, c, SAFE_PRIME_P));
    const groupPublicKey = feldmanCommitments[0];

    const shares: ThresholdSignerShare[] = participantIds.map((id) => {
      const x = BigInt(id);
      let y = 0n;
      let xPow = 1n;
      for (const c of coeffs) {
        y = modScalar(y + c * xPow);
        xPow = modScalar(xPow * x);
      }
      return {
        id,
        secretShare: y,
        publicShare: modPow(BASE_G, y, SAFE_PRIME_P),
      };
    });

    return {
      threshold,
      participants: [...participantIds],
      groupPublicKey,
      feldmanCommitments,
      shares,
    };
  }

  public verifyShare(share: ThresholdSignerShare, feldmanCommitments: bigint[]): boolean {
    const x = BigInt(share.id);
    let expected = 1n;
    let xPow = 1n;
    for (const comm of feldmanCommitments) {
      expected = (expected * modPow(comm, xPow, SAFE_PRIME_P)) % SAFE_PRIME_P;
      xPow = modScalar(xPow * x);
    }
    return modPow(BASE_G, share.secretShare, SAFE_PRIME_P) === expected && share.publicShare === expected;
  }

  public createAdaptorWitness(secret?: bigint): AdaptorWitnessPair {
    const adaptorSecret = secret !== undefined ? modScalar(secret) : randomScalar();
    if (adaptorSecret === 0n) throw new Error('Adaptor secret must be non-zero');
    const adaptorPoint = modPow(BASE_G, adaptorSecret, SAFE_PRIME_P);
    const k = randomScalar();
    const dlogProofR = modPow(BASE_G, k, SAFE_PRIME_P);
    const c = hashToScalar('ADAPTOR-DLOG-V1', adaptorPoint.toString(16), dlogProofR.toString(16));
    const dlogProofS = modScalar(k + c * adaptorSecret);
    return { adaptorSecret, adaptorPoint, dlogProofR, dlogProofS };
  }

  public verifyAdaptorWitness(adaptorPoint: bigint, dlogProofR: bigint, dlogProofS: bigint): boolean {
    const c = hashToScalar('ADAPTOR-DLOG-V1', adaptorPoint.toString(16), dlogProofR.toString(16));
    const lhs = modPow(BASE_G, dlogProofS, SAFE_PRIME_P);
    const rhs = (dlogProofR * modPow(adaptorPoint, c, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return lhs === rhs;
  }

  public lagrangeCoefficient(signerId: number, activeIds: number[]): bigint {
    const xi = BigInt(signerId);
    let num = 1n;
    let den = 1n;
    for (const other of activeIds) {
      if (other === signerId) continue;
      const xj = BigInt(other);
      num = modScalar(num * modScalar(SUBGROUP_Q - xj));
      den = modScalar(den * modScalar(xi - xj));
    }
    return modScalar(num * modInv(den, SUBGROUP_Q));
  }

  public computeSchnorrChallenge(effectiveR: bigint, groupPublicKey: bigint, message: string): bigint {
    return hashToScalar('THRESHOLD-ADAPTOR-SCHNORR-V1', effectiveR.toString(16), groupPublicKey.toString(16), message);
  }

  public produceThresholdPreSignature(
    setup: ThresholdKeySetup,
    quorumShares: ThresholdSignerShare[],
    adaptorPoint: bigint,
    message: string,
    faultyIds: number[] = [],
  ): {
    preSignature: ThresholdAdaptorPreSignature | null;
    faultySigners: number[];
  } {
    if (quorumShares.length < setup.threshold) {
      throw new Error('Insufficient signers for threshold quorum');
    }
    const activeIds = quorumShares.map((s) => s.id);
    const nonces = new Map<number, { k: bigint; R: bigint }>();
    let aggregateNonce = 1n;

    for (const share of quorumShares) {
      const k = randomScalar();
      const R = modPow(BASE_G, k, SAFE_PRIME_P);
      nonces.set(share.id, { k, R });
      aggregateNonce = (aggregateNonce * R) % SAFE_PRIME_P;
    }

    const effectiveR = (aggregateNonce * adaptorPoint) % SAFE_PRIME_P;
    const challenge = this.computeSchnorrChallenge(effectiveR, setup.groupPublicKey, message);

    const partials: PartialAdaptorPreSig[] = quorumShares.map((share) => {
      const lambda = this.lagrangeCoefficient(share.id, activeIds);
      const { k, R } = nonces.get(share.id)!;
      let partialS = modScalar(k + challenge * modScalar(lambda * share.secretShare));
      if (faultyIds.includes(share.id)) {
        partialS = modScalar(partialS + 777n);
      }
      return { signerId: share.id, noncePoint: R, partialS };
    });

    const detectedFaulty: number[] = [];
    for (const p of partials) {
      const share = quorumShares.find((s) => s.id === p.signerId)!;
      const lambda = this.lagrangeCoefficient(p.signerId, activeIds);
      const lhs = modPow(BASE_G, p.partialS, SAFE_PRIME_P);
      const rhs = (p.noncePoint * modPow(share.publicShare, modScalar(challenge * lambda), SAFE_PRIME_P)) % SAFE_PRIME_P;
      if (lhs !== rhs) {
        detectedFaulty.push(p.signerId);
      }
    }

    if (detectedFaulty.length > 0) {
      return { preSignature: null, faultySigners: detectedFaulty };
    }

    let preS = 0n;
    for (const p of partials) {
      preS = modScalar(preS + p.partialS);
    }

    return {
      preSignature: {
        message,
        groupPublicKey: setup.groupPublicKey,
        adaptorPoint,
        aggregateNonce,
        challenge,
        preS,
        participatingIds: activeIds,
      },
      faultySigners: [],
    };
  }

  public verifyPreSignature(preSig: ThresholdAdaptorPreSignature): boolean {
    const effectiveR = (preSig.aggregateNonce * preSig.adaptorPoint) % SAFE_PRIME_P;
    const expectedC = this.computeSchnorrChallenge(effectiveR, preSig.groupPublicKey, preSig.message);
    if (expectedC !== preSig.challenge) return false;
    const lhs = modPow(BASE_G, preSig.preS, SAFE_PRIME_P);
    const rhs = (preSig.aggregateNonce * modPow(preSig.groupPublicKey, preSig.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return lhs === rhs;
  }

  public completeSignature(preSig: ThresholdAdaptorPreSignature, adaptorSecret: bigint): CompletedSchnorrSignature {
    if (!this.verifyPreSignature(preSig)) {
      throw new Error('Cannot complete invalid adaptor pre-signature');
    }
    if (modPow(BASE_G, adaptorSecret, SAFE_PRIME_P) !== preSig.adaptorPoint) {
      throw new Error('Adaptor secret does not match adaptor point');
    }
    return {
      message: preSig.message,
      groupPublicKey: preSig.groupPublicKey,
      finalR: (preSig.aggregateNonce * preSig.adaptorPoint) % SAFE_PRIME_P,
      finalS: modScalar(preSig.preS + adaptorSecret),
    };
  }

  public verifyCompletedSignature(sig: CompletedSchnorrSignature): boolean {
    const c = this.computeSchnorrChallenge(sig.finalR, sig.groupPublicKey, sig.message);
    const lhs = modPow(BASE_G, sig.finalS, SAFE_PRIME_P);
    const rhs = (sig.finalR * modPow(sig.groupPublicKey, c, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return lhs === rhs;
  }

  public extractAdaptorSecret(preSig: ThresholdAdaptorPreSignature, completed: CompletedSchnorrSignature): bigint | null {
    if (!this.verifyPreSignature(preSig) || !this.verifyCompletedSignature(completed)) {
      return null;
    }
    const extracted = modScalar(completed.finalS - preSig.preS);
    if (modPow(BASE_G, extracted, SAFE_PRIME_P) !== preSig.adaptorPoint) {
      return null;
    }
    return extracted;
  }

  public serializePreSignature(preSig: ThresholdAdaptorPreSignature): string {
    return JSON.stringify({
      message: preSig.message,
      groupPublicKey: preSig.groupPublicKey.toString(16),
      adaptorPoint: preSig.adaptorPoint.toString(16),
      aggregateNonce: preSig.aggregateNonce.toString(16),
      challenge: preSig.challenge.toString(16),
      preS: preSig.preS.toString(16),
      participatingIds: preSig.participatingIds,
    });
  }
}
