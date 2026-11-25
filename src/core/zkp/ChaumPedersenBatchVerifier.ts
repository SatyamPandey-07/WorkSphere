import { createHash } from 'crypto';

/**
 * Batched Zero-Knowledge Chaum-Pedersen DLEQ Multi-Statement Verifier
 *
 * Implements Chaum-Pedersen Discrete Logarithm Equality (DLEQ) proofs over a
 * safe-prime subgroup (P = 2Q + 1) with two high-throughput zero-knowledge
 * batching modes:
 *   1. Heterogeneous multi-statement randomized batch verification: collapses
 *      2m verification equations into a single randomized multi-exponentiation
 *      check using independent Fiat-Shamir weights (u_i, v_i).
 *   2. Shared-witness cross-base DLEQ compression: proves knowledge of a single
 *      witness scalar x across k independent generator-target pairs (g_i, g_i^x)
 *      in constant O(1) proof size.
 */

const SUBGROUP_ORDER = 0x7fffffffffffffffffffffffffffe1d3n; // Prime Q
const SAFE_PRIME = 0xffffffffffffffffffffffffffffc3a7n; // Safe prime P = 2Q + 1
const SUBGROUP_GEN = 4n; // Order-Q generator g

export interface DLEQStatement {
  readonly statementId: string;
  readonly baseG: bigint;
  readonly baseH: bigint;
  readonly targetY: bigint; // g^x mod P
  readonly targetZ: bigint; // h^x mod P
}

export interface ChaumPedersenProof {
  readonly statement: DLEQStatement;
  readonly commitA1: bigint;
  readonly commitA2: bigint;
  readonly challengeE: bigint;
  readonly responseS: bigint;
}

export interface BatchDLEQVerificationResult {
  readonly isValid: boolean;
  readonly batchSize: number;
  readonly lhsAggregate: bigint;
  readonly rhsAggregate: bigint;
  readonly reason?: string;
}

export interface SharedWitnessPair {
  readonly base: bigint;
  readonly target: bigint;
}

export interface CompressedSharedWitnessProof {
  readonly pairs: readonly SharedWitnessPair[];
  readonly combinedBase: bigint;
  readonly combinedTarget: bigint;
  readonly commitA: bigint;
  readonly challengeE: bigint;
  readonly responseS: bigint;
  readonly transcriptDigest: string;
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

export class ChaumPedersenBatchVerifier {
  public deriveGenerator(label: string): bigint {
    const exp = hashToScalar('CP_BATCH_GEN', [label]);
    return modPow(SUBGROUP_GEN, exp, SAFE_PRIME);
  }

  public createStatement(
    statementId: string,
    baseG: bigint,
    baseH: bigint,
    witnessScalar: bigint
  ): DLEQStatement {
    const x = modQ(witnessScalar);
    if (x === 0n) throw new Error('Witness scalar must be non-zero');
    return {
      statementId,
      baseG,
      baseH,
      targetY: modPow(baseG, x, SAFE_PRIME),
      targetZ: modPow(baseH, x, SAFE_PRIME),
    };
  }

  public proveSingle(
    statement: DLEQStatement,
    witnessScalar: bigint,
    nonceSeed: string
  ): ChaumPedersenProof {
    const x = modQ(witnessScalar);
    const w = hashToScalar('CP_SINGLE_W', [
      statement.statementId,
      statement.targetY.toString(16),
      statement.targetZ.toString(16),
      nonceSeed,
    ]);
    const commitA1 = modPow(statement.baseG, w, SAFE_PRIME);
    const commitA2 = modPow(statement.baseH, w, SAFE_PRIME);
    const challengeE = hashToScalar('CP_SINGLE_E', [
      statement.statementId,
      statement.baseG.toString(16),
      statement.baseH.toString(16),
      statement.targetY.toString(16),
      statement.targetZ.toString(16),
      commitA1.toString(16),
      commitA2.toString(16),
    ]);
    const responseS = modQ(w + modQ(challengeE * x));

    return {
      statement,
      commitA1,
      commitA2,
      challengeE,
      responseS,
    };
  }

