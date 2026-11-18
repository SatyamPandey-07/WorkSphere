import { createHash } from 'crypto';

/**
 * Zero-Knowledge Verifiable Pedersen Vector Commitment Batch Opener
 *
 * Implements Pedersen vector commitments C_j = h^{r_j} * prod_i g_i^{v_{j,i}} mod P
 * over a safe-prime subgroup (P = 2Q + 1) together with a succinct batched
 * zero-knowledge opening protocol: folds m commitments with Fiat-Shamir weights
 * alpha^j and proves knowledge of the combined blinding scalar R_batch = sum alpha^j r_j
 * via a non-interactive Schnorr Sigma proof without disclosing individual blindings.
 */

const SUBGROUP_ORDER = 0x7fffffffffffffffffffffffffffe1d3n; // Prime Q
const SAFE_PRIME = 0xffffffffffffffffffffffffffffc3a7n; // Safe prime P = 2Q + 1
const SUBGROUP_GEN = 4n; // Order-Q quadratic residue generator

export interface PedersenVectorCommitment {
  readonly commitmentId: string;
  readonly dimension: number;
  readonly commitmentPoint: bigint;
  readonly commitmentDigest: string;
}

export interface PedersenVectorOpeningWitness {
  readonly values: readonly bigint[];
  readonly blindingFactor: bigint;
}

export interface PedersenBatchOpeningProof {
  readonly batchSize: number;
  readonly vectorDimension: number;
  readonly combinationAlpha: bigint;
  readonly combinedCommitment: bigint;
  readonly combinedMessagePoint: bigint;
  readonly blindingTargetY: bigint;
  readonly schnorrNonceA: bigint;
  readonly schnorrChallengeE: bigint;
  readonly schnorrResponseS: bigint;
  readonly transcriptDigest: string;
}

export interface PedersenBatchVerificationResult {
  readonly isValid: boolean;
  readonly verifiedCommitments: number;
  readonly recomputedCombinedPoint: bigint;
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

function modInverseP(a: bigint): bigint {
  return modPow(a, SAFE_PRIME - 2n, SAFE_PRIME);
}

function hashToScalar(domain: string, parts: readonly string[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const p of parts) {
    h.update('|');
    h.update(p);
  }
  const s = modQ(BigInt('0x' + h.digest('hex')));
  return s === 0n ? 1n : s;
}

function hashHex(domain: string, parts: readonly string[]): string {
  const h = createHash('sha256');
  h.update(domain);
  for (const p of parts) {
    h.update('|');
    h.update(p);
  }
  return h.digest('hex');
}

export class PedersenBatchOpener {
  private readonly dimension: number;
  private readonly valueGenerators: readonly bigint[];
  private readonly blindingGenerator: bigint;

  constructor(dimension: number, domainSeed = 'WORKSPHERE_PEDERSEN_BATCH_V1') {
    if (!Number.isInteger(dimension) || dimension < 1 || dimension > 256) {
      throw new Error('dimension must be an integer between 1 and 256');
    }
    this.dimension = dimension;
    const gens: bigint[] = [];
    for (let i = 0; i < dimension; i++) {
      const exp = hashToScalar('PEDERSEN_VEC_GEN', [domainSeed, String(i)]);
      gens.push(modPow(SUBGROUP_GEN, exp, SAFE_PRIME));
    }
    this.valueGenerators = gens;
    const hExp = hashToScalar('PEDERSEN_VEC_BLIND', [domainSeed, 'H']);
    this.blindingGenerator = modPow(SUBGROUP_GEN, hExp, SAFE_PRIME);
  }

  public getDimension(): number {
    return this.dimension;
  }

  public commitVector(
    commitmentId: string,
    values: readonly bigint[],
    blindingFactor: bigint
  ): { commitment: PedersenVectorCommitment; witness: PedersenVectorOpeningWitness } {
    if (values.length !== this.dimension) {
      throw new Error(`Expected vector of length ${this.dimension}, got ${values.length}`);
    }
    const normalized = values.map((v) => modQ(v));
    const blind = modQ(blindingFactor);

    let point = modPow(this.blindingGenerator, blind, SAFE_PRIME);
    for (let i = 0; i < this.dimension; i++) {
      if (normalized[i] !== 0n) {
        point = modP(point * modPow(this.valueGenerators[i], normalized[i], SAFE_PRIME));
      }
    }

    const commitmentDigest = hashHex('PEDERSEN_VEC_COMMIT', [
      commitmentId,
      String(this.dimension),
      point.toString(16),
    ]);

    return {
      commitment: {
        commitmentId,
        dimension: this.dimension,
        commitmentPoint: point,
        commitmentDigest,
      },
      witness: {
        values: normalized,
        blindingFactor: blind,
      },
    };
  }

