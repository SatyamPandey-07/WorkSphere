import { describe, it, expect } from 'vitest';
import { VerifiableThresholdSchnorrAdaptor } from '../../core/zkp/VerifiableThresholdSchnorrAdaptor';

describe('VerifiableThresholdSchnorrAdaptor', () => {
  const engine = new VerifiableThresholdSchnorrAdaptor();

  it('produces threshold adaptor pre-signatures, completes them, and extracts the exact adaptor secret', () => {
    const setup = engine.setupThresholdKey(3, [1, 2, 3, 4, 5]);
    for (const share of setup.shares) {
      expect(engine.verifyShare(share, setup.feldmanCommitments)).toBe(true);
    }

    const witness = engine.createAdaptorWitness();
    expect(engine.verifyAdaptorWitness(witness.adaptorPoint, witness.dlogProofR, witness.dlogProofS)).toBe(true);

    // Faulty signer detection
    const faultyRun = engine.produceThresholdPreSignature(
      setup,
      [setup.shares[0], setup.shares[2], setup.shares[4]],
      witness.adaptorPoint,
      'atomic-swap:tx-9941',
      [3],
    );
    expect(faultyRun.preSignature).toBeNull();
    expect(faultyRun.faultySigners).toEqual([3]);

    // Honest quorum pre-signature
    const honestRun = engine.produceThresholdPreSignature(
      setup,
      [setup.shares[0], setup.shares[2], setup.shares[4]],
      witness.adaptorPoint,
      'atomic-swap:tx-9941',
    );
    expect(honestRun.faultySigners).toEqual([]);
    expect(honestRun.preSignature).not.toBeNull();
    expect(engine.verifyPreSignature(honestRun.preSignature!)).toBe(true);

    // Tampered pre-signature must fail verification
    expect(engine.verifyPreSignature({ ...honestRun.preSignature!, message: 'tampered' })).toBe(false);

    // Complete into valid standard Schnorr signature
    const completed = engine.completeSignature(honestRun.preSignature!, witness.adaptorSecret);
    expect(engine.verifyCompletedSignature(completed)).toBe(true);
    expect(engine.verifyCompletedSignature({ ...completed, finalS: completed.finalS + 1n })).toBe(false);

    // Public witness extraction recovers exact adaptor secret
    const extracted = engine.extractAdaptorSecret(honestRun.preSignature!, completed);
    expect(extracted).toBe(witness.adaptorSecret);

    const serialized = JSON.parse(engine.serializePreSignature(honestRun.preSignature!)) as { participatingIds: number[] };
    expect(serialized.participatingIds).toEqual([1, 3, 5]);
  });
});