  public verifySingle(proof: ChaumPedersenProof): boolean {
    const st = proof.statement;
    if (!isInSubgroup(st.baseG) || !isInSubgroup(st.baseH)) {
      return false;
    }
    const expectedE = hashToScalar('CP_SINGLE_E', [
      st.statementId,
      st.baseG.toString(16),
      st.baseH.toString(16),
      st.targetY.toString(16),
      st.targetZ.toString(16),
      proof.commitA1.toString(16),
      proof.commitA2.toString(16),
    ]);
    if (expectedE !== proof.challengeE) return false;

    const lhs1 = modPow(st.baseG, modQ(proof.responseS), SAFE_PRIME);
    const rhs1 = modP(proof.commitA1 * modPow(st.targetY, expectedE, SAFE_PRIME));
    const lhs2 = modPow(st.baseH, modQ(proof.responseS), SAFE_PRIME);
    const rhs2 = modP(proof.commitA2 * modPow(st.targetZ, expectedE, SAFE_PRIME));
    return lhs1 === rhs1 && lhs2 === rhs2;
  }

  /**
   * Verifies m heterogeneous Chaum-Pedersen DLEQ proofs in a single randomized
   * multi-exponentiation check using Fiat-Shamir batch randomizers (u_i, v_i).
   */
  public verifyBatch(proofs: readonly ChaumPedersenProof[]): BatchDLEQVerificationResult {
    if (proofs.length === 0) {
      return {
        isValid: false,
        batchSize: 0,
        lhsAggregate: 0n,
        rhsAggregate: 0n,
        reason: 'Batch proof list must be non-empty',
      };
    }

    const batchDigestHasher = createHash('sha256');
    batchDigestHasher.update(`CP_BATCH_SEED|${proofs.length}`);

    for (let i = 0; i < proofs.length; i++) {
      const p = proofs[i];
      const st = p.statement;
      if (!isInSubgroup(st.baseG) || !isInSubgroup(st.baseH)) {
        return {
          isValid: false,
          batchSize: proofs.length,
          lhsAggregate: 0n,
          rhsAggregate: 0n,
          reason: `Invalid subgroup generator at batch index ${i}`,
        };
      }
      const expectedE = hashToScalar('CP_SINGLE_E', [
        st.statementId,
        st.baseG.toString(16),
        st.baseH.toString(16),
        st.targetY.toString(16),
        st.targetZ.toString(16),
        p.commitA1.toString(16),
        p.commitA2.toString(16),
      ]);
      if (expectedE !== p.challengeE) {
        return {
          isValid: false,
          batchSize: proofs.length,
          lhsAggregate: 0n,
          rhsAggregate: 0n,
          reason: `Fiat-Shamir challenge mismatch at batch index ${i}`,
        };
      }
      batchDigestHasher.update(
        `|${st.statementId}:${p.commitA1.toString(16)}:${p.commitA2.toString(16)}:${p.responseS.toString(16)}`
      );
    }

    const batchSeed = batchDigestHasher.digest('hex');
    let lhsAggregate = 1n;
    let rhsAggregate = 1n;

    for (let i = 0; i < proofs.length; i++) {
      const p = proofs[i];
      const st = p.statement;
      const u = hashToScalar('CP_BATCH_U', [batchSeed, String(i)]);
      const v = hashToScalar('CP_BATCH_V', [batchSeed, String(i)]);

      const us = modQ(u * modQ(p.responseS));
      const vs = modQ(v * modQ(p.responseS));
      const ue = modQ(u * modQ(p.challengeE));
      const ve = modQ(v * modQ(p.challengeE));

      lhsAggregate = modP(
        lhsAggregate *
          modP(modPow(st.baseG, us, SAFE_PRIME) * modPow(st.baseH, vs, SAFE_PRIME))
      );
      rhsAggregate = modP(
        rhsAggregate *
          modP(
            modP(modPow(p.commitA1, u, SAFE_PRIME) * modPow(st.targetY, ue, SAFE_PRIME)) *
              modP(modPow(p.commitA2, v, SAFE_PRIME) * modPow(st.targetZ, ve, SAFE_PRIME))
          )
      );
    }

    if (lhsAggregate !== rhsAggregate) {
      return {
        isValid: false,
        batchSize: proofs.length,
        lhsAggregate,
        rhsAggregate,
        reason: 'Randomized multi-statement DLEQ batch equation failed',
      };
    }

    return {
      isValid: true,
      batchSize: proofs.length,
      lhsAggregate,
      rhsAggregate,
    };
  }

