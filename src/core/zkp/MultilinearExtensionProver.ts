import { createHash } from 'crypto';

/**
 * Zero-Knowledge Multivariate Multilinear Extension (MLE) & LFKN Sumcheck Prover
 *
 * Implements multilinear extension evaluation over the Boolean hypercube {0, 1}^v
 * and the non-interactive Lund-Fortnow-Karloff-Nisan (LFKN) sumcheck protocol for
 * both linear MLE claims sum_{x in {0,1}^v} f(x) = H and degree-2 product claims
 * sum_{x in {0,1}^v} f(x) * g(x) = H over BN254 Fr with O(2^v) dynamic table
 * folding and Fiat-Shamir round transcript binding.
 */

const FIELD_MODULUS =
  0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n; // BN254 Fr
const INV_TWO = (FIELD_MODULUS + 1n) >> 1n; // 2^{-1} mod Fr

export interface SumcheckRoundPolynomial {
  readonly roundIndex: number;
  readonly coeffs: readonly [bigint, bigint, bigint]; // c0 + c1*X + c2*X^2
  readonly evalAt0: bigint;
  readonly evalAt1: bigint;
  readonly evalAt2: bigint;
  readonly challenge: bigint;
  readonly roundCommitment: string;
}

export interface ProductSumcheckProof {
  readonly numVars: number;
  readonly claimedSum: bigint;
  readonly fCommitment: string;
  readonly gCommitment: string;
  readonly rounds: readonly SumcheckRoundPolynomial[];
  readonly challengePoint: readonly bigint[];
  readonly finalFEval: bigint;
  readonly finalGEval: bigint;
  readonly transcriptDigest: string;
}

export interface SumcheckVerificationResult {
  readonly isValid: boolean;
  readonly verifiedRounds: number;
  readonly finalExpectedClaim: bigint;
  readonly finalOracleProduct: bigint;
  readonly reason?: string;
}

function modField(x: bigint): bigint {
  const r = x % FIELD_MODULUS;
  return r >= 0n ? r : r + FIELD_MODULUS;
}

function evalQuadratic(coeffs: readonly [bigint, bigint, bigint], x: bigint): bigint {
  const pt = modField(x);
  return modField(coeffs[0] + modField(pt * modField(coeffs[1] + modField(pt * coeffs[2]))));
}

function commitTable(domain: string, table: readonly bigint[]): string {
  const h = createHash('sha256');
  h.update(domain);
  h.update(`|len=${table.length}`);
  for (const v of table) {
    h.update('|');
    h.update(modField(v).toString(16));
  }
  return h.digest('hex');
}

function hashChallenge(domain: string, parts: readonly string[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const p of parts) {
    h.update('|');
    h.update(p);
  }
  const s = modField(BigInt('0x' + h.digest('hex')));
  return s === 0n ? 1n : s;
}

function digestHex(domain: string, parts: readonly string[]): string {
  const h = createHash('sha256');
  h.update(domain);
  for (const p of parts) {
    h.update('|');
    h.update(p);
  }
  return h.digest('hex');
}

export class MultilinearExtensionProver {
  private readonly numVars: number;
  private readonly hypercubeSize: number;

  constructor(numVars: number) {
    if (!Number.isInteger(numVars) || numVars < 1 || numVars > 16) {
      throw new Error('numVars must be an integer between 1 and 16');
    }
    this.numVars = numVars;
    this.hypercubeSize = 1 << numVars;
  }

  public getNumVars(): number {
    return this.numVars;
  }

  public getHypercubeSize(): number {
    return this.hypercubeSize;
  }

  /**
   * Evaluates the multilinear extension f~(r_0, ..., r_{v-1}) in O(2^v) operations
   * where bit i of hypercube index idx corresponds to coordinate r_i.
   */
  public evaluateMLE(table: readonly bigint[], point: readonly bigint[]): bigint {
    if (table.length !== this.hypercubeSize) {
      throw new Error(`MLE table length must equal 2^${this.numVars} = ${this.hypercubeSize}`);
    }
    if (point.length !== this.numVars) {
      throw new Error(`Evaluation point must have ${this.numVars} coordinates`);
    }

    let current = table.map((v) => modField(v));
    for (let i = 0; i < this.numVars; i++) {
      const ri = modField(point[i]);
      const oneMinusR = modField(1n - ri);
      const half = current.length >> 1;
      const next = new Array<bigint>(half);
      for (let k = 0; k < half; k++) {
        next[k] = modField(modField(oneMinusR * current[2 * k]) + modField(ri * current[2 * k + 1]));
      }
      current = next;
    }
    return current[0];
  }

