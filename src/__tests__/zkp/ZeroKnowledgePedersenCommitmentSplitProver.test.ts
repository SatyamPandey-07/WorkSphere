import { describe, it, expect } from 'vitest';
import { ZeroKnowledgePedersenCommitmentSplitProver, SAFE_PRIME_P, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgePedersenCommitmentSplitProver';

describe('ZeroKnowledgePedersenCommitmentSplitProver', () => {
  it('proves confidential UTXO split/merge conservation, prevents inflation, and blocks double spends', () => {
    const engine = new ZeroKnowledgePedersenCommitmentSplitProver();
    const u1 = engine.mintUTXO('utxo-in-1', 600n);
    const u2 = engine.mintUTXO('utxo-in-2', 400n);

    // Split + merge: 600 + 400 = 550 + 300 + 140 + fee(10)
    const { tx, createdOutputs } = engine.createConfidentialTransfer(
      'tx-ct-001',
      [u1, u2],
      [
        { utxoId: 'utxo-out-1', amount: 550n },
        { utxoId: 'utxo-out-2', amount: 300n },
        { utxoId: 'utxo-out-3', amount: 140n },
      ],
      10n,
      14,
    );

    expect(engine.verifyTransfer(tx)).toBe(true);
    expect(engine.executeAndSpend(tx)).toEqual({ accepted: true });
    // Re-spending same input UTXO fails double-spend check
    expect(engine.executeAndSpend(tx)).toEqual({ accepted: false, doubleSpentInput: 'utxo-in-1' });

    // Chain next spend using newly created output UTXOs!
    const tx2 = engine.createConfidentialTransfer(
      'tx-ct-002',
      [createdOutputs[0], createdOutputs[2]], // 550 + 140 = 690
      [{ utxoId: 'utxo-final', amount: 685n }],
      5n,
      14,
    );
    expect(engine.executeAndSpend(tx2.tx)).toEqual({ accepted: true });

    // Inflation attempt throws; tampered fee/commitment/range proof fails verification
    expect(() =>
      engine.createConfidentialTransfer('inflate', [u1], [{ utxoId: 'x', amount: 601n }], 0n, 14),
    ).toThrow();
    expect(engine.verifyTransfer({ ...tx, fee: 11n })).toBe(false);
    expect(engine.verifyTransfer({ ...tx, excessResponseBlinding: (tx.excessResponseBlinding + 1n) % SUBGROUP_Q })).toBe(false);
    expect(
      engine.verifyTransfer({
        ...tx,
        outputCommitments: [(tx.outputCommitments[0] * 4n) % SAFE_PRIME_P, ...tx.outputCommitments.slice(1)],
      }),
    ).toBe(false);

    const json = JSON.parse(engine.serializeTx(tx)) as { inputCount: number; outputCount: number; fee: string };
    expect(json).toEqual({ txId: 'tx-ct-001', inputCount: 2, outputCount: 3, fee: '10' });
  });
});
