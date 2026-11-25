import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Threshold ElGamal Batch Decryption Audit Prover.
 *
 * Implements auditable (t, n) threshold decryption across a BATCH of N ciphertexts
 * using randomized Schwartz-Zippel batch Chaum-Pedersen DLEQ proofs:
 *  - Instead of producing N separate DLEQ proofs per guardian, each guardian computes a
 *    SINGLE constant-size batch DLEQ proof certifying that ALL N partial decryptions
 *    D_{j,i} = c1_i^{s_j} were honestly computed using guardian j's committed key Y_j = g^{s_j}!
 *  - Verifier folds c1_i and D_{j,i} with Fiat-Shamir random weights w_i = alpha^i, verifying
 *    ALL N decryptions in ONE Chaum-Pedersen check per guardian!
 *  - Automatically isolates any dishonest guardian and reconstructs every plaintext via
 *    Lagrange interpolation across the honest t-of-n quorum!
 */

export const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
export const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
export const BASE_G = 4n;

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

function modScalar(v: bigint): bigint {
  return ((v % SUBGROUP_Q) + SUBGROUP_Q) % SUBGROUP_Q;
}

function modInv(a: bigint, m: bigint): bigint {
  let t = 0n;
  let newT = 1n;
  let r = m;
  let newR = ((a % m) + m) % m;
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  if (r > 1n) throw new Error('Not invertible');
  return t < 0n ? t + m : t;
}

function randomScalar(): bigint {
  const bytes = randomBytes(16);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return (v % (SUBGROUP_Q - 2n)) + 1n;
}

function sha256Hex(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return h.digest('hex');
}

function hashToScalar(...parts: string[]): bigint {
  const v = modScalar(BigInt('0x' + sha256Hex(...parts).slice(0, 32)));
  return v === 0n ? 1n : v;
}

export interface AuditCiphertext {
  id: string;
  c1: bigint;
  c2: bigint;
}

export interface DecryptionGuardian {
  id: number;
  secretShare: bigint;
  publicShare: bigint;
}

export interface ThresholdAuditCommittee {
  committeeId: string;
  threshold: number;
  groupPublicKey: bigint;
  guardians: DecryptionGuardian[];
}

export interface BatchedGuardianDecryptionProof {
  guardianId: number;
  batchDigest: string;
  partials: bigint[]; // D_{j,i} = c1_i^{s_j}
  foldingAlpha: bigint;
  dleqA: bigint;
  dleqB: bigint;
  challenge: bigint;
  response: bigint;
}

export interface BatchDecryptionAuditResult {
  committeeId: string;
  success: boolean;
  decryptedValues: Array<{ id: string; value: bigint }>;
  honestGuardianIds: number[];
  faultyGuardianIds: number[];
  auditTranscriptHash: string;
}

export class VerifiableThresholdDecryptionAudit {
  public createCommittee(committeeId: string, threshold: number, guardianIds: number[]): ThresholdAuditCommittee {
    if (threshold < 2 || threshold > guardianIds.length) {
      throw new RangeError('Threshold must be in [2, guardianIds.length]');
    }
    const coeffs = Array.from({ length: threshold }, () => randomScalar());
    const groupPublicKey = modPow(BASE_G, coeffs[0], SAFE_PRIME_P);
    const guardians: DecryptionGuardian[] = guardianIds.map((id) => {
      const x = BigInt(id);
      let s = 0n;
      let xp = 1n;
      for (const c of coeffs) {
        s = modScalar(s + c * xp);
        xp = modScalar(xp * x);
      }
      return { id, secretShare: s, publicShare: modPow(BASE_G, s, SAFE_PRIME_P) };
    });
    return { committeeId, threshold, groupPublicKey, guardians };
  }

  public encrypt(groupPublicKey: bigint, id: string, value: bigint): AuditCiphertext {
    if (value < 0n) throw new RangeError('Value must be non-negative');
    const r = randomScalar();
    return {
      id,
      c1: modPow(BASE_G, r, SAFE_PRIME_P),
      c2: (modPow(groupPublicKey, r, SAFE_PRIME_P) * modPow(BASE_G, modScalar(value), SAFE_PRIME_P)) % SAFE_PRIME_P,
    };
  }

