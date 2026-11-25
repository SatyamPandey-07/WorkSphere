import { createHash } from 'crypto';

/**
 * Halo2-Style Inner-Product Polynomial Commitment Accumulator
 *
 * Implements a transparent (no trusted setup) polynomial commitment accumulator
 * inspired by Halo / Halo2 (Bowe, Grigg, Hopwood 2019). Multiple polynomial
 * opening instances {(C_i, z_i, y_i)} are deterministically folded via Fiat-Shamir
 * random linear combination into a single succinct accumulated instance that can
 * be verified in one final inner-product check.
 */

const FIELD_MODULUS = 0x7fffffffffffffffffffffffffffe1d3n; // Safe-prime subgroup order Q
const GROUP_PRIME = 0xffffffffffffffffffffffffffffc3a7n; // Safe prime P = 2Q + 1
const GENERATOR_BASE = 4n; // Quadratic residue generator of order Q

export interface PolynomialOpeningInstance {
  readonly commitment: bigint;
  readonly evalPoint: bigint;
  readonly evalValue: bigint;
  readonly degreeBound: number;
  readonly instanceHash: string;
}

export interface PolynomialOpeningWitness {
  readonly coefficients: readonly bigint[];
  readonly blindingFactor: bigint;
}

export interface Halo2AccumulationStep {
  readonly stepIndex: number;
  readonly foldingChallenge: bigint;
  readonly inputCommitment: bigint;
  readonly inputEvalPoint: bigint;
  readonly inputEvalValue: bigint;
  readonly updatedCommitment: bigint;
  readonly stepTranscriptHash: string;
}

export interface Halo2AccumulatorState {
  readonly accumulatedCommitment: bigint;
  readonly foldedEvalPoint: bigint;
  readonly foldedEvalValue: bigint;
  readonly foldedCoefficients: readonly bigint[];
  readonly foldedBlinding: bigint;
  readonly degreeBound: number;
  readonly steps: readonly Halo2AccumulationStep[];
  readonly transcriptDigest: string;
}

export interface Halo2VerificationResult {
  readonly isValid: boolean;
  readonly verifiedSteps: number;
  readonly evaluatedAtFoldedPoint: bigint;
  readonly recomputedCommitment: bigint;
  readonly reason?: string;
}

function modField(x: bigint): bigint {
  const r = x % FIELD_MODULUS;
  return r >= 0n ? r : r + FIELD_MODULUS;
}

function modGroup(x: bigint): bigint {
  const r = x % GROUP_PRIME;
  return r >= 0n ? r : r + GROUP_PRIME;
}

function modPow(base: bigint, exp: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = ((base % modulus) + modulus) % modulus;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) {
      result = (result * b) % modulus;
    }
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

function hashToField(domain: string, parts: readonly string[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const part of parts) {
    h.update('|');
    h.update(part);
  }
  const digest = BigInt('0x' + h.digest('hex'));
  const scalar = modField(digest);
  return scalar === 0n ? 1n : scalar;
}

function digestHex(domain: string, parts: readonly string[]): string {
  const h = createHash('sha256');
  h.update(domain);
  for (const part of parts) {
    h.update('|');
    h.update(part);
  }
  return h.digest('hex');
}

export class Halo2AccumulatorProver {
  private readonly maxDegree: number;
  private readonly generators: readonly bigint[];
  private readonly blindingGenerator: bigint;

  constructor(maxDegree = 32) {
    if (!Number.isInteger(maxDegree) || maxDegree < 1 || maxDegree > 1024) {
      throw new Error('maxDegree must be an integer between 1 and 1024');
    }
    this.maxDegree = maxDegree;
    const gens: bigint[] = [];
    for (let i = 0; i <= maxDegree; i++) {
      const exp = hashToField('HALO2_IPA_GEN', [String(i)]);
      gens.push(modPow(GENERATOR_BASE, exp, GROUP_PRIME));
    }
    this.generators = gens;
    const blindExp = hashToField('HALO2_IPA_BLIND_GEN', ['H']);
    this.blindingGenerator = modPow(GENERATOR_BASE, blindExp, GROUP_PRIME);
  }

  public getMaxDegree(): number {
    return this.maxDegree;
  }

  public evaluatePolynomial(coeffs: readonly bigint[], point: bigint): bigint {
    let acc = 0n;
    const z = modField(point);
    for (let i = coeffs.length - 1; i >= 0; i--) {
      acc = modField(acc * z + modField(coeffs[i]));
    }
    return acc;
  }

