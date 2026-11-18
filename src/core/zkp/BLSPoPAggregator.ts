import { createHash } from 'crypto';

/**
 * Zero-Knowledge Proof-of-Possession (PoP) Rogue-Key Resistant Aggregator
 *
 * Implements a safe-prime subgroup multi-signature aggregation protocol with
 * mandatory non-interactive Schnorr Proof-of-Possession (PoP) registration
 * (Ristenpart & Yilek 2007 / BLS PoP scheme). Prevents rogue-key cancellation
 * attacks by requiring every signer to prove knowledge of the discrete log of
 * their public verification point before participating in aggregate signatures.
 */

const SUBGROUP_ORDER = 0x7fffffffffffffffffffffffffffe1d3n; // Prime Q
const SAFE_PRIME = 0xffffffffffffffffffffffffffffc3a7n; // Safe prime P = 2Q + 1
const SUBGROUP_GEN = 4n; // Quadratic residue generator of order Q

export interface ProofOfPossession {
  readonly signerId: string;
  readonly publicPoint: bigint;
  readonly commitmentR: bigint;
  readonly challengeC: bigint;
  readonly responseS: bigint;
}

export interface RegisteredSigner {
  readonly signerId: string;
  readonly publicPoint: bigint;
  readonly weight: bigint;
  readonly popDigest: string;
}

export interface PartialSignature {
  readonly signerId: string;
  readonly messageDigest: string;
  readonly noncePointR: bigint;
  readonly responseS: bigint;
}

export interface AggregateSignatureBundle {
  readonly messageDigest: string;
  readonly signerIds: readonly string[];
  readonly aggregateNonceR: bigint;
  readonly aggregateResponseS: bigint;
  readonly aggregatePublicPoint: bigint;
  readonly totalWeight: bigint;
  readonly bundleDigest: string;
}

export interface AggregateVerificationResult {
  readonly isValid: boolean;
  readonly verifiedSigners: number;
  readonly totalWeight: bigint;
  readonly reason?: string;
}

function modQ(x: bigint): bigint {
  const r = x % SUBGROUP_ORDER;
  return r >= 0n ? r : r + SUBGROUP_ORDER;
}

