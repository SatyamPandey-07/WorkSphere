import { ThresholdAdaptorSignature } from '../../core/zkp/ThresholdAdaptorSignature';

describe('ThresholdAdaptorSignature', () => {
  it('produces threshold adaptor pre-signature, adapts to valid Schnorr signature, and extracts witness y', () => {
    const tas = new ThresholdAdaptorSignature(3, 5);
    const committee = tas.generateCommittee('swap-committee-01');
    const pubMap = new Map(committee.signers.map((s) => [s.signerId, s.publicVerificationPoint]));
    const adaptor = tas.createAdaptorStatement('atomic-swap-secret-01');

    const msg = '0xswap_settlement_tx_01';
    const selectedSigners = [committee.signers[0], committee.signers[2], committee.signers[4]];
    const selectedIds = selectedSigners.map((s) => s.signerId);
    const nonces = selectedSigners.map((s) => tas.generateSignerNonce(s.signerId, msg, 'sess-01'));
    const P = 0xffffffffffffffffffffffffffffc3a7n;
    const aggR = nonces.reduce((acc, n) => (acc * n.noncePointR) % P, 1n);

    const partials = selectedSigners.map((s, idx) =>
      tas.createPartialPreSignature(
        s,
        selectedIds,
        nonces[idx].nonceScalar,
        nonces[idx].noncePointR,
        aggR,
        adaptor.adaptorPointY,
        committee.groupPublicKeyX,
        msg
      )
    );

    const preSig = tas.aggregatePreSignature(
      msg,
      committee.groupPublicKeyX,
      adaptor.adaptorPointY,
      partials,
      pubMap
    );
    expect(tas.verifyPreSignature(preSig)).toBe(true);

    const fullSig = tas.adaptPreSignature(preSig, adaptor.adaptorWitnessY);
    expect(tas.verifyAdaptedSignature(fullSig)).toBe(true);

    const extracted = tas.extractAdaptorWitness(preSig, fullSig);
    expect(extracted.isValid).toBe(true);
    expect(extracted.extractedWitnessY).toBe(adaptor.adaptorWitnessY);
  });

  it('rejects tampered partial pre-signatures and mismatched adaptor witnesses', () => {
    const tas = new ThresholdAdaptorSignature(2, 3);
    const committee = tas.generateCommittee('swap-committee-02');
    const pubMap = new Map(committee.signers.map((s) => [s.signerId, s.publicVerificationPoint]));
    const adaptor = tas.createAdaptorStatement('secret-02');
    const msg = '0xtx_02';
    const signers = [committee.signers[0], committee.signers[1]];
    const ids = signers.map((s) => s.signerId);
    const nonces = signers.map((s) => tas.generateSignerNonce(s.signerId, msg, 's2'));
    const P = 0xffffffffffffffffffffffffffffc3a7n;
    const aggR = (nonces[0].noncePointR * nonces[1].noncePointR) % P;

    const partials = signers.map((s, idx) =>
      tas.createPartialPreSignature(
        s,
        ids,
        nonces[idx].nonceScalar,
        nonces[idx].noncePointR,
        aggR,
        adaptor.adaptorPointY,
        committee.groupPublicKeyX,
        msg
      )
    );

    expect(() =>
      tas.aggregatePreSignature(
        msg,
        committee.groupPublicKeyX,
        adaptor.adaptorPointY,
        [{ ...partials[0], partialSHat: partials[0].partialSHat + 1n }, partials[1]],
        pubMap
      )
    ).toThrow();

    const preSig = tas.aggregatePreSignature(msg, committee.groupPublicKeyX, adaptor.adaptorPointY, partials, pubMap);
    expect(() => tas.adaptPreSignature(preSig, adaptor.adaptorWitnessY + 1n)).toThrow();
  });
});
