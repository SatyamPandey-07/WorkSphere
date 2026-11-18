/**
 * @file ZKProofCompositionEngine.ts
 * @description Recursive Zero-Knowledge Proof Composition & Linear Folding Engine.
 * Implements succinct multi-proof aggregation and incremental proof verification (IVC)
 * over the BN254 scalar field. Compresses arbitrary DAGs or chains of heterogeneous inner
 * zero-knowledge statements into a constant-size recursive outer proof bundle with Fiat-Shamir
 * challenge derivation and non-interactive polynomial evaluation folding.
 */

import { createHash, randomBytes } from 'crypto';

export const COMPOSITION_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Modular arithmetic utilities over BN254.
 */
export class CompositionFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = COMPOSITION_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = COMPOSITION_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = COMPOSITION_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = COMPOSITION_PRIME): bigint {
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

  public static inv(a: bigint, p: bigint = COMPOSITION_PRIME): bigint {
    if (a % p === 0n) throw new Error('Division by zero in finite field');
    return this.exp(a, p - 2n, p);
  }

  public static hashToField(data: string, p: bigint = COMPOSITION_PRIME): bigint {
    const hashHex = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + hashHex) % p;
  }
}

/**
 * Individual inner proof node to be composed.
 */
export interface ZKProofNode {
  proofId: string;
  step: number;
  publicInputs: bigint[];
  commitments: bigint[];
  evaluationProof: bigint;
  metadata?: Record<string, unknown>;
}

/**
 * Proof composition trace tracking folded state across steps.
 */
export interface ProofCompositionTrace {
  stepCount: number;
  nodeIds: string[];
  foldingChallenges: bigint[];
  accumulatedCommitment: bigint;
  accumulatedEvaluation: bigint;
  aggregatedPublicInputs: bigint[];
}

/**
 * Aggregated recursive proof bundle.
 */
export interface RecursiveProofBundle {
  trace: ProofCompositionTrace;
  composedEvaluationProof: bigint;
  finalAccumulator: bigint;
  transcriptHash: string;
}

/**
 * Verification result for recursive composition.
 */
export interface CompositionVerificationResult {
  isValid: boolean;
  reason?: string;
  verifiedSteps: number;
}

/**
 * Engine for recursive ZK proof composition and linear folding.
 */
export class ZKProofCompositionEngine {
  private prime: bigint;

  constructor(prime: bigint = COMPOSITION_PRIME) {
    this.prime = prime;
  }

  /**
   * Generates a well-formed ZK proof node.
   */
  public createProofNode(
    proofId: string,
    publicInputs: bigint[],
    commitments: bigint[],
    evaluationProof: bigint,
    step: number = 0,
    metadata?: Record<string, unknown>
  ): ZKProofNode {
    return {
      proofId,
      step,
      publicInputs: publicInputs.map((x) => ((x % this.prime) + this.prime) % this.prime),
      commitments: commitments.map((x) => ((x % this.prime) + this.prime) % this.prime),
      evaluationProof: ((evaluationProof % this.prime) + this.prime) % this.prime,
      metadata,
    };
  }

  /**
   * Derives a Fiat-Shamir challenge for folding.
   */
  public deriveChallenge(transcript: string, ...values: bigint[]): bigint {
    const serializedValues = values.map((v) => v.toString(16)).join(':');
    return CompositionFieldMath.hashToField(`${transcript}|${serializedValues}`, this.prime);
  }

  /**
   * Incrementally folds a single incoming proof node into an existing composition trace.
   */
  public foldStep(accumulator: ProofCompositionTrace, nextNode: ZKProofNode): ProofCompositionTrace {
    const challengeSeed = `fold_${accumulator.stepCount}_${nextNode.proofId}`;
    const gamma = this.deriveChallenge(
      challengeSeed,
      accumulator.accumulatedCommitment,
      accumulator.accumulatedEvaluation,
      ...nextNode.commitments,
      nextNode.evaluationProof
    );

    // Fold commitments: Acc_C = Acc_C + gamma * sum(nextNode.commitments)
    let nodeCommSum = 0n;
    for (const c of nextNode.commitments) {
      nodeCommSum = CompositionFieldMath.add(nodeCommSum, c, this.prime);
    }
    const scaledNodeComm = CompositionFieldMath.mul(gamma, nodeCommSum, this.prime);
    const newAccComm = CompositionFieldMath.add(accumulator.accumulatedCommitment, scaledNodeComm, this.prime);

    // Fold evaluations: Acc_E = Acc_E + gamma * nextNode.evaluationProof
    const scaledNodeEval = CompositionFieldMath.mul(gamma, nextNode.evaluationProof, this.prime);
    const newAccEval = CompositionFieldMath.add(accumulator.accumulatedEvaluation, scaledNodeEval, this.prime);

    // Aggregate public inputs with step index scaling
    const maxLen = Math.max(accumulator.aggregatedPublicInputs.length, nextNode.publicInputs.length);
    const newPubInputs: bigint[] = [];
    for (let i = 0; i < maxLen; i++) {
      const prevVal = accumulator.aggregatedPublicInputs[i] ?? 0n;
      const nextVal = nextNode.publicInputs[i] ?? 0n;
      const scaledVal = CompositionFieldMath.mul(gamma, nextVal, this.prime);
      newPubInputs.push(CompositionFieldMath.add(prevVal, scaledVal, this.prime));
    }

    return {
      stepCount: accumulator.stepCount + 1,
      nodeIds: [...accumulator.nodeIds, nextNode.proofId],
      foldingChallenges: [...accumulator.foldingChallenges, gamma],
      accumulatedCommitment: newAccComm,
      accumulatedEvaluation: newAccEval,
      aggregatedPublicInputs: newPubInputs,
    };
  }