  public computeProductSum(fTable: readonly bigint[], gTable: readonly bigint[]): bigint {
    if (fTable.length !== this.hypercubeSize || gTable.length !== this.hypercubeSize) {
      throw new Error('Input MLE tables must match configured hypercube size');
    }
    let sum = 0n;
    for (let i = 0; i < this.hypercubeSize; i++) {
      sum = modField(sum + modField(modField(fTable[i]) * modField(gTable[i])));
    }
    return sum;
  }

  public proveLinearSumcheck(fTable: readonly bigint[]): ProductSumcheckProof {
    const ones = new Array<bigint>(this.hypercubeSize).fill(1n);
    return this.proveProductSumcheck(fTable, ones);
  }

  public proveProductSumcheck(
    fTable: readonly bigint[],
    gTable: readonly bigint[]
  ): ProductSumcheckProof {
    if (fTable.length !== this.hypercubeSize || gTable.length !== this.hypercubeSize) {
      throw new Error(`Both MLE tables must have length ${this.hypercubeSize}`);
    }

    let curF = fTable.map((v) => modField(v));
    let curG = gTable.map((v) => modField(v));

    const claimedSum = this.computeProductSum(curF, curG);
    const fCommitment = commitTable('MLE_F', curF);
    const gCommitment = commitTable('MLE_G', curG);

    let transcript = digestHex('SUMCHECK_INIT', [
      String(this.numVars),
      claimedSum.toString(16),
      fCommitment,
      gCommitment,
    ]);

    const rounds: SumcheckRoundPolynomial[] = [];
    const challengePoint: bigint[] = [];

    for (let round = 0; round < this.numVars; round++) {
      const half = curF.length >> 1;
      let s0 = 0n;
      let s1 = 0n;
      let s2 = 0n;

      for (let k = 0; k < half; k++) {
        const f0 = curF[2 * k];
        const f1 = curF[2 * k + 1];
        const g0 = curG[2 * k];
        const g1 = curG[2 * k + 1];

        s0 = modField(s0 + modField(f0 * g0));
        s1 = modField(s1 + modField(f1 * g1));

        const f2 = modField(modField(2n * f1) - f0);
        const g2 = modField(modField(2n * g1) - g0);
        s2 = modField(s2 + modField(f2 * g2));
      }

      // Interpolate unique degree-2 polynomial p(X) = c0 + c1*X + c2*X^2
      const c0 = s0;
      const c2 = modField(modField(s2 - modField(2n * s1) + s0) * INV_TWO);
      const c1 = modField(s1 - s0 - c2);
      const coeffs: [bigint, bigint, bigint] = [c0, c1, c2];

      const roundCommitment = digestHex('SUMCHECK_ROUND_POLY', [
        String(round),
        c0.toString(16),
        c1.toString(16),
        c2.toString(16),
      ]);

      const challenge = hashChallenge('SUMCHECK_CHALLENGE', [
        transcript,
        roundCommitment,
        String(round),
      ]);

      transcript = digestHex('SUMCHECK_STEP', [
        transcript,
        roundCommitment,
        challenge.toString(16),
      ]);

      rounds.push({
        roundIndex: round,
        coeffs,
        evalAt0: s0,
        evalAt1: s1,
        evalAt2: s2,
        challenge,
        roundCommitment,
      });
      challengePoint.push(challenge);

      // Fold tables along challenge r_i
      const oneMinusR = modField(1n - challenge);
      const nextF = new Array<bigint>(half);
      const nextG = new Array<bigint>(half);
      for (let k = 0; k < half; k++) {
        nextF[k] = modField(modField(oneMinusR * curF[2 * k]) + modField(challenge * curF[2 * k + 1]));
        nextG[k] = modField(modField(oneMinusR * curG[2 * k]) + modField(challenge * curG[2 * k + 1]));
      }
      curF = nextF;
      curG = nextG;
    }

    const finalFEval = curF[0];
    const finalGEval = curG[0];
    const transcriptDigest = digestHex('SUMCHECK_FINAL', [
      transcript,
      finalFEval.toString(16),
      finalGEval.toString(16),
    ]);

    return {
      numVars: this.numVars,
      claimedSum,
      fCommitment,
      gCommitment,
      rounds,
      challengePoint,
      finalFEval,
      finalGEval,
      transcriptDigest,
    };
  }