  public commitPolynomial(coeffs: readonly bigint[], blindingFactor: bigint): bigint {
    if (coeffs.length === 0 || coeffs.length - 1 > this.maxDegree) {
      throw new Error(`Polynomial degree exceeds configured maxDegree ${this.maxDegree}`);
    }
    let commitment = modPow(this.blindingGenerator, modField(blindingFactor), GROUP_PRIME);
    for (let i = 0; i < coeffs.length; i++) {
      const coeff = modField(coeffs[i]);
      if (coeff !== 0n) {
        const term = modPow(this.generators[i], coeff, GROUP_PRIME);
        commitment = modGroup(commitment * term);
      }
    }
    return commitment;
  }

  public createOpeningInstance(
    coefficients: readonly bigint[],
    evalPoint: bigint,
    blindingFactor: bigint
  ): { instance: PolynomialOpeningInstance; witness: PolynomialOpeningWitness } {
    const normalized = coefficients.map((c) => modField(c));
    const z = modField(evalPoint);
    const blind = modField(blindingFactor);
    const commitment = this.commitPolynomial(normalized, blind);
    const evalValue = this.evaluatePolynomial(normalized, z);
    const instanceHash = digestHex('HALO2_INSTANCE', [
      commitment.toString(16),
      z.toString(16),
      evalValue.toString(16),
      String(normalized.length - 1),
    ]);

    return {
      instance: {
        commitment,
        evalPoint: z,
        evalValue,
        degreeBound: normalized.length - 1,
        instanceHash,
      },
      witness: {
        coefficients: normalized,
        blindingFactor: blind,
      },
    };
  }

  public accumulate(
    entries: ReadonlyArray<{
      readonly instance: PolynomialOpeningInstance;
      readonly witness: PolynomialOpeningWitness;
    }>
  ): Halo2AccumulatorState {
    if (entries.length === 0) {
      throw new Error('At least one opening instance is required for accumulation');
    }

    let maxLen = 0;
    for (const entry of entries) {
      if (entry.witness.coefficients.length - 1 > this.maxDegree) {
        throw new Error('Witness polynomial exceeds accumulator maxDegree');
      }
      if (entry.witness.coefficients.length > maxLen) {
        maxLen = entry.witness.coefficients.length;
      }
    }

    let transcript = digestHex('HALO2_ACC_INIT', [String(entries.length), String(this.maxDegree)]);
    const foldedCoeffs: bigint[] = new Array<bigint>(maxLen).fill(0n);
    let foldedBlinding = 0n;
    let accumulatedCommitment = 1n;
    const steps: Halo2AccumulationStep[] = [];

    for (let i = 0; i < entries.length; i++) {
      const { instance, witness } = entries[i];
      const challenge = hashToField('HALO2_FOLD_CHALLENGE', [
        transcript,
        instance.commitment.toString(16),
        instance.evalPoint.toString(16),
        instance.evalValue.toString(16),
        String(i),
      ]);

      for (let d = 0; d < witness.coefficients.length; d++) {
        foldedCoeffs[d] = modField(
          foldedCoeffs[d] + modField(challenge * modField(witness.coefficients[d]))
        );
      }
      foldedBlinding = modField(
        foldedBlinding + modField(challenge * modField(witness.blindingFactor))
      );

      const scaledCommit = modPow(instance.commitment, challenge, GROUP_PRIME);
      accumulatedCommitment = modGroup(accumulatedCommitment * scaledCommit);

      transcript = digestHex('HALO2_ACC_STEP', [
        transcript,
        challenge.toString(16),
        accumulatedCommitment.toString(16),
      ]);

      steps.push({
        stepIndex: i,
        foldingChallenge: challenge,
        inputCommitment: instance.commitment,
        inputEvalPoint: instance.evalPoint,
        inputEvalValue: instance.evalValue,
        updatedCommitment: accumulatedCommitment,
        stepTranscriptHash: transcript,
      });
    }

    const foldedEvalPoint = hashToField('HALO2_FINAL_POINT', [
      transcript,
      accumulatedCommitment.toString(16),
    ]);
    const foldedEvalValue = this.evaluatePolynomial(foldedCoeffs, foldedEvalPoint);

    const finalDigest = digestHex('HALO2_ACC_FINAL', [
      transcript,
      foldedEvalPoint.toString(16),
      foldedEvalValue.toString(16),
    ]);

    return {
      accumulatedCommitment,
      foldedEvalPoint,
      foldedEvalValue,
      foldedCoefficients: foldedCoeffs,
      foldedBlinding,
      degreeBound: maxLen - 1,
      steps,
      transcriptDigest: finalDigest,
    };
  }

