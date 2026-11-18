import { describe, it, expect } from 'vitest';
import { ConfidentialAssetTransferProver } from '../../core/zkp/ConfidentialAssetTransferProver';

describe('ConfidentialAssetTransferProver', () => {
  const prover = new ConfidentialAssetTransferProver();

  it('proves confidential transfers with zero inflation and valid non-negative range proofs', () => {
    const alice = prover.createAccount('dept-alice', 1000n);
    const bob = prover.createAccount('dept-bob', 250n);

    const { proof, updatedSender, updatedRecipient } = prover.createConfidentialTransfer(
      'tx-budget-001',
      alice,
      bob,
      340n,
      10n,
      12
    );

    expect(updatedSender.balance).toBe(650n);
    expect(updatedRecipient.balance).toBe(590n);
    expect(prover.commit(updatedRecipient.balance, updatedRecipient.blinding)).toBe(updatedRecipient.commitment);
    expect(prover.verifyTransferProof(proof).valid).toBe(true);
  });

  it('rejects overdrafts, forged fees, and tampered range proofs', () => {
    const alice = prover.createAccount('dept-a', 200n);
    const bob = prover.createAccount('dept-b', 50n);

    expect(() => prover.createConfidentialTransfer('tx-overdraft', alice, bob, 205n, 0n, 10)).toThrow();

    const { proof } = prover.createConfidentialTransfer('tx-tamper', alice, bob, 80n, 5n, 10);
    expect(prover.verifyTransferProof({ ...proof, publicFee: 6n }).valid).toBe(false);
    expect(
      prover.verifyTransferProof({
        ...proof,
        conservationResponse: proof.conservationResponse + 1n,
      }).valid
    ).toBe(false);
    expect(
      prover.verifyTransferProof({
        ...proof,
        transferRangeProof: {
          ...proof.transferRangeProof,
          linkResponse: proof.transferRangeProof.linkResponse + 1n,
        },
      }).valid
    ).toBe(false);
  });

  it('batch-audits sequential confidential transfers and round-trips JSON serialization', () => {
    let sender = prover.createAccount('treasury', 500n);
    let recipient = prover.createAccount('engineering', 100n);

    const t1 = prover.createConfidentialTransfer('tx-1', sender, recipient, 150n, 5n, 10);
    sender = t1.updatedSender;
    recipient = t1.updatedRecipient;
    const t2 = prover.createConfidentialTransfer('tx-2', sender, recipient, 200n, 10n, 10);

    const batch = prover.batchAuditTransfers([t1.proof, t2.proof]);
    expect(batch.allValid).toBe(true);
    expect(batch.verifiedIds).toEqual(['tx-1', 'tx-2']);
    expect(batch.totalPublicFees).toBe(15n);

    const json = prover.serializeTransferProof(t2.proof);
    const decoded = prover.deserializeTransferProof(json);
    expect(prover.verifyTransferProof(decoded).valid).toBe(true);
  });
});
