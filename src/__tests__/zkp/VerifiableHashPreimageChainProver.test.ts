import { describe, it, expect } from 'vitest';
import { VerifiableHashPreimageChainProver } from '../../core/zkp/VerifiableHashPreimageChainProver';

describe('VerifiableHashPreimageChainProver', () => {
  it('verifies full and O(step) checkpoint micro-payment vouchers while blocking replays', () => {
    const chain = new VerifiableHashPreimageChainProver('payword-chan-99', 120, 16);
    const commitment = chain.getCommitment();

    const v15 = chain.issueVoucher(15);
    const v67 = chain.issueVoucher(67);
    const v120 = chain.issueVoucher(120);

    expect(chain.verifyVoucherFull(commitment, v15)).toBe(true);
    expect(chain.verifyVoucherFastCheckpoint(commitment, v15)).toBe(true);
    expect(chain.verifyVoucherFull(commitment, v67)).toBe(true);
    expect(chain.verifyVoucherFastCheckpoint(commitment, v67)).toBe(true);
    expect(chain.verifyVoucherFastCheckpoint(commitment, v120)).toBe(true);

    expect(chain.verifyVoucherFastCheckpoint(commitment, { ...v67, redeemedUnits: 68 })).toBe(false);
    expect(chain.verifyVoucherFull(commitment, { ...v67, preimage: 'deadbeef' })).toBe(false);

    expect(chain.redeemMonotonic(commitment, v15)).toEqual({ accepted: true, deltaUnits: 15, totalRedeemed: 15 });
    expect(chain.redeemMonotonic(commitment, v67)).toEqual({ accepted: true, deltaUnits: 52, totalRedeemed: 67 });
    const replay = chain.redeemMonotonic(commitment, v15);
    expect(replay.accepted).toBe(false);
    expect(replay.totalRedeemed).toBe(67);

    const parsed = JSON.parse(chain.serializeVoucher(v67)) as { redeemedUnits: number };
    expect(parsed.redeemedUnits).toBe(67);
  });

  it('produces identical commitments from a deterministic seed and verifies every checkpoint boundary', () => {
    const seed = 'a1b2c3d4'.repeat(8);
    const c1 = new VerifiableHashPreimageChainProver('det-chan', 64, 8, seed);
    const c2 = new VerifiableHashPreimageChainProver('det-chan', 64, 8, seed);
    expect(c1.getCommitment()).toEqual(c2.getCommitment());
    expect(c1.getCommitment().checkpointCount).toBe(9);

    const comm = c1.getCommitment();
    // Exact multiples of checkpointStep (stepsToCheckpoint === 0) and adjacent off-by-1 values
    for (const units of [1, 7, 8, 9, 16, 31, 32, 33, 63, 64]) {
      const v = c1.issueVoucher(units);
      expect(c1.verifyVoucherFull(comm, v)).toBe(true);
      expect(c1.verifyVoucherFastCheckpoint(comm, v)).toBe(true);
      expect(v.stepsToCheckpoint!).toBeLessThanOrEqual(8);
    }
  });

  it('rejects out-of-range constructor args, invalid voucher bounds, and tampered checkpoints', () => {
    expect(() => new VerifiableHashPreimageChainProver('bad', 3, 1)).toThrow();
    expect(() => new VerifiableHashPreimageChainProver('bad', 10001, 16)).toThrow();
    expect(() => new VerifiableHashPreimageChainProver('bad', 20, 0)).toThrow();
    expect(() => new VerifiableHashPreimageChainProver('bad', 20, 21)).toThrow();

    const chain = new VerifiableHashPreimageChainProver('strict-chan', 50, 10);
    const comm = chain.getCommitment();
    expect(() => chain.issueVoucher(0)).toThrow();
    expect(() => chain.issueVoucher(51)).toThrow();

    const v25 = chain.issueVoucher(25);
    expect(chain.verifyVoucherFull(comm, { ...v25, chainId: 'other-chan' })).toBe(false);
    expect(chain.verifyVoucherFull(comm, { ...v25, anchorRoot: '00'.repeat(32) })).toBe(false);
    expect(chain.verifyVoucherFull(comm, { ...v25, redeemedUnits: 0 })).toBe(false);
    expect(chain.verifyVoucherFull(comm, { ...v25, redeemedUnits: 51 })).toBe(false);

    // Missing or tampered checkpoint proof fails fast verification
    expect(chain.verifyVoucherFastCheckpoint(comm, { ...v25, nearestCheckpoint: undefined })).toBe(false);
    expect(
      chain.verifyVoucherFastCheckpoint(comm, {
        ...v25,
        nearestCheckpoint: { ...v25.nearestCheckpoint!, checkpointHash: 'ff'.repeat(32) },
      }),
    ).toBe(false);
    expect(
      chain.verifyVoucherFastCheckpoint(comm, {
        ...v25,
        nearestCheckpoint: { ...v25.nearestCheckpoint!, checkpointMerkleRoot: '11'.repeat(32) },
      }),
    ).toBe(false);
    expect(chain.verifyVoucherFastCheckpoint(comm, { ...v25, stepsToCheckpoint: -1 })).toBe(false);

    // Invalid voucher rejected cleanly by redeemMonotonic without advancing state
    const badRedeem = chain.redeemMonotonic(comm, { ...v25, preimage: 'bad' });
    expect(badRedeem.accepted).toBe(false);
    expect(badRedeem.totalRedeemed).toBe(0);

    // Duplicate exact redemption rejected
    expect(chain.redeemMonotonic(comm, v25)).toEqual({ accepted: true, deltaUnits: 25, totalRedeemed: 25 });
    expect(chain.redeemMonotonic(comm, v25).accepted).toBe(false);
    expect(chain.redeemMonotonic(comm, chain.issueVoucher(50))).toEqual({ accepted: true, deltaUnits: 25, totalRedeemed: 50 });
  });

  it('handles non-divisible chain lengths, checkpointStep=1, and full end-to-end incremental redemptions', () => {
    const oddChain = new VerifiableHashPreimageChainProver('odd-len-chan', 37, 7);
    const comm = oddChain.getCommitment();
    expect(comm.length).toBe(37);
    expect(comm.checkpointStep).toBe(7);

    let expectedTotal = 0;
    for (const step of [3, 10, 19, 28, 37]) {
      const voucher = oddChain.issueVoucher(step);
      expect(oddChain.verifyVoucherFull(comm, voucher)).toBe(true);
      expect(oddChain.verifyVoucherFastCheckpoint(comm, voucher)).toBe(true);
      const res = oddChain.redeemMonotonic(comm, voucher);
      expect(res.accepted).toBe(true);
      expect(res.deltaUnits).toBe(step - expectedTotal);
      expectedTotal = step;
    }

    const denseChain = new VerifiableHashPreimageChainProver('dense-1', 12, 1);
    const denseComm = denseChain.getCommitment();
    const vDense = denseChain.issueVoucher(5);
    expect(vDense.stepsToCheckpoint).toBe(0);
    expect(denseChain.verifyVoucherFastCheckpoint(denseComm, vDense)).toBe(true);
  });
});
