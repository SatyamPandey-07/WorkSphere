import { describe, it, expect } from 'vitest';
import { VerifiableThresholdSchnorrMuSig2 } from '../../core/zkp/VerifiableThresholdSchnorrMuSig2';

describe('VerifiableThresholdSchnorrMuSig2', () => {
  const musig = new VerifiableThresholdSchnorrMuSig2();

  it('executes a 2-round MuSig2 ceremony and verifies one constant-size aggregated signature', () => {
    const signers = ['alice', 'bob', 'carol', 'dave'].map((id) => musig.generateSignerKey(id));
    const aggKey = musig.aggregatePublicKeys(signers.map((s) => s.publicKey));

    const msg = 'worksphere-multisig-treasury-tx-2026';
    const nonces = signers.map((s) => musig.generateNoncePair('ms2-1', s.signerId));
    const aggNonce = musig.aggregateNonces('ms2-1', aggKey, msg, nonces);

    const partials = signers.map((s, i) => musig.signPartial(s, nonces[i], aggKey, aggNonce, msg));
    const { signature, faultySigners } = musig.aggregatePartialSignatures(aggKey, aggNonce, msg, partials);

    expect(faultySigners).toEqual([]);
    expect(signature).toBeDefined();
    expect(musig.verifyFinalSignature(signature!)).toBe(true);
    expect(musig.verifyFinalSignature({ ...signature!, message: 'forged-tx' })).toBe(false);
  });

  it('isolates faulty partial signers, batch-verifies signatures, and round-trips serialization', () => {
    const signers = ['s1', 's2', 's3'].map((id) => musig.generateSignerKey(id));
    const aggKey = musig.aggregatePublicKeys(signers.map((s) => s.publicKey));

    const nonces = signers.map((s) => musig.generateNoncePair('ms2-fault', s.signerId));
    const aggNonce = musig.aggregateNonces('ms2-fault', aggKey, 'audit', nonces);
    const partials = signers.map((s, i) => musig.signPartial(s, nonces[i], aggKey, aggNonce, 'audit'));
    const corrupted = [partials[0], { ...partials[1], partialS: partials[1].partialS + 5n }, partials[2]];

    const badAgg = musig.aggregatePartialSignatures(aggKey, aggNonce, 'audit', corrupted);
    expect(badAgg.signature).toBeUndefined();
    expect(badAgg.faultySigners).toEqual(['s2']);

    const cleanAgg = musig.aggregatePartialSignatures(aggKey, aggNonce, 'audit', partials);
    const sig1 = cleanAgg.signature!;
    expect(musig.batchVerifySignatures([sig1])).toBe(true);

    const json = musig.serializeSignature(sig1);
    const restored = musig.deserializeSignature(json);
    expect(restored).toEqual(sig1);
    expect(musig.verifyFinalSignature(restored)).toBe(true);
  });
});