function modP(x: bigint): bigint {
  const r = x % SAFE_PRIME;
  return r >= 0n ? r : r + SAFE_PRIME;
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

function hashToScalar(domain: string, parts: readonly string[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const part of parts) {
    h.update('|');
    h.update(part);
  }
  const s = modQ(BigInt('0x' + h.digest('hex')));
  return s === 0n ? 1n : s;
}

function hashHex(domain: string, parts: readonly string[]): string {
  const h = createHash('sha256');
  h.update(domain);
  for (const part of parts) {
    h.update('|');
    h.update(part);
  }
  return h.digest('hex');
}

export class BLSPoPAggregator {
  private readonly registry = new Map<string, RegisteredSigner>();

  public derivePublicPoint(witnessScalar: bigint): bigint {
    const s = modQ(witnessScalar);
    if (s === 0n) {
      throw new Error('Witness scalar must be non-zero mod Q');
    }
    return modPow(SUBGROUP_GEN, s, SAFE_PRIME);
  }

  public createProofOfPossession(
    signerId: string,
    witnessScalar: bigint,
    nonceLabel: string
  ): ProofOfPossession {
    const sk = modQ(witnessScalar);
    if (sk === 0n) {
      throw new Error('Witness scalar must be non-zero');
    }
    const publicPoint = modPow(SUBGROUP_GEN, sk, SAFE_PRIME);
    const k = hashToScalar('POP_NONCE', [signerId, publicPoint.toString(16), nonceLabel]);
    const commitmentR = modPow(SUBGROUP_GEN, k, SAFE_PRIME);
    const challengeC = hashToScalar('POP_CHALLENGE', [
      signerId,
      publicPoint.toString(16),
      commitmentR.toString(16),
    ]);
    const responseS = modQ(k + modQ(challengeC * sk));

    return {
      signerId,
      publicPoint,
      commitmentR,
      challengeC,
      responseS,
    };
  }

  public verifyProofOfPossession(pop: ProofOfPossession): boolean {
    if (pop.publicPoint <= 1n || pop.publicPoint >= SAFE_PRIME) {
      return false;
    }
    // Verify publicPoint lies in order-Q subgroup: Y^Q == 1 mod P
    if (modPow(pop.publicPoint, SUBGROUP_ORDER, SAFE_PRIME) !== 1n) {
      return false;
    }
    const expectedC = hashToScalar('POP_CHALLENGE', [
      pop.signerId,
      pop.publicPoint.toString(16),
      pop.commitmentR.toString(16),
    ]);
    if (expectedC !== pop.challengeC) {
      return false;
    }
    const lhs = modPow(SUBGROUP_GEN, modQ(pop.responseS), SAFE_PRIME);
    const rhs = modP(pop.commitmentR * modPow(pop.publicPoint, expectedC, SAFE_PRIME));
    return lhs === rhs;
  }

  public registerSigner(pop: ProofOfPossession, weight = 1n): RegisteredSigner {
    if (weight <= 0n) {
      throw new Error('Signer weight must be positive');
    }
    if (this.registry.has(pop.signerId)) {
      throw new Error(`Signer already registered: ${pop.signerId}`);
    }
    if (!this.verifyProofOfPossession(pop)) {
      throw new Error(`Invalid Proof-of-Possession for signer ${pop.signerId}`);
    }

    const popDigest = hashHex('POP_RECORD', [
      pop.signerId,
      pop.publicPoint.toString(16),
      pop.commitmentR.toString(16),
      pop.responseS.toString(16),
    ]);
    const record: RegisteredSigner = {
      signerId: pop.signerId,
      publicPoint: pop.publicPoint,
      weight,
      popDigest,
    };
    this.registry.set(pop.signerId, record);
    return record;
  }

  public getRegisteredSigner(signerId: string): RegisteredSigner | undefined {
    return this.registry.get(signerId);
  }

  public computeNonceCommitment(
    signerId: string,
    messageDigest: string,
    sessionTag: string
  ): { nonceScalar: bigint; noncePointR: bigint } {
    const nonceScalar = hashToScalar('AGG_SIG_NONCE', [signerId, messageDigest, sessionTag]);
    const noncePointR = modPow(SUBGROUP_GEN, nonceScalar, SAFE_PRIME);
    return { nonceScalar, noncePointR };
  }

  public createPartialSignature(
    signerId: string,
    witnessScalar: bigint,
    nonceScalar: bigint,
    messageDigest: string,
    aggregateNonceR: bigint,
    aggregatePublicPoint: bigint
  ): PartialSignature {
    const signer = this.registry.get(signerId);
    if (!signer) {
      throw new Error(`Unregistered signer: ${signerId}`);
    }
    const challenge = hashToScalar('AGG_SIG_CHALLENGE', [
      messageDigest,
      aggregateNonceR.toString(16),
      aggregatePublicPoint.toString(16),
    ]);
    const responseS = modQ(modQ(nonceScalar) + modQ(challenge * modQ(witnessScalar)));
    return {
      signerId,
      messageDigest,
      noncePointR: modPow(SUBGROUP_GEN, modQ(nonceScalar), SAFE_PRIME),
      responseS,
    };
  }

  public aggregateSignatures(
    messageDigest: string,
    partials: readonly PartialSignature[]
  ): AggregateSignatureBundle {
    if (partials.length === 0) {
      throw new Error('At least one partial signature is required');
    }

    const seen = new Set<string>();
    let aggregateNonceR = 1n;
    let aggregatePublicPoint = 1n;
    let aggregateResponseS = 0n;
    let totalWeight = 0n;
    const signerIds: string[] = [];

    for (const part of partials) {
      if (part.messageDigest !== messageDigest) {
        throw new Error(`Partial signature message digest mismatch for ${part.signerId}`);
      }
      if (seen.has(part.signerId)) {
        throw new Error(`Duplicate signer detected in aggregation: ${part.signerId}`);
      }
      const signer = this.registry.get(part.signerId);
      if (!signer) {
        throw new Error(`Signer not registered with valid PoP: ${part.signerId}`);
      }
      seen.add(part.signerId);
      signerIds.push(part.signerId);
      aggregateNonceR = modP(aggregateNonceR * part.noncePointR);
      aggregatePublicPoint = modP(aggregatePublicPoint * signer.publicPoint);
      aggregateResponseS = modQ(aggregateResponseS + part.responseS);
      totalWeight += signer.weight;
    }

    const sortedIds = [...signerIds].sort();
    const bundleDigest = hashHex('AGG_BUNDLE', [
      messageDigest,
      sortedIds.join(','),
      aggregateNonceR.toString(16),
      aggregateResponseS.toString(16),
      aggregatePublicPoint.toString(16),
      totalWeight.toString(),
    ]);

    return {
      messageDigest,
      signerIds: sortedIds,
      aggregateNonceR,
      aggregateResponseS,
      aggregatePublicPoint,
      totalWeight,
      bundleDigest,
    };
  }

  public verifyAggregate(
    bundle: AggregateSignatureBundle,
    minWeightRequired = 1n
  ): AggregateVerificationResult {
    if (bundle.signerIds.length === 0) {
      return {
        isValid: false,
        verifiedSigners: 0,
        totalWeight: 0n,
        reason: 'Empty signer list',
      };
    }

    const seen = new Set<string>();
    let expectedAggPub = 1n;
    let computedWeight = 0n;

    for (const id of bundle.signerIds) {
      if (seen.has(id)) {
        return {
          isValid: false,
          verifiedSigners: 0,
          totalWeight: 0n,
          reason: `Duplicate signer ID in bundle: ${id}`,
        };
      }
      const signer = this.registry.get(id);
      if (!signer) {
        return {
          isValid: false,
          verifiedSigners: 0,
          totalWeight: 0n,
          reason: `Unregistered signer in bundle: ${id}`,
        };
      }
      seen.add(id);
      expectedAggPub = modP(expectedAggPub * signer.publicPoint);
      computedWeight += signer.weight;
    }

    if (expectedAggPub !== bundle.aggregatePublicPoint || computedWeight !== bundle.totalWeight) {
      return {
        isValid: false,
        verifiedSigners: 0,
        totalWeight: computedWeight,
        reason: 'Aggregate public point or weight mismatch',
      };
    }

    if (computedWeight < minWeightRequired) {
      return {
        isValid: false,
        verifiedSigners: seen.size,
        totalWeight: computedWeight,
        reason: `Weight ${computedWeight} below required minimum ${minWeightRequired}`,
      };
    }

    const sortedIds = [...bundle.signerIds].sort();
    const expectedDigest = hashHex('AGG_BUNDLE', [
      bundle.messageDigest,
      sortedIds.join(','),
      bundle.aggregateNonceR.toString(16),
      bundle.aggregateResponseS.toString(16),
      bundle.aggregatePublicPoint.toString(16),
      computedWeight.toString(),
    ]);
    if (expectedDigest !== bundle.bundleDigest) {
      return {
        isValid: false,
        verifiedSigners: seen.size,
        totalWeight: computedWeight,
        reason: 'Aggregate bundle digest mismatch',
      };
    }

    const challenge = hashToScalar('AGG_SIG_CHALLENGE', [
      bundle.messageDigest,
      bundle.aggregateNonceR.toString(16),
      bundle.aggregatePublicPoint.toString(16),
    ]);

    const lhs = modPow(SUBGROUP_GEN, modQ(bundle.aggregateResponseS), SAFE_PRIME);
    const rhs = modP(
      bundle.aggregateNonceR * modPow(bundle.aggregatePublicPoint, challenge, SAFE_PRIME)
    );

    if (lhs !== rhs) {
      return {
        isValid: false,
        verifiedSigners: seen.size,
        totalWeight: computedWeight,
        reason: 'Aggregate signature algebraic verification failed',
      };
    }

    return {
      isValid: true,
      verifiedSigners: seen.size,
      totalWeight: computedWeight,
    };
  }
}
