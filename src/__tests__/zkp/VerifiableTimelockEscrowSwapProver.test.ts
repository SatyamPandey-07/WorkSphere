import { describe, it, expect } from 'vitest';
import { VerifiableTimelockEscrowSwapProver, SUBGROUP_Q } from '../../core/zkp/VerifiableTimelockEscrowSwapProver';

describe('VerifiableTimelockEscrowSwapProver', () => {
  it('enforces timelock safety margins, atomic preimage claim settlement, and expiry refunds', () => {
    const engine = new VerifiableTimelockEscrowSwapProver();
    const alice = engine.generatePartyKeys('alice');
    const bob = engine.generatePartyKeys('bob');
    const { preimageHex, hashlock } = engine.generatePreimageAndLock();

    const legA = engine.createContract({
      contractId: 'swap-leg-a',
      chain: 'chain-alpha',
      senderPubKey: alice.publicKey,
      recipientPubKey: bob.publicKey,
      amountCommitment: engine.commitAmount(500n).commitment,
      hashlock,
      timelockBlock: 200,
    });

    const legB = engine.createContract({
      contractId: 'swap-leg-b',
      chain: 'chain-beta',
      senderPubKey: bob.publicKey,
      recipientPubKey: alice.publicKey,
      amountCommitment: engine.commitAmount(1200n).commitment,
      hashlock,
      timelockBlock: 150,
    });

    expect(engine.verifySwapPairSafety(legA, legB, 24)).toEqual({ safe: true });
    expect(engine.verifySwapPairSafety(legA, { ...legB, timelockBlock: 195 }, 24).safe).toBe(false);

    const receiptA = engine.claim('swap-leg-b', alice, preimageHex, 120);
    expect(engine.verifyClaimReceipt(legB, receiptA)).toBe(true);
    expect(engine.verifyClaimReceipt(legB, { ...receiptA, preimageHex: '00'.repeat(32) })).toBe(false);

    const receiptB = engine.claim('swap-leg-a', bob, receiptA.preimageHex, 135);
    expect(engine.verifyClaimReceipt(legA, receiptB)).toBe(true);

    const legExpired = engine.createContract({
      contractId: 'swap-expired',
      chain: 'chain-alpha',
      senderPubKey: alice.publicKey,
      recipientPubKey: bob.publicKey,
      amountCommitment: engine.commitAmount(300n).commitment,
      hashlock,
      timelockBlock: 100,
    });
    expect(() => engine.refund('swap-expired', alice, 99)).toThrow();
    const refund = engine.refund('swap-expired', alice, 100);
    expect(engine.verifyRefundReceipt(legExpired, refund)).toBe(true);

    const json = JSON.parse(engine.serializeContract(legA)) as { contractId: string; timelockBlock: number };
    expect(json.contractId).toBe('swap-leg-a');
    expect(json.timelockBlock).toBe(200);
  });

  it('rejects duplicate contract IDs, double claims, wrong keys, and safety invariant violations', () => {
    const engine = new VerifiableTimelockEscrowSwapProver();
    const alice = engine.generatePartyKeys('alice');
    const bob = engine.generatePartyKeys('bob');
    const eve = engine.generatePartyKeys('eve');
    const { preimageHex, hashlock } = engine.generatePreimageAndLock();
    const { hashlock: otherLock } = engine.generatePreimageAndLock();

    expect(() => engine.commitAmount(0n)).toThrow();
    expect(() => engine.commitAmount(-10n)).toThrow();

    const c1 = engine.createContract({
      contractId: 'htlc-1',
      chain: 'dom-1',
      senderPubKey: alice.publicKey,
      recipientPubKey: bob.publicKey,
      amountCommitment: engine.commitAmount(100n, 999n).commitment,
      hashlock,
      timelockBlock: 500,
    });
    expect(() =>
      engine.createContract({
        contractId: 'htlc-1',
        chain: 'dom-2',
        senderPubKey: bob.publicKey,
        recipientPubKey: alice.publicKey,
        amountCommitment: engine.commitAmount(100n).commitment,
        hashlock,
        timelockBlock: 400,
      }),
    ).toThrow();

    // Safety check failures: hashlock mismatch, same chain, non-mirrored keys
    const sameChain = { ...c1, contractId: 'c2', senderPubKey: bob.publicKey, recipientPubKey: alice.publicKey, timelockBlock: 400 };
    expect(engine.verifySwapPairSafety(c1, sameChain).safe).toBe(false);
    expect(engine.verifySwapPairSafety(c1, { ...sameChain, chain: 'dom-2', hashlock: otherLock }).safe).toBe(false);
    expect(engine.verifySwapPairSafety(c1, { ...sameChain, chain: 'dom-2', recipientPubKey: eve.publicKey }).safe).toBe(false);

    // Wrong claimant key, expired claim block, wrong preimage, unknown contract
    expect(() => engine.claim('missing', bob, preimageHex, 100)).toThrow();
    expect(() => engine.claim('htlc-1', eve, preimageHex, 100)).toThrow();
    expect(() => engine.claim('htlc-1', bob, preimageHex, 500)).toThrow();
    expect(() => engine.claim('htlc-1', bob, '11'.repeat(32), 100)).toThrow();

    const claim = engine.claim('htlc-1', bob, preimageHex, 499);
    expect(engine.verifyClaimReceipt(c1, claim)).toBe(true);
    expect(engine.verifyClaimReceipt(c1, { ...claim, claimBlock: 500 })).toBe(false);
    expect(engine.verifyClaimReceipt(c1, { ...claim, contractId: 'wrong' })).toBe(false);
    expect(engine.verifyClaimReceipt(c1, { ...claim, recipientSigS: (claim.recipientSigS + 1n) % SUBGROUP_Q })).toBe(false);

    // Already claimed cannot be claimed or refunded again
    expect(() => engine.claim('htlc-1', bob, preimageHex, 499)).toThrow();
    expect(() => engine.refund('htlc-1', alice, 600)).toThrow();
  });

  it('rejects forged refund receipts and unauthorized refund callers', () => {
    const engine = new VerifiableTimelockEscrowSwapProver();
    const alice = engine.generatePartyKeys('alice');
    const bob = engine.generatePartyKeys('bob');
    const { hashlock } = engine.generatePreimageAndLock();

    const c = engine.createContract({
      contractId: 'refund-only',
      chain: 'dom-x',
      senderPubKey: alice.publicKey,
      recipientPubKey: bob.publicKey,
      amountCommitment: engine.commitAmount(250n).commitment,
      hashlock,
      timelockBlock: 300,
    });

    expect(() => engine.refund('refund-only', bob, 310)).toThrow();
    const r = engine.refund('refund-only', alice, 305);
    expect(engine.verifyRefundReceipt(c, r)).toBe(true);
    expect(engine.verifyRefundReceipt(c, { ...r, refundBlock: 299 })).toBe(false);
    expect(engine.verifyRefundReceipt(c, { ...r, contractId: 'other' })).toBe(false);
    expect(engine.verifyRefundReceipt(c, { ...r, senderSigS: (r.senderSigS + 1n) % SUBGROUP_Q })).toBe(false);
  });
});
