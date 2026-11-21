import { describe, it, expect } from 'vitest';
import { VerifiableChainedSignatureLedger, SUBGROUP_Q } from '../../core/zkp/VerifiableChainedSignatureLedger';

describe('VerifiableChainedSignatureLedger', () => {
  it('appends nonce-ordered signed blocks, verifies header chains, proves tx inclusion, and detects forks', () => {
    const ledger = new VerifiableChainedSignatureLedger('worksphere-l2');
    const alice = ledger.generateAccount('alice');
    const bob = ledger.generateAccount('bob');

    const tx0 = ledger.createSignedTx(alice, 'bob', 100n, 0);
    const tx1 = ledger.createSignedTx(alice, 'carol', 50n, 1);
    const txBadNonce = ledger.createSignedTx(alice, 'dave', 10n, 5);
    const txBadSig = { ...ledger.createSignedTx(bob, 'alice', 25n, 0), sigS: 777n };

    const b0 = ledger.appendBlock([tx0, txBadNonce, tx1, txBadSig]);
    expect(b0.block.transactions.length).toBe(2);
    expect(b0.rejectedTxIds).toEqual([txBadNonce.txId, txBadSig.txId]);

    const txBob0 = ledger.createSignedTx(bob, 'alice', 40n, 0);
    const txAlice2 = ledger.createSignedTx(alice, 'bob', 30n, 2);
    const b1 = ledger.appendBlock([txBob0, txAlice2]);

    expect(ledger.verifyHeaderRange([b0.block.header, b1.block.header])).toBe(true);
    expect(ledger.verifyHeaderRange([b0.block.header, { ...b1.block.header, previousBlockHash: '00'.repeat(32) }])).toBe(false);

    // Transaction inclusion verification against trusted header
    const inc = ledger.proveTxInclusion(1, 1);
    expect(ledger.verifyTxInclusion(inc, b1.block.header)).toBe(true);
    expect(ledger.verifyTxInclusion({ ...inc, tx: { ...inc.tx, amount: 999n } }, b1.block.header)).toBe(false);

    // Sequencer fork equivocation proof
    const forkHeader = ledger.createConflictingHeaderForAudit(1, b0.block.header.blockHash, 'ff'.repeat(32));
    expect(ledger.verifySequencerForkProof({ height: 1, headerA: b1.block.header, headerB: forkHeader })).toBe(true);
    expect(ledger.verifySequencerForkProof({ height: 1, headerA: b1.block.header, headerB: b1.block.header })).toBe(false);
    expect(ledger.verifyHeader({ ...b1.block.header, seqSigS: (b1.block.header.seqSigS + 1n) % SUBGROUP_Q })).toBe(false);

    const json = JSON.parse(ledger.serializeHeader(b1.block.header)) as { height: number; txCount: number };
    expect(json.height).toBe(1);
    expect(json.txCount).toBe(2);
  });
});