  public computeBatchDigest(committeeId: string, cts: AuditCiphertext[]): string {
    return sha256Hex('DEC-BATCH-V1', committeeId, ...cts.map((c) => `${c.id}:${c.c1.toString(16)}:${c.c2.toString(16)}`));
  }

  private foldPair(c1List: bigint[], partials: bigint[], alpha: bigint): { foldedC1: bigint; foldedD: bigint } {
    let foldedC1 = 1n;
    let foldedD = 1n;
    let aPow = 1n;
    for (let i = 0; i < c1List.length; i++) {
      foldedC1 = (foldedC1 * modPow(c1List[i], aPow, SAFE_PRIME_P)) % SAFE_PRIME_P;
      foldedD = (foldedD * modPow(partials[i], aPow, SAFE_PRIME_P)) % SAFE_PRIME_P;
      aPow = modScalar(aPow * alpha);
    }
    return { foldedC1, foldedD };
  }

  public produceGuardianBatchDecryption(
    committee: ThresholdAuditCommittee,
    guardian: DecryptionGuardian,
    cts: AuditCiphertext[],
    corruptIndex?: number,
  ): BatchedGuardianDecryptionProof {
    if (cts.length === 0) throw new Error('Ciphertext batch cannot be empty');
    const batchDigest = this.computeBatchDigest(committee.committeeId, cts);
    const partials = cts.map((ct, idx) => {
      const d = modPow(ct.c1, guardian.secretShare, SAFE_PRIME_P);
      return corruptIndex === idx ? (d * BASE_G) % SAFE_PRIME_P : d;
    });

    const foldingAlpha = hashToScalar(
      'DEC-FOLD-ALPHA-V1',
      committee.committeeId,
      String(guardian.id),
      batchDigest,
      ...partials.map((p) => p.toString(16)),
    );
    const { foldedC1, foldedD } = this.foldPair(cts.map((c) => c.c1), partials, foldingAlpha);

    const k = randomScalar();
    const dleqA = modPow(BASE_G, k, SAFE_PRIME_P);
    const dleqB = modPow(foldedC1, k, SAFE_PRIME_P);
    const challenge = hashToScalar(
      'DEC-BATCH-DLEQ-V1',
      batchDigest,
      String(guardian.id),
      guardian.publicShare.toString(16),
      foldedC1.toString(16),
      foldedD.toString(16),
      dleqA.toString(16),
      dleqB.toString(16),
    );
    const response = modScalar(k + challenge * guardian.secretShare);

    return {
      guardianId: guardian.id,
      batchDigest,
      partials,
      foldingAlpha,
      dleqA,
      dleqB,
      challenge,
      response,
    };
  }