  /**
   * Compresses a k-base shared-witness DLEQ statement {y_i = g_i^x} into a
   * single constant-size Schnorr proof via randomized base folding.
   */
  public proveSharedWitnessBatch(
    bases: readonly bigint[],
    witnessScalar: bigint,
    nonceSeed: string
  ): CompressedSharedWitnessProof {
    if (bases.length < 2) {
      throw new Error('Shared witness DLEQ requires at least 2 bases');
    }
    const x = modQ(witnessScalar);
    const pairs: SharedWitnessPair[] = bases.map((base) => ({
      base,
      target: modPow(base, x, SAFE_PRIME),
    }));

    const pairDigest = createHash('sha256')
      .update(`CP_SHARED_PAIRS|${pairs.length}|`)
      .update(pairs.map((p) => `${p.base.toString(16)}:${p.target.toString(16)}`).join(','))
      .digest('hex');

    let combinedBase = 1n;
    let combinedTarget = 1n;
    for (let i = 0; i < pairs.length; i++) {
      const weight = hashToScalar('CP_SHARED_ALPHA', [pairDigest, String(i)]);
      combinedBase = modP(combinedBase * modPow(pairs[i].base, weight, SAFE_PRIME));
      combinedTarget = modP(combinedTarget * modPow(pairs[i].target, weight, SAFE_PRIME));
    }

    const w = hashToScalar('CP_SHARED_W', [pairDigest, nonceSeed]);
    const commitA = modPow(combinedBase, w, SAFE_PRIME);
    const challengeE = hashToScalar('CP_SHARED_E', [
      pairDigest,
      combinedBase.toString(16),
      combinedTarget.toString(16),
      commitA.toString(16),
    ]);
    const responseS = modQ(w + modQ(challengeE * x));

    const transcriptDigest = createHash('sha256')
      .update(`CP_SHARED_FINAL|${pairDigest}|${commitA.toString(16)}|${challengeE.toString(16)}|${responseS.toString(16)}`)
      .digest('hex');

    return {
      pairs,
      combinedBase,
      combinedTarget,
      commitA,
      challengeE,
      responseS,
      transcriptDigest,
    };
  }

  public verifySharedWitnessBatch(proof: CompressedSharedWitnessProof): boolean {
    if (proof.pairs.length < 2) return false;
    for (const pair of proof.pairs) {
      if (!isInSubgroup(pair.base)) return false;
    }

    const pairDigest = createHash('sha256')
      .update(`CP_SHARED_PAIRS|${proof.pairs.length}|`)
      .update(proof.pairs.map((p) => `${p.base.toString(16)}:${p.target.toString(16)}`).join(','))
      .digest('hex');

    let expectedBase = 1n;
    let expectedTarget = 1n;
    for (let i = 0; i < proof.pairs.length; i++) {
      const weight = hashToScalar('CP_SHARED_ALPHA', [pairDigest, String(i)]);
      expectedBase = modP(expectedBase * modPow(proof.pairs[i].base, weight, SAFE_PRIME));
      expectedTarget = modP(expectedTarget * modPow(proof.pairs[i].target, weight, SAFE_PRIME));
    }

    if (expectedBase !== proof.combinedBase || expectedTarget !== proof.combinedTarget) {
      return false;
    }

    const expectedE = hashToScalar('CP_SHARED_E', [
      pairDigest,
      expectedBase.toString(16),
      expectedTarget.toString(16),
      proof.commitA.toString(16),
    ]);
    if (expectedE !== proof.challengeE) return false;

    const expectedDigest = createHash('sha256')
      .update(`CP_SHARED_FINAL|${pairDigest}|${proof.commitA.toString(16)}|${expectedE.toString(16)}|${modQ(proof.responseS).toString(16)}`)
      .digest('hex');
    if (expectedDigest !== proof.transcriptDigest) return false;

    const lhs = modPow(expectedBase, modQ(proof.responseS), SAFE_PRIME);
    const rhs = modP(proof.commitA * modPow(expectedTarget, expectedE, SAFE_PRIME));
    return lhs === rhs;
  }
}
