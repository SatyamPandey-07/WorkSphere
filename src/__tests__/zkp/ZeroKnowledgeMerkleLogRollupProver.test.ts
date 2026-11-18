import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeMerkleLogRollupProver } from '../../core/zkp/ZeroKnowledgeMerkleLogRollupProver';

describe('ZeroKnowledgeMerkleLogRollupProver', () => {
  it('executes atomic rollup batches, preserves supply conservation, and pinpoints fraudulent intermediate roots', () => {
    const rollup = new ZeroKnowledgeMerkleLogRollupProver('treasury:fees');
    rollup.initAccount('alice', 1000n);
    rollup.initAccount('bob', 500n);
    rollup.initAccount('carol', 200n);

    const preSnap = rollup.snapshotAccounts();
    const batch = rollup.executeRollupBatch('batch-001', [
      { txId: 'tx-1', fromAccountId: 'alice', toAccountId: 'bob', amount: 300n, fee: 5n, nonce: 0 },
      { txId: 'tx-2', fromAccountId: 'bob', toAccountId: 'carol', amount: 150n, fee: 5n, nonce: 0 },
      { txId: 'tx-3', fromAccountId: 'alice', toAccountId: 'carol', amount: 100n, fee: 5n, nonce: 1 },
    ]);

    expect(batch.totalFeesCollected).toBe(15n);
    expect(batch.totalSupplyInvariant).toBe(1700n);
    expect(rollup.getAccount('alice')?.balance).toBe(590n);
    expect(rollup.verifyAndLocateFraud(preSnap, batch).valid).toBe(true);

    // Tamper intermediate root at index 1 -> fraud challenger pinpoints exact tx index 1!
    const forged = {
      ...batch,
      intermediateRoots: [batch.intermediateRoots[0], 'f'.repeat(64), batch.intermediateRoots[2]],
    };
    const fraud = rollup.verifyAndLocateFraud(preSnap, forged);
    expect(fraud.valid).toBe(false);
    expect(fraud.firstDivergentTxIndex).toBe(1);

    const json = rollup.serializeBatchProof(batch);
    const restored = rollup.deserializeBatchProof(json);
    expect(restored).toEqual(batch);
    expect(rollup.verifyAndLocateFraud(preSnap, restored).valid).toBe(true);
  });
});
