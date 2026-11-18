import { describe, it, expect } from 'vitest';
import {
  ZKProofCompositionEngine,
  CompositionFieldMath,
  COMPOSITION_PRIME,
} from '../../core/zkp/ZKProofCompositionEngine';

describe('ZKProofCompositionEngine', () => {
  const engine = new ZKProofCompositionEngine();

  it('performs accurate field arithmetic over BN254', () => {
    const a = 12345678901234567890n;
    const b = 98765432109876543210n;
    const sum = CompositionFieldMath.add(a, b);
    const diff = CompositionFieldMath.sub(sum, b);
    expect(diff).toBe(a);

    const invA = CompositionFieldMath.inv(a);
    const prod = CompositionFieldMath.mul(a, invA);
    expect(prod).toBe(1n);
  });

  it('creates well-formed proof nodes', () => {
    const node = engine.createProofNode(
      'proof-1',
      [10n, 20n],
      [100n, 200n],
      50n,
      1
    );
    expect(node.proofId).toBe('proof-1');
    expect(node.step).toBe(1);
    expect(node.publicInputs).toEqual([10n, 20n]);
    expect(node.commitments).toEqual([100n, 200n]);
    expect(node.evaluationProof).toBe(50n);
  });

  it('composes multiple ZK proof nodes into a recursive bundle and verifies correctly', () => {
    const node1 = engine.createProofNode('proof-1', [10n, 20n], [100n, 200n], 50n, 1);
    const node2 = engine.createProofNode('proof-2', [30n, 40n], [300n, 400n], 75n, 2);
    const node3 = engine.createProofNode('proof-3', [50n, 60n], [500n, 600n], 90n, 3);

    const bundle = engine.compose([node1, node2, node3]);
    expect(bundle.trace.stepCount).toBe(3);
    expect(bundle.trace.nodeIds).toEqual(['proof-1', 'proof-2', 'proof-3']);

    const result = engine.verifyComposedProof(bundle);
    expect(result.isValid).toBe(true);
    expect(result.verifiedSteps).toBe(3);
  });

  it('supports incremental step-by-step folding', () => {
    const node1 = engine.createProofNode('node-1', [11n], [111n], 222n, 1);
    const node2 = engine.createProofNode('node-2', [33n], [333n], 444n, 2);

    let trace = {
      stepCount: 1,
      nodeIds: [node1.proofId],
      foldingChallenges: [1n],
      accumulatedCommitment: 111n,
      accumulatedEvaluation: node1.evaluationProof,
      aggregatedPublicInputs: [...node1.publicInputs],
    };

    trace = engine.foldStep(trace, node2);
    expect(trace.stepCount).toBe(2);
    expect(trace.nodeIds).toEqual(['node-1', 'node-2']);
    expect(trace.foldingChallenges.length).toBe(2);
  });

  it('rejects tampered recursive proof bundles', () => {
    const node1 = engine.createProofNode('proof-1', [10n], [100n], 50n);
    const node2 = engine.createProofNode('proof-2', [20n], [200n], 60n);

    const bundle = engine.compose([node1, node2]);

    // Tamper with accumulated evaluation
    const tamperedBundle = {
      ...bundle,
      composedEvaluationProof: CompositionFieldMath.add(bundle.composedEvaluationProof, 1n),
    };

    const result = engine.verifyComposedProof(tamperedBundle);
    expect(result.isValid).toBe(false);
  });
});
