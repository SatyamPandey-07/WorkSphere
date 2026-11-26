import { RangeBitmapProver } from '../../core/zkp/RangeBitmapProver';

describe('RangeBitmapProver', () => {
  it('proves and verifies confidential Pedersen range membership for valid values', () => {
    const prover = new RangeBitmapProver();
    const proof = prover.proveRange(42_195n, 999_888_777n, 16, 'range-nonce-01');
    const result = prover.verifyRange(proof);

    expect(result.isValid).toBe(true);
    expect(result.verifiedBits).toBe(16);
    expect(result.recombinedCommitment).toBe(proof.valueCommitment);
  });

  it('handles boundary values 0 and 2^n - 1', () => {
    const prover = new RangeBitmapProver();
    expect(prover.verifyRange(prover.proveRange(0n, 111n, 8, 'zero-case')).isValid).toBe(true);
    expect(prover.verifyRange(prover.proveRange(255n, 222n, 8, 'max-case')).isValid).toBe(true);
    expect(() => prover.proveRange(256n, 333n, 8, 'overflow-case')).toThrow();
  });

  it('rejects tampered bit Sigma-OR proofs or mismatched value commitments', () => {
    const prover = new RangeBitmapProver();
    const proof = prover.proveRange(73n, 5555n, 8, 'tamper-case');

    const badBit = prover.verifyRange({
      ...proof,
      bitProofs: [
        { ...proof.bitProofs[0], s0: proof.bitProofs[0].s0 + 1n },
        ...proof.bitProofs.slice(1),
      ],
    });
    expect(badBit.isValid).toBe(false);

    const badCommit = prover.verifyRange({
      ...proof,
      valueCommitment: prover.commitValue(74n, 5555n),
    });
    expect(badCommit.isValid).toBe(false);
  });
});
