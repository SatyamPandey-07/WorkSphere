import { describe, it, expect } from 'vitest';
import { VerifiableStateChannelDisputeProver, SAFE_PRIME_P, SUBGROUP_Q } from '../../core/zkp/VerifiableStateChannelDisputeProver';

describe('VerifiableStateChannelDisputeProver', () => {
  const prover = new VerifiableStateChannelDisputeProver();

  it('verifies co-signed balance-conserving states and resolves stale-state fraud disputes', () => {
    const alice = prover.generateKeys('alice');
    const bob = prover.generateKeys('bob');
    const config = {
      channelId: 'chan-eth-2026-01',
      partyAPublicKey: alice.publicKey,
      partyBPublicKey: bob.publicKey,
      totalDeposit: 1000n,
      disputeWindowBlocks: 144,
    };

    const s1 = prover.createSignedState(config, alice, bob, 1, 700n, 300n, false);
    const s5 = prover.createSignedState(config, alice, bob, 5, 250n, 750n, false);
    const sFinal = prover.createSignedState(config, alice, bob, 6, 200n, 800n, true);

    expect(prover.verifySignedState(config, s1)).toBe(true);
    expect(prover.verifySignedState(config, s5)).toBe(true);
    expect(prover.verifySignedState(config, sFinal)).toBe(true);

    const dispute = prover.adjudicateDispute(config, s1, s5, 'A', 1000, 1050);
    expect(dispute.disputeResolved).toBe(true);
    expect(dispute.winningNonce).toBe(5);
    expect(dispute.slashedParty).toBe('A');

    const late = prover.adjudicateDispute(config, s1, s5, 'A', 1000, 1200);
    expect(late.disputeResolved).toBe(false);

    const serialized = JSON.parse(prover.serializeState(sFinal)) as { nonce: number; isFinal: boolean };
    expect(serialized.nonce).toBe(6);
    expect(serialized.isFinal).toBe(true);
  });

  it('rejects non-conserving balances, forged signatures, and tampered conservation proofs', () => {
    const alice = prover.generateKeys('alice');
    const bob = prover.generateKeys('bob');
    const mallory = prover.generateKeys('mallory');
    const config = {
      channelId: 'chan-strict-02',
      partyAPublicKey: alice.publicKey,
      partyBPublicKey: bob.publicKey,
      totalDeposit: 500n,
      disputeWindowBlocks: 72,
    };

    expect(() => prover.createSignedState(config, alice, bob, -1, 250n, 250n)).toThrow();
    expect(() => prover.createSignedState(config, alice, bob, 0, 250n, 251n)).toThrow();
    expect(() => prover.createSignedState(config, alice, bob, 0, -1n, 501n)).toThrow();

    const valid = prover.createSignedState(config, alice, bob, 3, 500n, 0n, false);
    expect(prover.verifySignedState(config, valid)).toBe(true);

    expect(prover.verifySignedState(config, { ...valid, nonce: 4 })).toBe(false);
    expect(prover.verifySignedState(config, { ...valid, isFinal: true })).toBe(false);
    expect(prover.verifySignedState({ ...config, totalDeposit: 501n }, valid)).toBe(false);
    expect(prover.verifySignedState({ ...config, partyBPublicKey: mallory.publicKey }, valid)).toBe(false);
    expect(prover.verifySignedState(config, { ...valid, commitmentA: (valid.commitmentA * 4n) % SAFE_PRIME_P })).toBe(false);
    expect(prover.verifySignedState(config, { ...valid, sigA: { ...valid.sigA, s: (valid.sigA.s + 1n) % SUBGROUP_Q } })).toBe(false);
    expect(prover.verifySignedState(config, { ...valid, sigB: { ...valid.sigB, s: (valid.sigB.s + 1n) % SUBGROUP_Q } })).toBe(false);
    expect(
      prover.verifySignedState(config, {
        ...valid,
        conservationProof: { ...valid.conservationProof, responseBlinding: (valid.conservationProof.responseBlinding + 1n) % SUBGROUP_Q },
      }),
    ).toBe(false);

    // Equal or older challenger nonce cannot supersede claimed state
    const s2 = prover.createSignedState(config, alice, bob, 2, 100n, 400n, false);
    expect(prover.adjudicateDispute(config, valid, s2, 'B', 100, 110).disputeResolved).toBe(false);
    expect(prover.adjudicateDispute(config, valid, valid, 'B', 100, 110).disputeResolved).toBe(false);
  });
});
