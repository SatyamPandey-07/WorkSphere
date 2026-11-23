import { describe, it, expect } from 'vitest';
import { VerifiableThresholdKeyRecoveryEscrow, SUBGROUP_Q } from '../../core/zkp/VerifiableThresholdKeyRecoveryEscrow';

describe('VerifiableThresholdKeyRecoveryEscrow', () => {
  const escrow = new VerifiableThresholdKeyRecoveryEscrow();

  it('enforces guardian thresholds, timelock windows, and active owner veto cancellation', () => {
    const owner = escrow.generateKeyPair('owner-old');
    const newOwner = escrow.generateKeyPair('owner-new');
    const g1 = escrow.generateKeyPair('guard-hw');
    const g2 = escrow.generateKeyPair('guard-alice');
    const g3 = escrow.generateKeyPair('guard-bob');
    const outsider = escrow.generateKeyPair('attacker');

    const policy = escrow.createWalletPolicy('vault-0x1', owner.publicKey, [g1, g2, g3], 2, 100);

    // Insufficient guardians (1 + outsider) fails
    const low = escrow.initiateRecovery(policy, newOwner.publicKey, 1000, [g1, outsider]);
    expect(low.proposal).toBeNull();
    expect(low.rejectedGuardianIds).toEqual(['attacker']);

    // Valid 2-of-3 proposal executable at block 1100
    const init = escrow.initiateRecovery(policy, newOwner.publicKey, 1000, [g1, g3, g1]);
    expect(init.proposal).not.toBeNull();
    expect(init.rejectedGuardianIds).toEqual(['guard-hw']);
    const prop = init.proposal!;

    // Before timelock expiry -> PENDING_TIMELOCK
    expect(escrow.resolveRecovery(policy, prop, 1050).status).toBe('PENDING_TIMELOCK');
    // At timelock expiry without veto -> FINALIZED
    const fin = escrow.resolveRecovery(policy, prop, 1100);
    expect(fin.status).toBe('FINALIZED');
    expect(fin.newOwnerPubKey).toBe(newOwner.publicKey);

    // Active owner veto within [1000, 1100) cancels recovery!
    const veto = escrow.createOwnerVeto(owner, prop, 1080);
    expect(escrow.resolveRecovery(policy, prop, 1105, veto).status).toBe('VETOED');

    // Fake veto signed by outsider or after timelock expiry is ignored
    const fakeVeto = escrow.createOwnerVeto(outsider, prop, 1080);
    expect(escrow.resolveRecovery(policy, prop, 1105, fakeVeto).status).toBe('FINALIZED');
    const lateVeto = escrow.createOwnerVeto(owner, prop, 1100);
    expect(escrow.resolveRecovery(policy, prop, 1105, lateVeto).status).toBe('FINALIZED');

    // Tampered approval signature renders proposal INVALID
    const badProp = { ...prop, approvals: [{ ...prop.approvals[0], sigS: (prop.approvals[0].sigS + 1n) % SUBGROUP_Q }, prop.approvals[1]] };
    expect(escrow.resolveRecovery(policy, badProp, 1200).status).toBe('INVALID');

    const json = JSON.parse(escrow.serializeProposal(prop)) as { executableBlock: number; approvalCount: number };
    expect(json.executableBlock).toBe(1100);
    expect(json.approvalCount).toBe(2);
  });

  it('rejects invalid policy configs, same-owner proposals, duplicate approvals, and wrong nonces', () => {
    const owner = escrow.generateKeyPair('own');
    const next = escrow.generateKeyPair('next');
    const g1 = escrow.generateKeyPair('g1');
    const g2 = escrow.generateKeyPair('g2');

    expect(() => escrow.createWalletPolicy('w', owner.publicKey, [g1, g2], 0, 10)).toThrow();
    expect(() => escrow.createWalletPolicy('w', owner.publicKey, [g1, g2], 3, 10)).toThrow();
    expect(() => escrow.createWalletPolicy('w', owner.publicKey, [g1, g2], 1, 0)).toThrow();
    expect(() => escrow.createWalletPolicy('w', owner.publicKey, [g1, g1], 1, 10)).toThrow();

    const policy = escrow.createWalletPolicy('w-strict', owner.publicKey, [g1, g2], 2, 50);
    expect(() => escrow.initiateRecovery(policy, owner.publicKey, 100, [g1, g2])).toThrow();

    const prop = escrow.initiateRecovery(policy, next.publicKey, 100, [g1, g2]).proposal!;
    expect(escrow.verifyProposal(policy, prop)).toBe(true);
    expect(escrow.verifyProposal({ ...policy, recoveryNonce: 1 }, prop)).toBe(false);
    expect(escrow.verifyProposal(policy, { ...prop, executableBlock: 149 })).toBe(false);
    expect(escrow.verifyProposal(policy, { ...prop, proposalDigest: '00'.repeat(32) })).toBe(false);
    expect(escrow.verifyProposal(policy, { ...prop, approvals: [prop.approvals[0], prop.approvals[0]] })).toBe(false);
    expect(escrow.verifyOwnerVeto(policy, prop, escrow.createOwnerVeto(owner, prop, 99))).toBe(false);
  });
});
