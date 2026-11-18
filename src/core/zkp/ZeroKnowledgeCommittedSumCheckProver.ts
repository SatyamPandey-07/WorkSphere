import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Committed Multilinear Sum-Check Prover.
 *
 * Implements the Lund-Fortnow-Karloff-Nisan Sum-Check protocol over the Boolean hypercube
 * {0, 1}^v augmented with hiding Pedersen commitments to every round's univariate polynomial:
 *  - Given a v-variate multilinear polynomial f(x_0, ..., x_{v-1}) specified by its 2^v
 *    hypercube evaluations over F_Q, proves that:
 *      H == sum_{b in {0,1}^v} f(b_0, ..., b_{v-1})  (mod Q)
 *  - In each round i = 0..v-1:
 *      Prover commits to the round linear polynomial g_i(X) = a_0 + a_1*X via Pedersen
 *      commitments (C_{i,0}, C_{i,1}), emits a zero-knowledge opening proving
 *      g_i(0) + g_i(1) == claimedTarget_i, receives Fiat-Shamir challenge r_i, and folds the
 *      evaluation table f(..., X_i = r_i, ...) in half!
 *  - Final round verifies g_{v-1}(r_{v-1}) == f(r_0, ..., r_{v-1}) via a committed opening proof!
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

function sha256Hex(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return h.digest('hex');
}

function hashToScalar(...parts: string[]): bigint {
  return modScalar(BigInt('0x' + sha256Hex(...parts).slice(0, 32)));
}

