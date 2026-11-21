import { VerifiableTimedSignature } from '../../core/zkp/VerifiableTimedSignature';

describe('VerifiableTimedSignature', () => {
  it('verifies timed signature pre-extraction and extracts valid Schnorr signature after T squarings', () => {
    const vts = new VerifiableTimedSignature();
    const signer = vts.generateKeyPair('escrow-signer-01');
    const msg = '0xatomic_swap_release_42';

    const capsule = vts.createTimedSignature(signer, msg, 128, 'session-vts-01');
    const preCheck = vts.verifyTimedSignature(capsule);
    expect(preCheck.isValid).toBe(true);
    expect(preCheck.equationMatches).toBe(true);
    expect(preCheck.maskProofValid).toBe(true);

    const extracted = vts.extractSignature(capsule);
    expect(extracted.isValid).toBe(true);
    expect(extracted.signature).not.toBeNull();
    expect(vts.verifySchnorr(signer.publicPoint, extracted.signature!)).toBe(true);
  });

  it('rejects tampered timed ciphertexts, forged mask proofs, and wrong message digests', () => {
    const vts = new VerifiableTimedSignature();
    const signer = vts.generateKeyPair('escrow-signer-02');
    const capsule = vts.createTimedSignature(signer, '0xtx_original', 64, 'session-vts-02');

    expect(vts.verifyTimedSignature({ ...capsule, maskedCipherS: capsule.maskedCipherS + 1n }).isValid).toBe(false);
    expect(vts.verifyTimedSignature({ ...capsule, messageDigest: '0xtx_tampered' }).isValid).toBe(false);
    expect(
      vts.verifyTimedSignature({
        ...capsule,
        maskProof: { ...capsule.maskProof, responseZ: capsule.maskProof.responseZ + 1n },
      }).isValid
    ).toBe(false);
  });
});