  public verifyAccumulator(
    instances: readonly PolynomialOpeningInstance[],
    state: Halo2AccumulatorState
  ): Halo2VerificationResult {
    if (instances.length === 0 || instances.length !== state.steps.length) {
      return {
        isValid: false,
        verifiedSteps: 0,
        evaluatedAtFoldedPoint: 0n,
        recomputedCommitment: 0n,
        reason: 'Instance count does not match accumulation step count',
      };
    }

    let transcript = digestHex('HALO2_ACC_INIT', [String(instances.length), String(this.maxDegree)]);
    let expectedCommitment = 1n;

    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i];
      const step = state.steps[i];

      const expectedInstHash = digestHex('HALO2_INSTANCE', [
        inst.commitment.toString(16),
        inst.evalPoint.toString(16),
        inst.evalValue.toString(16),
        String(inst.degreeBound),
      ]);
      if (expectedInstHash !== inst.instanceHash) {
        return {
          isValid: false,
          verifiedSteps: i,
          evaluatedAtFoldedPoint: 0n,
          recomputedCommitment: expectedCommitment,
          reason: `Instance ${i} hash integrity mismatch`,
        };
      }

      const challenge = hashToField('HALO2_FOLD_CHALLENGE', [
        transcript,
        inst.commitment.toString(16),
        inst.evalPoint.toString(16),
        inst.evalValue.toString(16),
        String(i),
      ]);

      if (challenge !== step.foldingChallenge) {
        return {
          isValid: false,
          verifiedSteps: i,
          evaluatedAtFoldedPoint: 0n,
          recomputedCommitment: expectedCommitment,
          reason: `Folding challenge mismatch at step ${i}`,
        };
      }

      const scaledCommit = modPow(inst.commitment, challenge, GROUP_PRIME);
      expectedCommitment = modGroup(expectedCommitment * scaledCommit);

      transcript = digestHex('HALO2_ACC_STEP', [
        transcript,
        challenge.toString(16),
        expectedCommitment.toString(16),
      ]);

      if (
        expectedCommitment !== step.updatedCommitment ||
        transcript !== step.stepTranscriptHash
      ) {
        return {
          isValid: false,
          verifiedSteps: i,
          evaluatedAtFoldedPoint: 0n,
          recomputedCommitment: expectedCommitment,
          reason: `Accumulated commitment or transcript mismatch at step ${i}`,
        };
      }
    }

    const expectedPoint = hashToField('HALO2_FINAL_POINT', [
      transcript,
      expectedCommitment.toString(16),
    ]);
    if (expectedPoint !== state.foldedEvalPoint) {
      return {
        isValid: false,
        verifiedSteps: instances.length,
        evaluatedAtFoldedPoint: 0n,
        recomputedCommitment: expectedCommitment,
        reason: 'Folded evaluation point mismatch',
      };
    }

    const evaluatedAtFoldedPoint = this.evaluatePolynomial(
      state.foldedCoefficients,
      expectedPoint
    );
    if (evaluatedAtFoldedPoint !== state.foldedEvalValue) {
      return {
        isValid: false,
        verifiedSteps: instances.length,
        evaluatedAtFoldedPoint,
        recomputedCommitment: expectedCommitment,
        reason: 'Folded polynomial evaluation does not match claimed value',
      };
    }

    const recomputedCommitment = this.commitPolynomial(
      state.foldedCoefficients,
      state.foldedBlinding
    );
    if (
      recomputedCommitment !== state.accumulatedCommitment ||
      recomputedCommitment !== expectedCommitment
    ) {
      return {
        isValid: false,
        verifiedSteps: instances.length,
        evaluatedAtFoldedPoint,
        recomputedCommitment,
        reason: 'Folded polynomial commitment does not match homomorphic accumulation',
      };
    }

    const expectedFinalDigest = digestHex('HALO2_ACC_FINAL', [
      transcript,
      expectedPoint.toString(16),
      evaluatedAtFoldedPoint.toString(16),
    ]);
    if (expectedFinalDigest !== state.transcriptDigest) {
      return {
        isValid: false,
        verifiedSteps: instances.length,
        evaluatedAtFoldedPoint,
        recomputedCommitment,
        reason: 'Final accumulator transcript digest mismatch',
      };
    }

    return {
      isValid: true,
      verifiedSteps: instances.length,
      evaluatedAtFoldedPoint,
      recomputedCommitment,
    };
  }
}