function deriveH(): bigint {
  const raw = (BigInt('0x' + sha256Hex('ZK-COMMITTED-SUMCHECK-H-V1').slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
  const qr = (raw * raw) % SAFE_PRIME_P;
  return qr === 1n || qr === BASE_G ? 9n : qr;
}

export const BASE_H = deriveH();

export interface RoundPolyCommitment {
  round: number;
  commA0: bigint; // commitment to constant term a_0 = g_i(0)
  commA1: bigint; // commitment to slope a_1 = g_i(1) - g_i(0)
  // Proof that g_i(0) + g_i(1) == 2*a_0 + a_1 equals previous round's claimed target
  sumAnnounceR: bigint;
  sumChallenge: bigint;
  sumResponseBlinding: bigint;
  challengeR: bigint;
}

export interface CommittedSumCheckProof {
  numVars: number;
  claimedSum: bigint;
  rounds: RoundPolyCommitment[];
  finalChallengePoint: bigint[];
  finalOracleValue: bigint;
  finalAnnounceR: bigint;
  finalChallenge: bigint;
  finalResponseBlinding: bigint;
  context: string;
}

export class ZeroKnowledgeCommittedSumCheckProver {
  private commit(val: bigint, blinding?: bigint): { commitment: bigint; blinding: bigint } {
    const r = blinding !== undefined ? modScalar(blinding) : randomScalar();
    const commitment = (modPow(BASE_G, modScalar(val), SAFE_PRIME_P) * modPow(BASE_H, r, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return { commitment, blinding: r };
  }

  /**
   * Evaluates the multilinear extension (MLE) of hypercube table `evals` at point `point` in F_Q^v.
   */
  public evaluateMLE(evals: bigint[], point: bigint[]): bigint {
    const expectedSize = 1 << point.length;
    if (evals.length !== expectedSize) {
      throw new RangeError(`Expected ${expectedSize} hypercube evaluations for ${point.length} variables`);
    }
    let layer = evals.map((v) => modScalar(v));
    for (let v = 0; v < point.length; v++) {
      const r = modScalar(point[v]);
      const oneMinusR = modScalar(1n - r);
      const half = layer.length >> 1;
      const next = new Array<bigint>(half);
      for (let i = 0; i < half; i++) {
        next[i] = modScalar(oneMinusR * layer[i] + r * layer[i + half]);
      }
      layer = next;
    }
    return layer[0];
  }

  public proveHypercubeSum(evals: bigint[], context = 'sumcheck-v1'): CommittedSumCheckProof {
    const n = evals.length;
    if (n < 2 || (n & (n - 1)) !== 0) {
      throw new RangeError('Evaluation table length must be a power of 2 >= 2');
    }
    const numVars = Math.round(Math.log2(n));
    let table = evals.map((v) => modScalar(v));

    let claimedSum = 0n;
    for (const v of table) claimedSum = modScalar(claimedSum + v);

    const rounds: RoundPolyCommitment[] = [];
    const challenges: bigint[] = [];

    // Track previous round's committed target:
    // Round 0 target is public `claimedSum` (blinding = 0, commitment = g^{claimedSum}).
    // Round i > 0 target is g_{i-1}(r_{i-1}) whose commitment = commA0 * commA1^{r_{i-1}} and blinding = rA0 + r_{i-1}*rA1!
    let prevTargetComm = modPow(BASE_G, claimedSum, SAFE_PRIME_P);
    let prevTargetBlinding = 0n;

    for (let round = 0; round < numVars; round++) {
      const half = table.length >> 1;
      let sum0 = 0n;
      let sum1 = 0n;
      for (let i = 0; i < half; i++) {
        sum0 = modScalar(sum0 + table[i]);
        sum1 = modScalar(sum1 + table[i + half]);
      }
      // g_i(X) = a0 + a1*X where g_i(0) = sum0, g_i(1) = sum1 => a0 = sum0, a1 = sum1 - sum0
      const a0 = sum0;
      const a1 = modScalar(sum1 - sum0);

      const c0 = this.commit(a0);
      const c1 = this.commit(a1);

      // Verify g_i(0) + g_i(1) == 2*a0 + a1 == prevTarget:
      // commA0^2 * commA1 * prevTargetComm^{-1} = h^{2*r0 + r1 - prevTargetBlinding}
      const deltaR = modScalar(2n * c0.blinding + c1.blinding - prevTargetBlinding);
      const kSum = randomScalar();
      const sumAnnounceR = modPow(BASE_H, kSum, SAFE_PRIME_P);
      const sumChallenge = hashToScalar(
        'SUMCHECK-ROUND-EQ-V1',
        context,
        String(round),
        prevTargetComm.toString(16),
        c0.commitment.toString(16),
        c1.commitment.toString(16),
        sumAnnounceR.toString(16),
      );
      const sumResponseBlinding = modScalar(kSum + sumChallenge * deltaR);

      // Derive Fiat-Shamir folding challenge r_round
      const challengeR = hashToScalar(
        'SUMCHECK-CHALLENGE-R-V1',
        context,
        String(round),
        c0.commitment.toString(16),
        c1.commitment.toString(16),
        sumChallenge.toString(16),
      );
      challenges.push(challengeR);

      rounds.push({
        round,
        commA0: c0.commitment,
        commA1: c1.commitment,
        sumAnnounceR,
        sumChallenge,
        sumResponseBlinding,
        challengeR,
      });

      // Update committed target to g_i(challengeR) = a0 + a1 * challengeR
      prevTargetComm = (c0.commitment * modPow(c1.commitment, challengeR, SAFE_PRIME_P)) % SAFE_PRIME_P;
      prevTargetBlinding = modScalar(c0.blinding + challengeR * c1.blinding);

      // Fold table in half at x_round = challengeR
      const oneMinusR = modScalar(1n - challengeR);
      const nextTable = new Array<bigint>(half);
      for (let i = 0; i < half; i++) {
        nextTable[i] = modScalar(oneMinusR * table[i] + challengeR * table[i + half]);
      }
      table = nextTable;
    }

    const finalOracleValue = table[0];
    // Prove final committed target opens to finalOracleValue: prevTargetComm * g^{-finalOracleValue} = h^{prevTargetBlinding}
    const kFin = randomScalar();
    const finalAnnounceR = modPow(BASE_H, kFin, SAFE_PRIME_P);
    const finalChallenge = hashToScalar(
      'SUMCHECK-FINAL-OPEN-V1',
      context,
      prevTargetComm.toString(16),
      finalOracleValue.toString(16),
      finalAnnounceR.toString(16),
    );
    const finalResponseBlinding = modScalar(kFin + finalChallenge * prevTargetBlinding);

    return {
      numVars,
      claimedSum,
      rounds,
      finalChallengePoint: challenges,
      finalOracleValue,
      finalAnnounceR,
      finalChallenge,
      finalResponseBlinding,
      context,
    };
  }

  public verifyHypercubeSum(proof: CommittedSumCheckProof, evalsOracle?: bigint[]): boolean {
    if (proof.numVars < 1 || proof.rounds.length !== proof.numVars || proof.finalChallengePoint.length !== proof.numVars) {
      return false;
    }

    let prevTargetComm = modPow(BASE_G, modScalar(proof.claimedSum), SAFE_PRIME_P);

    for (let r = 0; r < proof.numVars; r++) {
      const rd = proof.rounds[r];
      if (rd.round !== r) return false;

      const expectedSumC = hashToScalar(
        'SUMCHECK-ROUND-EQ-V1',
        proof.context,
        String(r),
        prevTargetComm.toString(16),
        rd.commA0.toString(16),
        rd.commA1.toString(16),
        rd.sumAnnounceR.toString(16),
      );
      if (expectedSumC !== rd.sumChallenge) return false;

      // Verify g_r(0) + g_r(1) == prevTarget
      const sumComm = (modPow(rd.commA0, 2n, SAFE_PRIME_P) * rd.commA1) % SAFE_PRIME_P;
      const diffTarget = (sumComm * modPow(prevTargetComm, SAFE_PRIME_P - 2n, SAFE_PRIME_P)) % SAFE_PRIME_P;
      const lhs = modPow(BASE_H, rd.sumResponseBlinding, SAFE_PRIME_P);
      const rhs = (rd.sumAnnounceR * modPow(diffTarget, rd.sumChallenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
      if (lhs !== rhs) return false;

      const expectedR = hashToScalar(
        'SUMCHECK-CHALLENGE-R-V1',
        proof.context,
        String(r),
        rd.commA0.toString(16),
        rd.commA1.toString(16),
        rd.sumChallenge.toString(16),
      );
      if (expectedR !== rd.challengeR || expectedR !== proof.finalChallengePoint[r]) return false;

      prevTargetComm = (rd.commA0 * modPow(rd.commA1, rd.challengeR, SAFE_PRIME_P)) % SAFE_PRIME_P;
    }

    // Verify final oracle evaluation check (if verifier holds MLE oracle)
    if (evalsOracle) {
      const expectedVal = this.evaluateMLE(evalsOracle, proof.finalChallengePoint);
      if (expectedVal !== modScalar(proof.finalOracleValue)) return false;
    }

    const expectedFinC = hashToScalar(
      'SUMCHECK-FINAL-OPEN-V1',
      proof.context,
      prevTargetComm.toString(16),
      modScalar(proof.finalOracleValue).toString(16),
      proof.finalAnnounceR.toString(16),
    );
    if (expectedFinC !== proof.finalChallenge) return false;

    const gNegFin = modPow(BASE_G, modScalar(SUBGROUP_Q - modScalar(proof.finalOracleValue)), SAFE_PRIME_P);
    const finTarget = (prevTargetComm * gNegFin) % SAFE_PRIME_P;
    return modPow(BASE_H, proof.finalResponseBlinding, SAFE_PRIME_P) ===
      (proof.finalAnnounceR * modPow(finTarget, proof.finalChallenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  public serializeProof(proof: CommittedSumCheckProof): string {
    return JSON.stringify({
      numVars: proof.numVars,
      claimedSum: proof.claimedSum.toString(),
      roundCount: proof.rounds.length,
      context: proof.context,
    });
  }
}
