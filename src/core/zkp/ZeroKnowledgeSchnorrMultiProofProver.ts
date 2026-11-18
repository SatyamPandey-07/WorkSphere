import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Multi-Base Schnorr Proof & Randomized Batch Fault Isolator.
 *
 * Proves simultaneous knowledge of witness vector (x_1, ..., x_m) in Z_Q such that:
 *   Y = prod_{j=1}^m g_j^{x_j} mod P
 * across arbitrary independent quadratic-residue generators g_1, ..., g_m.
 *
 * Also implements randomized small-exponent batch verification (Schwartz-Zippel folding)
 * that checks N independent multi-base Schnorr proofs in ONE combined group equation,
 * with automatic binary-search divide-and-conquer fault isolation when any proof is forged!
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

function randomScalar(): bigint {
  const bytes = randomBytes(16);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return (v % (SUBGROUP_Q - 2n)) + 1n;
}

function hashToScalar(...parts: string[]): bigint {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return modScalar(BigInt('0x' + h.digest('hex').slice(0, 32)));
}

export interface MultiBaseStatement {
  id: string;
  generators: bigint[];
  targetY: bigint;
  context: string;
}

export interface MultiBaseSchnorrProof {
  statement: MultiBaseStatement;
  announcementR: bigint;
  challenge: bigint;
  responses: bigint[];
}

export interface BatchVerificationReport {
  allValid: boolean;
  totalChecked: number;
  invalidProofIds: string[];
  usedFastBatchPath: boolean;
}

export class ZeroKnowledgeSchnorrMultiProofProver {
  public deriveGenerators(count: number, domain = 'MULTI-SCHNORR-GEN-V1'): bigint[] {
    if (count < 1) throw new RangeError('Generator count must be >= 1');
    const gens: bigint[] = [];
    for (let i = 0; i < count; i++) {
      const hex = createHash('sha256').update(`${domain}:${i}`).digest('hex');
      const raw = (BigInt('0x' + hex.slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
      const qr = (raw * raw) % SAFE_PRIME_P;
      gens.push(qr === 1n ? BASE_G : qr);
    }
    return gens;
  }

  public computeTarget(generators: bigint[], secrets: bigint[]): bigint {
    if (generators.length !== secrets.length || generators.length === 0) {
      throw new Error('Generators and secrets must have matching non-zero length');
    }
    let acc = 1n;
    for (let i = 0; i < generators.length; i++) {
      acc = (acc * modPow(generators[i], modScalar(secrets[i]), SAFE_PRIME_P)) % SAFE_PRIME_P;
    }
    return acc;
  }

  private computeChallenge(stmt: MultiBaseStatement, announcementR: bigint): bigint {
    return hashToScalar(
      'MULTI-BASE-SCHNORR-V1',
      stmt.id,
      stmt.context,
      stmt.targetY.toString(16),
      announcementR.toString(16),
      ...stmt.generators.map((g) => g.toString(16)),
    );
  }

  public prove(
    id: string,
    generators: bigint[],
    secrets: bigint[],
    context = 'default',
  ): MultiBaseSchnorrProof {
    const normalizedSecrets = secrets.map((s) => modScalar(s));
    const targetY = this.computeTarget(generators, normalizedSecrets);
    const statement: MultiBaseStatement = {
      id,
      generators: [...generators],
      targetY,
      context,
    };

    const nonces = generators.map(() => randomScalar());
    const announcementR = this.computeTarget(generators, nonces);
    const challenge = this.computeChallenge(statement, announcementR);
    const responses = nonces.map((k, idx) => modScalar(k + challenge * normalizedSecrets[idx]));

    return { statement, announcementR, challenge, responses };
  }

  public verifySingle(proof: MultiBaseSchnorrProof): boolean {
    const { statement, announcementR, challenge, responses } = proof;
    if (statement.generators.length === 0 || statement.generators.length !== responses.length) {
      return false;
    }
    if (this.computeChallenge(statement, announcementR) !== challenge) return false;

    const lhs = this.computeTarget(statement.generators, responses);
    const rhs = (announcementR * modPow(statement.targetY, challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return lhs === rhs;
  }

  private verifySubsetFast(proofs: MultiBaseSchnorrProof[]): boolean {
    if (proofs.length === 0) return true;
    const baseCount = proofs[0].statement.generators.length;
    const sharedGens = proofs[0].statement.generators;

    // Check structural validity, challenge binding, and shared generator basis
    for (const p of proofs) {
      if (p.statement.generators.length !== baseCount || p.responses.length !== baseCount) return false;
      if (this.computeChallenge(p.statement, p.announcementR) !== p.challenge) return false;
      for (let j = 0; j < baseCount; j++) {
        if (p.statement.generators[j] !== sharedGens[j]) {
          // Heterogeneous generator bases fall back to direct individual check
          return proofs.every((item) => this.verifySingle(item));
        }
      }
    }

    // Randomized linear combination with 64-bit random weights w_i
    const weightedExponents = new Array<bigint>(baseCount).fill(0n);
    let rhsCombined = 1n;

    for (const p of proofs) {
      const wBytes = randomBytes(8);
      let w = 0n;
      for (const b of wBytes) w = (w << 8n) | BigInt(b);
      w = (w % (SUBGROUP_Q - 2n)) + 1n;

      for (let j = 0; j < baseCount; j++) {
        weightedExponents[j] = modScalar(weightedExponents[j] + w * p.responses[j]);
      }
      const termR = modPow(p.announcementR, w, SAFE_PRIME_P);
      const termY = modPow(p.statement.targetY, modScalar(w * p.challenge), SAFE_PRIME_P);
      rhsCombined = (((rhsCombined * termR) % SAFE_PRIME_P) * termY) % SAFE_PRIME_P;
    }

    const lhsCombined = this.computeTarget(sharedGens, weightedExponents);
    return lhsCombined === rhsCombined;
  }

  private isolateInvalid(proofs: MultiBaseSchnorrProof[], invalidOut: string[]): void {
    if (proofs.length === 0) return;
    if (proofs.length === 1) {
      if (!this.verifySingle(proofs[0])) {
        invalidOut.push(proofs[0].statement.id);
      }
      return;
    }
    if (this.verifySubsetFast(proofs)) return;
    const mid = proofs.length >> 1;
    this.isolateInvalid(proofs.slice(0, mid), invalidOut);
    this.isolateInvalid(proofs.slice(mid), invalidOut);
  }

  public verifyBatchWithFaultIsolation(proofs: MultiBaseSchnorrProof[]): BatchVerificationReport {
    if (proofs.length === 0) {
      return { allValid: true, totalChecked: 0, invalidProofIds: [], usedFastBatchPath: true };
    }
    if (this.verifySubsetFast(proofs)) {
      return { allValid: true, totalChecked: proofs.length, invalidProofIds: [], usedFastBatchPath: true };
    }
    const invalidProofIds: string[] = [];
    this.isolateInvalid(proofs, invalidProofIds);
    return {
      allValid: invalidProofIds.length === 0,
      totalChecked: proofs.length,
      invalidProofIds,
      usedFastBatchPath: false,
    };
  }

  public serializeProof(proof: MultiBaseSchnorrProof): string {
    return JSON.stringify({
      id: proof.statement.id,
      generatorCount: proof.statement.generators.length,
      targetY: proof.statement.targetY.toString(16),
      challenge: proof.challenge.toString(16),
      context: proof.statement.context,
    });
  }
}
