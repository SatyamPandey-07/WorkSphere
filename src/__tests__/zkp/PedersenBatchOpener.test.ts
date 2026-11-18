import { PedersenBatchOpener } from '../../core/zkp/PedersenBatchOpener';

describe('PedersenBatchOpener', () => {
  it('batches and verifies multiple Pedersen vector commitments without revealing blindings', () => {
    const opener = new PedersenBatchOpener(4);
    const e1 = opener.commitVector('vec-1', [10n, 20n, 30n, 40n], 11111n);
    const e2 = opener.commitVector('vec-2', [5n, 15n, 25n, 35n], 22222n);
    const e3 = opener.commitVector('vec-3', [7n, 0n, 19n, 99n], 33333n);

    const proof = opener.createBatchOpeningProof([e1, e2, e3], 'batch-nonce-01');
    const result = opener.verifyBatchOpening(
      [e1.commitment, e2.commitment, e3.commitment],
      [e1.witness.values, e2.witness.values, e3.witness.values],
      proof
    );

    expect(result.isValid).toBe(true);
    expect(result.verifiedCommitments).toBe(3);
  });

  it('rejects tampered claimed vectors or forged Schnorr responses', () => {
    const opener = new PedersenBatchOpener(3);
    const e1 = opener.commitVector('c1', [1n, 2n, 3n], 501n);
    const e2 = opener.commitVector('c2', [4n, 5n, 6n], 602n);
    const proof = opener.createBatchOpeningProof([e1, e2], 'batch-nonce-02');

    const tamperedVec = opener.verifyBatchOpening(
      [e1.commitment, e2.commitment],
      [[1n, 2n, 999n], e2.witness.values],
      proof
    );
    expect(tamperedVec.isValid).toBe(false);

    const tamperedResp = opener.verifyBatchOpening(
      [e1.commitment, e2.commitment],
      [e1.witness.values, e2.witness.values],
      { ...proof, schnorrResponseS: proof.schnorrResponseS + 1n }
    );
    expect(tamperedResp.isValid).toBe(false);
  });
});