  public verifyProductSumcheck(
    fTable: readonly bigint[],
    gTable: readonly bigint[],
    proof: ProductSumcheckProof
  ): SumcheckVerificationResult {
    if (
      proof.numVars !== this.numVars ||
      proof.rounds.length !== this.numVars ||
      proof.challengePoint.length !== this.numVars
    ) {
      return {
        isValid: false,
        verifiedRounds: 0,
        finalExpectedClaim: 0n,
        finalOracleProduct: 0n,
        reason: 'Sumcheck dimension or round count mismatch',
      };
    }

    if (
      commitTable('MLE_F', fTable) !== proof.fCommitment ||
      commitTable('MLE_G', gTable) !== proof.gCommitment
    ) {
      return {
        isValid: false,
        verifiedRounds: 0,
        finalExpectedClaim: 0n,
        finalOracleProduct: 0n,
        reason: 'MLE table commitment mismatch',
      };
    }

    let transcript = digestHex('SUMCHECK_INIT', [
      String(this.numVars),
      modField(proof.claimedSum).toString(16),
      proof.fCommitment,
      proof.gCommitment,
    ]);

    let expectedClaim = modField(proof.claimedSum);

    for (let i = 0; i < this.numVars; i++) {
      const r = proof.rounds[i];
      if (r.roundIndex !== i) {
        return {
          isValid: false,
          verifiedRounds: i,
          finalExpectedClaim: expectedClaim,
          finalOracleProduct: 0n,
          reason: `Round index mismatch at ${i}`,
        };
      }

      const expectedCommit = digestHex('SUMCHECK_ROUND_POLY', [
        String(i),
        modField(r.coeffs[0]).toString(16),
        modField(r.coeffs[1]).toString(16),
        modField(r.coeffs[2]).toString(16),
      ]);
      if (expectedCommit !== r.roundCommitment) {
        return {
          isValid: false,
          verifiedRounds: i,
          finalExpectedClaim: expectedClaim,
          finalOracleProduct: 0n,
          reason: `Round ${i} polynomial commitment mismatch`,
        };
      }

      const p0 = evalQuadratic(r.coeffs, 0n);
      const p1 = evalQuadratic(r.coeffs, 1n);
      const p2 = evalQuadratic(r.coeffs, 2n);
      if (p0 !== r.evalAt0 || p1 !== r.evalAt1 || p2 !== r.evalAt2) {
        return {
          isValid: false,
          verifiedRounds: i,
          finalExpectedClaim: expectedClaim,
          finalOracleProduct: 0n,
          reason: `Round ${i} polynomial evaluation inconsistency`,
        };
      }

      if (modField(p0 + p1) !== expectedClaim) {
        return {
          isValid: false,
          verifiedRounds: i,
          finalExpectedClaim: expectedClaim,
          finalOracleProduct: 0n,
          reason: `Sumcheck consistency p_${i}(0) + p_${i}(1) != claim_${i} failed`,
        };
      }

      const expectedChallenge = hashChallenge('SUMCHECK_CHALLENGE', [
        transcript,
        r.roundCommitment,
        String(i),
      ]);
      if (expectedChallenge !== r.challenge || expectedChallenge !== proof.challengePoint[i]) {
        return {
          isValid: false,
          verifiedRounds: i,
          finalExpectedClaim: expectedClaim,
          finalOracleProduct: 0n,
          reason: `Fiat-Shamir challenge mismatch at round ${i}`,
        };
      }

      transcript = digestHex('SUMCHECK_STEP', [
        transcript,
        r.roundCommitment,
        expectedChallenge.toString(16),
      ]);

      expectedClaim = evalQuadratic(r.coeffs, expectedChallenge);
    }

    const oracleF = this.evaluateMLE(fTable, proof.challengePoint);
    const oracleG = this.evaluateMLE(gTable, proof.challengePoint);
    const finalOracleProduct = modField(oracleF * oracleG);

    if (oracleF !== proof.finalFEval || oracleG !== proof.finalGEval) {
      return {
        isValid: false,
        verifiedRounds: this.numVars,
        finalExpectedClaim: expectedClaim,
        finalOracleProduct,
        reason: 'Final MLE oracle evaluations do not match proof claims',
      };
    }

    if (expectedClaim !== finalOracleProduct) {
      return {
        isValid: false,
        verifiedRounds: this.numVars,
        finalExpectedClaim: expectedClaim,
        finalOracleProduct,
        reason: 'Final sumcheck claim does not equal f~(r) * g~(r)',
      };
    }

    const expectedFinalDigest = digestHex('SUMCHECK_FINAL', [
      transcript,
      oracleF.toString(16),
      oracleG.toString(16),
    ]);
    if (expectedFinalDigest !== proof.transcriptDigest) {
      return {
        isValid: false,
        verifiedRounds: this.numVars,
        finalExpectedClaim: expectedClaim,
        finalOracleProduct,
        reason: 'Final transcript digest mismatch',
      };
    }

    return {
      isValid: true,
      verifiedRounds: this.numVars,
      finalExpectedClaim: expectedClaim,
      finalOracleProduct,
    };
  }
}
