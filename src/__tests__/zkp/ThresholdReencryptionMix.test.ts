import { ThresholdReencryptionMix } from '../../core/zkp/ThresholdReencryptionMix';

describe('ThresholdReencryptionMix', () => {
  it('verifies re-encryption, multi-node mix shuffle, and (t, n) threshold decryption', () => {
    const mix = new ThresholdReencryptionMix(3, 5);
    const setup = mix.generateCommittee('mix-committee-01');
    const pubPoints = new Map(setup.trustees.map((t) => [t.trusteeId, t.publicVerificationPoint]));

    const plainPoints = [101n, 202n, 303n, 404n].map((m) => mix.encodeMessagePoint(m));
    const initialCts = plainPoints.map((pt, i) => mix.encrypt(setup.publicKeyPoint, pt, `ballot-${i}`));

    const reencProof = mix.reencryptWithProof(setup.publicKeyPoint, initialCts[0], 'reenc-0');
    expect(mix.verifyReencryption(setup.publicKeyPoint, reencProof)).toBe(true);

    const round1 = mix.executeMixRound('mix-node-A', setup.publicKeyPoint, initialCts, 'r1');
    expect(mix.verifyMixRound(setup.publicKeyPoint, round1)).toBe(true);

    const round2 = mix.executeMixRound('mix-node-B', setup.publicKeyPoint, round1.outputCiphertexts, 'r2');
    expect(mix.verifyMixRound(setup.publicKeyPoint, round2)).toBe(true);

    const recovered = round2.outputCiphertexts.map((ct, idx) => {
      const shares = [setup.trustees[0], setup.trustees[2], setup.trustees[4]].map((t) =>
        mix.createDecryptionShare(t, ct, `dec-${idx}`)
      );
      const dec = mix.combineDecryptionShares(ct, shares, pubPoints);
      expect(dec.isValid).toBe(true);
      return dec.recoveredMessagePoint;
    });

    const sortBigInt = (arr: bigint[]) => [...arr].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(sortBigInt(recovered)).toEqual(sortBigInt(plainPoints));
  });

  it('rejects tampered mix output ciphertexts and corrupted decryption shares', () => {
    const mix = new ThresholdReencryptionMix(2, 3);
    const setup = mix.generateCommittee('mix-committee-02');
    const pubPoints = new Map(setup.trustees.map((t) => [t.trusteeId, t.publicVerificationPoint]));

    const ct = mix.encrypt(setup.publicKeyPoint, mix.encodeMessagePoint(77n), 'm-77');
    const round = mix.executeMixRound('mix-1', setup.publicKeyPoint, [ct], 'r-tamper');
    const tamperedRound = {
      ...round,
      outputCiphertexts: [{ ...round.outputCiphertexts[0], c2: round.outputCiphertexts[0].c2 + 1n }],
    };
    expect(mix.verifyMixRound(setup.publicKeyPoint, tamperedRound)).toBe(false);

    const shares = [setup.trustees[0], setup.trustees[1]].map((t) =>
      mix.createDecryptionShare(t, ct, 'dec-t')
    );
    const badShares = [{ ...shares[0], partialFactor: shares[0].partialFactor + 1n }, shares[1]];
    expect(mix.combineDecryptionShares(ct, badShares, pubPoints).isValid).toBe(false);
  });
});