  public verifyGuardianBatchDecryption(
    committee: ThresholdAuditCommittee,
    cts: AuditCiphertext[],
    proof: BatchedGuardianDecryptionProof,
  ): boolean {
    const guardian = committee.guardians.find((g) => g.id === proof.guardianId);
    if (!guardian || proof.partials.length !== cts.length) return false;
    const batchDigest = this.computeBatchDigest(committee.committeeId, cts);
    if (batchDigest !== proof.batchDigest) return false;

    const expectedAlpha = hashToScalar(
      'DEC-FOLD-ALPHA-V1',
      committee.committeeId,
      String(proof.guardianId),
      batchDigest,
      ...proof.partials.map((p) => p.toString(16)),
    );
    if (expectedAlpha !== proof.foldingAlpha) return false;

    const { foldedC1, foldedD } = this.foldPair(cts.map((c) => c.c1), proof.partials, proof.foldingAlpha);
    const expectedC = hashToScalar(
      'DEC-BATCH-DLEQ-V1',
      batchDigest,
      String(proof.guardianId),
      guardian.publicShare.toString(16),
      foldedC1.toString(16),
      foldedD.toString(16),
      proof.dleqA.toString(16),
      proof.dleqB.toString(16),
    );
    if (expectedC !== proof.challenge) return false;

    const eq1 = modPow(BASE_G, proof.response, SAFE_PRIME_P) ===
      (proof.dleqA * modPow(guardian.publicShare, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const eq2 = modPow(foldedC1, proof.response, SAFE_PRIME_P) ===
      (proof.dleqB * modPow(foldedD, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return eq1 && eq2;
  }

  private lagrangeCoeff(id: number, activeIds: number[]): bigint {
    const xi = BigInt(id);
    let num = 1n;
    let den = 1n;
    for (const other of activeIds) {
      if (other === id) continue;
      const xj = BigInt(other);
      num = modScalar(num * modScalar(SUBGROUP_Q - xj));
      den = modScalar(den * modScalar(xi - xj));
    }
    return modScalar(num * modInv(den, SUBGROUP_Q));
  }

  public combineAndAuditBatch(
    committee: ThresholdAuditCommittee,
    cts: AuditCiphertext[],
    submissions: BatchedGuardianDecryptionProof[],
    maxSearchValue = 2000n,
  ): BatchDecryptionAuditResult {
    const seen = new Set<number>();
    const honest: BatchedGuardianDecryptionProof[] = [];
    const faultyGuardianIds: number[] = [];

    for (const sub of submissions) {
      if (seen.has(sub.guardianId) || !this.verifyGuardianBatchDecryption(committee, cts, sub)) {
        faultyGuardianIds.push(sub.guardianId);
      } else {
        seen.add(sub.guardianId);
        honest.push(sub);
      }
    }

    const batchDigest = this.computeBatchDigest(committee.committeeId, cts);
    if (honest.length < committee.threshold) {
      return {
        committeeId: committee.committeeId,
        success: false,
        decryptedValues: [],
        honestGuardianIds: honest.map((h) => h.guardianId),
        faultyGuardianIds,
        auditTranscriptHash: sha256Hex('DEC-AUDIT-FAIL', batchDigest, ...faultyGuardianIds.map(String)),
      };
    }

    const quorum = honest.slice(0, committee.threshold);
    const activeIds = quorum.map((q) => q.guardianId);
    const lambdas = activeIds.map((id) => this.lagrangeCoeff(id, activeIds));

    const decryptedValues: Array<{ id: string; value: bigint }> = [];
    for (let i = 0; i < cts.length; i++) {
      let combinedD = 1n;
      for (let qIdx = 0; qIdx < quorum.length; qIdx++) {
        combinedD = (combinedD * modPow(quorum[qIdx].partials[i], lambdas[qIdx], SAFE_PRIME_P)) % SAFE_PRIME_P;
      }
      const gM = (cts[i].c2 * modPow(combinedD, SAFE_PRIME_P - 2n, SAFE_PRIME_P)) % SAFE_PRIME_P;
      let resolved: bigint | null = null;
      let cur = 1n;
      for (let m = 0n; m <= maxSearchValue; m++) {
        if (cur === gM) {
          resolved = m;
          break;
        }
        cur = (cur * BASE_G) % SAFE_PRIME_P;
      }
      if (resolved === null) {
        return {
          committeeId: committee.committeeId,
          success: false,
          decryptedValues: [],
          honestGuardianIds: activeIds,
          faultyGuardianIds,
          auditTranscriptHash: sha256Hex('DEC-AUDIT-DLOG-FAIL', batchDigest, cts[i].id),
        };
      }
      decryptedValues.push({ id: cts[i].id, value: resolved });
    }

    const auditTranscriptHash = sha256Hex(
      'DEC-AUDIT-OK-V1',
      committee.committeeId,
      batchDigest,
      ...activeIds.map(String),
      ...decryptedValues.map((d) => `${d.id}=${d.value.toString()}`),
    );

    return {
      committeeId: committee.committeeId,
      success: true,
      decryptedValues,
      honestGuardianIds: activeIds,
      faultyGuardianIds,
      auditTranscriptHash,
    };
  }

  public serializeAuditResult(res: BatchDecryptionAuditResult): string {
    return JSON.stringify({
      committeeId: res.committeeId,
      success: res.success,
      decryptedCount: res.decryptedValues.length,
      honestGuardianIds: res.honestGuardianIds,
      faultyGuardianIds: res.faultyGuardianIds,
      auditTranscriptHash: res.auditTranscriptHash,
    });
  }
}
