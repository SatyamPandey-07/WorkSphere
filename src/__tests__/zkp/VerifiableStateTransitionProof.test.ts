import { describe, it, expect } from 'vitest';
import {
  VerifiableStateTransitionProof,
  StateFieldMath,
  STATE_TRANSITION_PRIME,
} from '../../core/zkp/VerifiableStateTransitionProof';

describe('VerifiableStateTransitionProof', () => {
  const engine = new VerifiableStateTransitionProof(32);

  it('performs accurate modular arithmetic', () => {
    const a = 123456789n;
    const invA = StateFieldMath.inv(a);
    expect(StateFieldMath.mul(a, invA)).toBe(1n);
  });

  it('executes a state transition batch, generates proof, and verifies in O(1)', () => {
    // Initial state: Alice has 100, Bob has 50
    const initState = new Map<string, bigint>([
      ['alice_balance', 100n],
      ['bob_balance', 50n],
    ]);

    const preRoot = engine.computeStateRoot(initState);
    expect(preRoot).toBeDefined();

    // Batch mutations: Alice sends 30 to Bob
    const mutations = [
      { key: 'alice_balance', oldValue: 100n, newValue: 70n },
      { key: 'bob_balance', oldValue: 50n, newValue: 80n },
    ];

    const { postState, batch } = engine.executeTransitionBatch('batch_001', initState, mutations);

    expect(postState.get('alice_balance')).toBe(70n);
    expect(postState.get('bob_balance')).toBe(80n);
    expect(batch.steps.length).toBe(2);

    const proof = engine.generateTransitionProof(batch);
    expect(proof.batchId).toBe('batch_001');
    expect(proof.stepCount).toBe(2);

    const result = engine.verifyTransitionProof(batch.batchHash, proof);
    expect(result.isValid).toBe(true);
    expect(result.preStateRoot).toBe(preRoot);
    expect(result.postStateRoot).toBe(batch.postStateRoot);
  });

  it('rejects mutations with invalid preconditions (wrong oldValue)', () => {
    const initState = new Map<string, bigint>([['alice', 100n]]);
    const badMutations = [{ key: 'alice', oldValue: 999n, newValue: 50n }]; // expected 999, actually 100

    expect(() => {
      engine.executeTransitionBatch('batch_bad', initState, badMutations);
    }).toThrow('State precondition failure');
  });

  it('rejects tampered proofs with modified postStateRoot', () => {
    const initState = new Map<string, bigint>([['acc1', 1000n]]);
    const mutations = [{ key: 'acc1', oldValue: 1000n, newValue: 2000n }];

    const { batch } = engine.executeTransitionBatch('batch_tamper', initState, mutations);
    const proof = engine.generateTransitionProof(batch);

    // Tamper with postStateRoot
    const tamperedProof = {
      ...proof,
      postStateRoot: StateFieldMath.add(proof.postStateRoot, 1n),
    };

    const result = engine.verifyTransitionProof(batch.batchHash, tamperedProof);
    expect(result.isValid).toBe(false);
  });
});
