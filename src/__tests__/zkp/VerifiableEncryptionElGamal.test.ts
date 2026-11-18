import { VerifiableEncryptionElGamal } from '../../core/zkp/VerifiableEncryptionElGamal';

describe('VerifiableEncryptionElGamal', () => {
  it('verifiably encrypts a discrete log share and produces an auditable escrow decryption proof', () => {
    const ve = new VerifiableEncryptionElGamal();
    const escrow = ve.generateEscrowKeyPair('escrow-authority-01');
    const shareScalar = 444_555_666_777n;

    const encProof = ve.encryptAndProve(escrow.publicKeyPoint, shareScalar, 'enc-nonce-01');
    const check = ve.verifyEncryption(encProof);

    expect(check.isValid).toBe(true);
    expect(check.commitmentEqValid).toBe(true);
    expect(check.randomnessEqValid).toBe(true);
    expect(check.ciphertextEqValid).toBe(true);

    const audit = ve.decryptWithAuditProof(escrow, encProof.ciphertext, 'audit-01');
    expect(ve.verifyDecryptionAudit(audit)).toBe(true);
    expect(audit.recoveredCommitmentY).toBe(encProof.ciphertext.shareCommitmentY);
  });

  it('rejects tampered ciphertexts, mismatched commitments, and forged audit proofs', () => {
    const ve = new VerifiableEncryptionElGamal();
    const escrow = ve.generateEscrowKeyPair('escrow-authority-02');
    const encProof = ve.encryptAndProve(escrow.publicKeyPoint, 99999n, 'enc-nonce-02');

    expect(
      ve.verifyEncryption({
        ...encProof,
        ciphertext: { ...encProof.ciphertext, c2: encProof.ciphertext.c2 + 1n },
      }).isValid
    ).toBe(false);

    expect(ve.verifyEncryption({ ...encProof, responseZS: encProof.responseZS + 1n }).isValid).toBe(false);

    const audit = ve.decryptWithAuditProof(escrow, encProof.ciphertext, 'audit-02');
    expect(ve.verifyDecryptionAudit({ ...audit, dleqResponse: audit.dleqResponse + 1n })).toBe(false);
  });
});
