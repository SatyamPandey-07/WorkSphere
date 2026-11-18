import { createHash } from 'crypto';

/**
 * Verifiable Zero-Knowledge ElGamal Encryption of Discrete Logarithm Shares
 *
 * Implements PVSS-style verifiable encryption over a safe-prime subgroup
 * (P = 2Q + 1). Proves in zero knowledge via a 3-equation Okamoto-Schnorr
 * Sigma protocol that an ElGamal ciphertext (c1 = g^r, c2 = g^s * pk_E^r)
 * encrypts the exact discrete logarithm committed in Y = g^s under escrow
 * public key pk_E = g^e, without disclosing s or r. Also supports auditable
 * escrow decryption with a Chaum-Pedersen DLEQ correctness proof.
 */

const SUBGROUP_ORDER = 0x7fffffffffffffffffffffffffffe1d3n; // Prime Q
const SAFE_PRIME = 0xffffffffffffffffffffffffffffc3a7n; // Safe prime P = 2Q + 1
const SUBGROUP_GEN = 4n; // Order-Q generator g

export interface EscrowKeyPair {
  readonly witnessScalar: bigint;
  readonly publicKeyPoint: bigint;
}

export interface VerifiableElGamalCiphertext {
  readonly escrowPublicKey: bigint;
  readonly shareCommitmentY: bigint;
  readonly c1: bigint;
  readonly c2: bigint;
}

export interface VerifiableEncryptionProof {
  readonly ciphertext: VerifiableElGamalCiphertext;
  readonly commitAY: bigint;
  readonly commitA1: bigint;
  readonly commitA2: bigint;
  readonly challengeC: bigint;
  readonly responseZS: bigint;
  readonly responseZR: bigint;
  readonly proofDigest: string;
}

export interface AuditableDecryptionProof {
  readonly ciphertext: VerifiableElGamalCiphertext;
  readonly decryptionFactorD: bigint;
  readonly recoveredCommitmentY: bigint;
  readonly dleqA1: bigint;
  readonly dleqA2: bigint;
  readonly dleqChallenge: bigint;
  readonly dleqResponse: bigint;
}

export interface VerifiableEncryptionCheck {
  readonly isValid: boolean;
  readonly commitmentEqValid: boolean;
  readonly randomnessEqValid: boolean;
  readonly ciphertextEqValid: boolean;
  readonly reason?: string;
}

function modQ(x: bigint): bigint {
  const r = x % SUBGROUP_ORDER;
  return r >= 0n ? r : r + SUBGROUP_ORDER;
}

function modP(x: bigint): bigint {
  const r = x % SAFE_PRIME;
  return r >= 0n ? r : r + SAFE_PRIME;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) {
      result = (result * b) % mod;
    }
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function modInverseP(a: bigint): bigint {
  return modPow(a, SAFE_PRIME - 2n, SAFE_PRIME);
}

function hashToScalar(domain: string, parts: readonly string[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const p of parts) {
    h.update('|');
    h.update(p);
  }
  const s = modQ(BigInt('0x' + h.digest('hex')));
  return s === 0n ? 1n : s;
}

function isInSubgroup(pt: bigint): boolean {
  return pt > 1n && pt < SAFE_PRIME && modPow(pt, SUBGROUP_ORDER, SAFE_PRIME) === 1n;
}

export class VerifiableEncryptionElGamal {
  public generateEscrowKeyPair(seed: string): EscrowKeyPair {
    const witnessScalar = hashToScalar('VE_ESCROW_KP', [seed]);
    const publicKeyPoint = modPow(SUBGROUP_GEN, witnessScalar, SAFE_PRIME);
    return { witnessScalar, publicKeyPoint };
  }