  public createBatchOpeningProof(
    entries: ReadonlyArray<{
      readonly commitment: PedersenVectorCommitment;
      readonly witness: PedersenVectorOpeningWitness;
    }>,
    proofNonce: string
  ): PedersenBatchOpeningProof {
    if (entries.length === 0) {
      throw new Error('Batch opening requires at least one commitment entry');
    }

    const alphaParts: string[] = [String(entries.length), String(this.dimension)];
    for (const entry of entries) {
      if (entry.commitment.dimension !== this.dimension || entry.witness.values.length !== this.dimension) {
        throw new Error('Vector dimension mismatch in batch opening');
      }
      alphaParts.push(entry.commitment.commitmentId);
      alphaParts.push(entry.commitment.commitmentPoint.toString(16));
      for (const v of entry.witness.values) {
        alphaParts.push(modQ(v).toString(16));
      }
    }

    const combinationAlpha = hashToScalar('PEDERSEN_BATCH_ALPHA', alphaParts);

    let combinedCommitment = 1n;
    const combinedValues = new Array<bigint>(this.dimension).fill(0n);
    let combinedBlinding = 0n;
    let alphaPow = 1n;

    for (const entry of entries) {
      combinedCommitment = modP(
        combinedCommitment * modPow(entry.commitment.commitmentPoint, alphaPow, SAFE_PRIME)
      );
      for (let i = 0; i < this.dimension; i++) {
        combinedValues[i] = modQ(
          combinedValues[i] + modQ(alphaPow * modQ(entry.witness.values[i]))
        );
      }
      combinedBlinding = modQ(
        combinedBlinding + modQ(alphaPow * modQ(entry.witness.blindingFactor))
      );
      alphaPow = modQ(alphaPow * combinationAlpha);
    }

    let combinedMessagePoint = 1n;
    for (let i = 0; i < this.dimension; i++) {
      if (combinedValues[i] !== 0n) {
        combinedMessagePoint = modP(
          combinedMessagePoint * modPow(this.valueGenerators[i], combinedValues[i], SAFE_PRIME)
        );
      }
    }

    const blindingTargetY = modP(combinedCommitment * modInverseP(combinedMessagePoint));

    // Schnorr Sigma proof of knowledge of combinedBlinding such that h^{combinedBlinding} == Y
    const w = hashToScalar('PEDERSEN_BATCH_SCHNORR_W', [
      proofNonce,
      combinedCommitment.toString(16),
      blindingTargetY.toString(16),
    ]);
    const schnorrNonceA = modPow(this.blindingGenerator, w, SAFE_PRIME);
    const schnorrChallengeE = hashToScalar('PEDERSEN_BATCH_SCHNORR_E', [
      combinationAlpha.toString(16),
      combinedCommitment.toString(16),
      blindingTargetY.toString(16),
      schnorrNonceA.toString(16),
    ]);
    const schnorrResponseS = modQ(w + modQ(schnorrChallengeE * combinedBlinding));

    const transcriptDigest = hashHex('PEDERSEN_BATCH_TRANSCRIPT', [
      String(entries.length),
      String(this.dimension),
      combinationAlpha.toString(16),
      combinedCommitment.toString(16),
      combinedMessagePoint.toString(16),
      blindingTargetY.toString(16),
      schnorrNonceA.toString(16),
      schnorrChallengeE.toString(16),
      schnorrResponseS.toString(16),
    ]);

    return {
      batchSize: entries.length,
      vectorDimension: this.dimension,
      combinationAlpha,
      combinedCommitment,
      combinedMessagePoint,
      blindingTargetY,
      schnorrNonceA,
      schnorrChallengeE,
      schnorrResponseS,
      transcriptDigest,
    };
  }