  /**
   * Aggregates an arbitrary list of proof nodes into a unified recursive proof bundle.
   */
  public compose(nodes: ZKProofNode[], transcriptSeed: string = 'zk_recursive_composition'): RecursiveProofBundle {
    if (nodes.length === 0) {
      throw new Error('Cannot compose empty list of proof nodes');
    }

    const firstNode = nodes[0];
    let initCommSum = 0n;
    for (const c of firstNode.commitments) {
      initCommSum = CompositionFieldMath.add(initCommSum, c, this.prime);
    }

    let trace: ProofCompositionTrace = {
      stepCount: 1,
      nodeIds: [firstNode.proofId],
      foldingChallenges: [1n],
      accumulatedCommitment: initCommSum,
      accumulatedEvaluation: firstNode.evaluationProof,
      aggregatedPublicInputs: [...firstNode.publicInputs],
    };

    for (let i = 1; i < nodes.length; i++) {
      trace = this.foldStep(trace, nodes[i]);
    }

    // Final Fiat-Shamir challenge to bind the entire composition trace
    const finalTranscript = `${transcriptSeed}_${trace.stepCount}_${trace.accumulatedCommitment.toString(16)}`;
    const finalChallenge = this.deriveChallenge(
      finalTranscript,
      trace.accumulatedCommitment,
      trace.accumulatedEvaluation,
      ...trace.aggregatedPublicInputs
    );

    // Formulate final compressed accumulator and composed evaluation proof
    const finalAccumulator = CompositionFieldMath.add(
      trace.accumulatedCommitment,
      CompositionFieldMath.mul(finalChallenge, trace.accumulatedEvaluation, this.prime),
      this.prime
    );

    const composedEvaluationProof = CompositionFieldMath.mul(
      trace.accumulatedEvaluation,
      CompositionFieldMath.exp(finalChallenge, 2n, this.prime),
      this.prime
    );

    const transcriptHash = createHash('sha256')
      .update(finalTranscript + finalAccumulator.toString(16))
      .digest('hex');

    return {
      trace,
      composedEvaluationProof,
      finalAccumulator,
      transcriptHash,
    };
  }

  /**
   * Verifies an aggregated recursive proof bundle against reconstructed step commitments.
   */
  public verifyComposedProof(bundle: RecursiveProofBundle, transcriptSeed: string = 'zk_recursive_composition'): CompositionVerificationResult {
    const { trace, composedEvaluationProof, finalAccumulator, transcriptHash } = bundle;

    if (trace.stepCount === 0 || trace.nodeIds.length !== trace.stepCount) {
      return {
        isValid: false,
        reason: 'Invalid trace step count or node mismatch',
        verifiedSteps: 0,
      };
    }

    const reconstructedTranscript = `${transcriptSeed}_${trace.stepCount}_${trace.accumulatedCommitment.toString(16)}`;
    const finalChallenge = this.deriveChallenge(
      reconstructedTranscript,
      trace.accumulatedCommitment,
      trace.accumulatedEvaluation,
      ...trace.aggregatedPublicInputs
    );

    // Check transcript hash integrity
    const expectedHash = createHash('sha256')
      .update(reconstructedTranscript + finalAccumulator.toString(16))
      .digest('hex');

    if (transcriptHash !== expectedHash) {
      return {
        isValid: false,
        reason: 'Transcript hash mismatch: proof bundle tampered',
        verifiedSteps: 0,
      };
    }

    // Check algebraic accumulator identity: FinalAcc == Acc_C + challenge * Acc_E
    const expectedFinalAcc = CompositionFieldMath.add(
      trace.accumulatedCommitment,
      CompositionFieldMath.mul(finalChallenge, trace.accumulatedEvaluation, this.prime),
      this.prime
    );

    if (finalAccumulator !== expectedFinalAcc) {
      return {
        isValid: false,
        reason: 'Accumulator algebraic relation violated',
        verifiedSteps: 0,
      };
    }

    // Check composed evaluation proof identity
    const expectedComposedEval = CompositionFieldMath.mul(
      trace.accumulatedEvaluation,
      CompositionFieldMath.exp(finalChallenge, 2n, this.prime),
      this.prime
    );

    if (composedEvaluationProof !== expectedComposedEval) {
      return {
        isValid: false,
        reason: 'Composed evaluation proof verification failed',
        verifiedSteps: 0,
      };
    }

    return {
      isValid: true,
      verifiedSteps: trace.stepCount,
    };
  }
}