  public encryptAndProve(
    escrowPublicKey: bigint,
    shareScalarS: bigint,
    encryptionNonce: string
  ): VerifiableEncryptionProof {
    if (!isInSubgroup(escrowPublicKey)) {
      throw new Error('Escrow public key must be a valid order-Q subgroup element');
    }
    const s = modQ(shareScalarS);
    if (s === 0n) {
      throw new Error('Share scalar must be non-zero mod Q');
    }

    const shareCommitmentY = modPow(SUBGROUP_GEN, s, SAFE_PRIME);
    const r = hashToScalar('VE_ENC_R', [
      escrowPublicKey.toString(16),
      shareCommitmentY.toString(16),
      encryptionNonce,
    ]);
    const c1 = modPow(SUBGROUP_GEN, r, SAFE_PRIME);
    const c2 = modP(shareCommitmentY * modPow(escrowPublicKey, r, SAFE_PRIME));

    const ciphertext: VerifiableElGamalCiphertext = {
      escrowPublicKey,
      shareCommitmentY,
      c1,
      c2,
    };

    const ws = hashToScalar('VE_SIGMA_WS', [encryptionNonce, c1.toString(16), c2.toString(16)]);
    const wr = hashToScalar('VE_SIGMA_WR', [encryptionNonce, c2.toString(16), c1.toString(16)]);

    const commitAY = modPow(SUBGROUP_GEN, ws, SAFE_PRIME);
    const commitA1 = modPow(SUBGROUP_GEN, wr, SAFE_PRIME);
    const commitA2 = modP(
      modPow(SUBGROUP_GEN, ws, SAFE_PRIME) * modPow(escrowPublicKey, wr, SAFE_PRIME)
    );

    const challengeC = hashToScalar('VE_SIGMA_C', [
      escrowPublicKey.toString(16),
      shareCommitmentY.toString(16),
      c1.toString(16),
      c2.toString(16),
      commitAY.toString(16),
      commitA1.toString(16),
      commitA2.toString(16),
    ]);

    const responseZS = modQ(ws + modQ(challengeC * s));
    const responseZR = modQ(wr + modQ(challengeC * r));

    const proofDigest = createHash('sha256')
      .update('VE_ELGAMAL_PROOF|')
      .update(`${escrowPublicKey.toString(16)}|${shareCommitmentY.toString(16)}|${c1.toString(16)}|${c2.toString(16)}|`)
      .update(`${challengeC.toString(16)}|${responseZS.toString(16)}|${responseZR.toString(16)}`)
      .digest('hex');

    return {
      ciphertext,
      commitAY,
      commitA1,
      commitA2,
      challengeC,
      responseZS,
      responseZR,
      proofDigest,
    };
  }

  public verifyEncryption(proof: VerifiableEncryptionProof): VerifiableEncryptionCheck {
    const ct = proof.ciphertext;
    if (!isInSubgroup(ct.escrowPublicKey) || !isInSubgroup(ct.shareCommitmentY)) {
      return {
        isValid: false,
        commitmentEqValid: false,
        randomnessEqValid: false,
        ciphertextEqValid: false,
        reason: 'Invalid subgroup element in ciphertext or commitment',
      };
    }

    const expectedDigest = createHash('sha256')
      .update('VE_ELGAMAL_PROOF|')
      .update(`${ct.escrowPublicKey.toString(16)}|${ct.shareCommitmentY.toString(16)}|${ct.c1.toString(16)}|${ct.c2.toString(16)}|`)
      .update(`${proof.challengeC.toString(16)}|${modQ(proof.responseZS).toString(16)}|${modQ(proof.responseZR).toString(16)}`)
      .digest('hex');
    if (expectedDigest !== proof.proofDigest) {
      return {
        isValid: false,
        commitmentEqValid: false,
        randomnessEqValid: false,
        ciphertextEqValid: false,
        reason: 'Verifiable encryption proof digest mismatch',
      };
    }

    const expectedC = hashToScalar('VE_SIGMA_C', [
      ct.escrowPublicKey.toString(16),
      ct.shareCommitmentY.toString(16),
      ct.c1.toString(16),
      ct.c2.toString(16),
      proof.commitAY.toString(16),
      proof.commitA1.toString(16),
      proof.commitA2.toString(16),
    ]);
    if (expectedC !== proof.challengeC) {
      return {
        isValid: false,
        commitmentEqValid: false,
        randomnessEqValid: false,
        ciphertextEqValid: false,
        reason: 'Fiat-Shamir challenge mismatch',
      };
    }

    const gZS = modPow(SUBGROUP_GEN, modQ(proof.responseZS), SAFE_PRIME);
    const gZR = modPow(SUBGROUP_GEN, modQ(proof.responseZR), SAFE_PRIME);
    const pkZR = modPow(ct.escrowPublicKey, modQ(proof.responseZR), SAFE_PRIME);

    const commitmentEqValid =
      gZS === modP(proof.commitAY * modPow(ct.shareCommitmentY, expectedC, SAFE_PRIME));
    const randomnessEqValid =
      gZR === modP(proof.commitA1 * modPow(ct.c1, expectedC, SAFE_PRIME));
    const ciphertextEqValid =
      modP(gZS * pkZR) === modP(proof.commitA2 * modPow(ct.c2, expectedC, SAFE_PRIME));

    const isValid = commitmentEqValid && randomnessEqValid && ciphertextEqValid;
    return {
      isValid,
      commitmentEqValid,
      randomnessEqValid,
      ciphertextEqValid,
      reason: isValid ? undefined : 'Okamoto-Schnorr verifiable encryption equations failed',
    };
  }