  public verifyBatchOpening(
    commitments: readonly PedersenVectorCommitment[],
    claimedVectors: ReadonlyArray<readonly bigint[]>,
    proof: PedersenBatchOpeningProof
  ): PedersenBatchVerificationResult {
    if (
      commitments.length === 0 ||
      commitments.length !== claimedVectors.length ||
      commitments.length !== proof.batchSize ||
      proof.vectorDimension !== this.dimension
    ) {
      return {
        isValid: false,
        verifiedCommitments: 0,
        recomputedCombinedPoint: 0n,
        reason: 'Batch size or vector dimension mismatch',
      };
    }

    const alphaParts: string[] = [String(commitments.length), String(this.dimension)];
    for (let j = 0; j < commitments.length; j++) {
      const c = commitments[j];
      const vec = claimedVectors[j];
      if (c.dimension !== this.dimension || vec.length !== this.dimension) {
        return {
          isValid: false,
          verifiedCommitments: j,
          recomputedCombinedPoint: 0n,
          reason: `Dimension mismatch at batch index ${j}`,
        };
      }
      const expectedDigest = hashHex('PEDERSEN_VEC_COMMIT', [
        c.commitmentId,
        String(this.dimension),
        c.commitmentPoint.toString(16),
      ]);
      if (expectedDigest !== c.commitmentDigest) {
        return {
          isValid: false,
          verifiedCommitments: j,
          recomputedCombinedPoint: 0n,
          reason: `Commitment digest verification failed at index ${j}`,
        };
      }
      alphaParts.push(c.commitmentId);
      alphaParts.push(c.commitmentPoint.toString(16));
      for (const v of vec) {
        alphaParts.push(modQ(v).toString(16));
      }
    }

    const expectedAlpha = hashToScalar('PEDERSEN_BATCH_ALPHA', alphaParts);
    if (expectedAlpha !== proof.combinationAlpha) {
      return {
        isValid: false,
        verifiedCommitments: 0,
        recomputedCombinedPoint: 0n,
        reason: 'Fiat-Shamir batch folding weight alpha mismatch',
      };
    }

    let recomputedCombined = 1n;
    const combinedValues = new Array<bigint>(this.dimension).fill(0n);
    let alphaPow = 1n;

    for (let j = 0; j < commitments.length; j++) {
      recomputedCombined = modP(
        recomputedCombined * modPow(commitments[j].commitmentPoint, alphaPow, SAFE_PRIME)
      );
      for (let i = 0; i < this.dimension; i++) {
        combinedValues[i] = modQ(
          combinedValues[i] + modQ(alphaPow * modQ(claimedVectors[j][i]))
        );
      }
      alphaPow = modQ(alphaPow * expectedAlpha);
    }

    if (recomputedCombined !== proof.combinedCommitment) {
      return {
        isValid: false,
        verifiedCommitments: 0,
        recomputedCombinedPoint: recomputedCombined,
        reason: 'Homomorphic combined commitment mismatch',
      };
    }

    let expectedMsgPoint = 1n;
    for (let i = 0; i < this.dimension; i++) {
      if (combinedValues[i] !== 0n) {
        expectedMsgPoint = modP(
          expectedMsgPoint * modPow(this.valueGenerators[i], combinedValues[i], SAFE_PRIME)
        );
      }
    }
    if (expectedMsgPoint !== proof.combinedMessagePoint) {
      return {
        isValid: false,
        verifiedCommitments: 0,
        recomputedCombinedPoint: recomputedCombined,
        reason: 'Combined message generator product mismatch',
      };
    }

    const expectedY = modP(recomputedCombined * modInverseP(expectedMsgPoint));
    if (expectedY !== proof.blindingTargetY) {
      return {
        isValid: false,
        verifiedCommitments: 0,
        recomputedCombinedPoint: recomputedCombined,
        reason: 'Residual blinding target Y mismatch',
      };
    }

    const expectedE = hashToScalar('PEDERSEN_BATCH_SCHNORR_E', [
      expectedAlpha.toString(16),
      recomputedCombined.toString(16),
      expectedY.toString(16),
      proof.schnorrNonceA.toString(16),
    ]);
    if (expectedE !== proof.schnorrChallengeE) {
      return {
        isValid: false,
        verifiedCommitments: 0,
        recomputedCombinedPoint: recomputedCombined,
        reason: 'Schnorr Fiat-Shamir challenge mismatch',
      };
    }

    const lhs = modPow(this.blindingGenerator, modQ(proof.schnorrResponseS), SAFE_PRIME);
    const rhs = modP(proof.schnorrNonceA * modPow(expectedY, expectedE, SAFE_PRIME));
    if (lhs !== rhs) {
      return {
        isValid: false,
        verifiedCommitments: 0,
        recomputedCombinedPoint: recomputedCombined,
        reason: 'Zero-knowledge Schnorr blinding verification equation failed',
      };
    }

    const expectedTranscript = hashHex('PEDERSEN_BATCH_TRANSCRIPT', [
      String(commitments.length),
      String(this.dimension),
      expectedAlpha.toString(16),
      recomputedCombined.toString(16),
      expectedMsgPoint.toString(16),
      expectedY.toString(16),
      proof.schnorrNonceA.toString(16),
      expectedE.toString(16),
      proof.schnorrResponseS.toString(16),
    ]);
    if (expectedTranscript !== proof.transcriptDigest) {
      return {
        isValid: false,
        verifiedCommitments: 0,
        recomputedCombinedPoint: recomputedCombined,
        reason: 'Batch opening transcript digest mismatch',
      };
    }

    return {
      isValid: true,
      verifiedCommitments: commitments.length,
      recomputedCombinedPoint: recomputedCombined,
    };
  }
}