  public decryptWithAuditProof(
    escrowKey: EscrowKeyPair,
    ciphertext: VerifiableElGamalCiphertext,
    auditNonce: string
  ): AuditableDecryptionProof {
    const e = modQ(escrowKey.witnessScalar);
    const decryptionFactorD = modPow(ciphertext.c1, e, SAFE_PRIME);
    const recoveredCommitmentY = modP(ciphertext.c2 * modInverseP(decryptionFactorD));

    const w = hashToScalar('VE_DEC_DLEQ_W', [auditNonce, decryptionFactorD.toString(16)]);
    const dleqA1 = modPow(SUBGROUP_GEN, w, SAFE_PRIME);
    const dleqA2 = modPow(ciphertext.c1, w, SAFE_PRIME);
    const dleqChallenge = hashToScalar('VE_DEC_DLEQ_E', [
      escrowKey.publicKeyPoint.toString(16),
      ciphertext.c1.toString(16),
      decryptionFactorD.toString(16),
      dleqA1.toString(16),
      dleqA2.toString(16),
    ]);
    const dleqResponse = modQ(w + modQ(dleqChallenge * e));

    return {
      ciphertext,
      decryptionFactorD,
      recoveredCommitmentY,
      dleqA1,
      dleqA2,
      dleqChallenge,
      dleqResponse,
    };
  }

  public verifyDecryptionAudit(audit: AuditableDecryptionProof): boolean {
    const ct = audit.ciphertext;
    const expectedC = hashToScalar('VE_DEC_DLEQ_E', [
      ct.escrowPublicKey.toString(16),
      ct.c1.toString(16),
      audit.decryptionFactorD.toString(16),
      audit.dleqA1.toString(16),
      audit.dleqA2.toString(16),
    ]);
    if (expectedC !== audit.dleqChallenge) return false;

    const lhs1 = modPow(SUBGROUP_GEN, modQ(audit.dleqResponse), SAFE_PRIME);
    const rhs1 = modP(audit.dleqA1 * modPow(ct.escrowPublicKey, expectedC, SAFE_PRIME));
    const lhs2 = modPow(ct.c1, modQ(audit.dleqResponse), SAFE_PRIME);
    const rhs2 = modP(audit.dleqA2 * modPow(audit.decryptionFactorD, expectedC, SAFE_PRIME));

    if (lhs1 !== rhs1 || lhs2 !== rhs2) return false;
    const expectedRecovered = modP(ct.c2 * modInverseP(audit.decryptionFactorD));
    return (
      expectedRecovered === audit.recoveredCommitmentY &&
      expectedRecovered === ct.shareCommitmentY
    );
  }
}
