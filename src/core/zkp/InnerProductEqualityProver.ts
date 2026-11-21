import { createHash } from 'crypto';

/**
 * Zero-Knowledge Bulletproofs Logarithmic Inner-Product Folding Argument
 *
 * Implements the recursive halving Inner-Product Argument (Bootle et al. 2016 /
 * Bunz et al., Bulletproofs 2018) over a safe-prime subgroup (P = 2Q + 1).
 * Reduces an inner-product relation P = g^a * h^b * u^{<a, b>} for vectors of
 * length n = 2^k to O(log n) cross-term commitments (L_j, R_j) and two final
 * scalars (a_final, b_final).
 */

const SUBGROUP_ORDER = 0x7fffffffffffffffffffffffffffe1d3n; // Prime Q
const SAFE_PRIME = 0xffffffffffffffffffffffffffffc3a7n; // Safe prime P = 2Q + 1
const SUBGROUP_GEN = 4n; // Order-Q quadratic residue generator

export interface IPAFoldingRound {
  readonly roundIndex: number;
  readonly leftCommitL: bigint;
  readonly rightCommitR: bigint;
  readonly challengeX: bigint;
}

export interface InnerProductProof {
  readonly vectorLength: number;
  readonly initialCommitmentP: bigint;
  readonly claimedInnerProduct: bigint;
  readonly rounds: readonly IPAFoldingRound[];
  readonly finalScalarA: bigint;
  readonly finalScalarB: bigint;
  readonly transcriptDigest: string;
}

export interface IPAVerificationResult {
  readonly isValid: boolean;
  readonly verifiedRounds: number;
  readonly foldedCommitment: bigint;
  readonly recomputedFinalPoint: bigint;
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

function modInverseQ(a: bigint): bigint {
  const val = modQ(a);
  if (val === 0n) throw new Error('Cannot invert zero mod Q');
  return modPow(val, SUBGROUP_ORDER - 2n, SUBGROUP_ORDER);
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

function hashHex(domain: string, parts: readonly string[]): string {
  const h = createHash('sha256');
  h.update(domain);
  for (const p of parts) {
    h.update('|');
    h.update(p);
  }
  return h.digest('hex');
}

function innerProduct(a: readonly bigint[], b: readonly bigint[]): bigint {
  let acc = 0n;
  for (let i = 0; i < a.length; i++) {
    acc = modQ(acc + modQ(modQ(a[i]) * modQ(b[i])));
  }
  return acc;
}

function multiExp(bases: readonly bigint[], exps: readonly bigint[]): bigint {
  let acc = 1n;
  for (let i = 0; i < bases.length; i++) {
    const e = modQ(exps[i]);
    if (e !== 0n) {
      acc = modP(acc * modPow(bases[i], e, SAFE_PRIME));
    }
  }
  return acc;
}

export class InnerProductEqualityProver {
  private readonly vectorLength: number;
  private readonly gensG: readonly bigint[];
  private readonly gensH: readonly bigint[];
  private readonly genU: bigint;

  constructor(vectorLength: number, domainSeed = 'WORKSPHERE_BP_IPA_V1') {
    if (
      !Number.isInteger(vectorLength) ||
      vectorLength < 2 ||
      (vectorLength & (vectorLength - 1)) !== 0 ||
      vectorLength > 256
    ) {
      throw new Error('vectorLength must be a power of 2 between 2 and 256');
    }
    this.vectorLength = vectorLength;
    const g: bigint[] = [];
    const h: bigint[] = [];
    for (let i = 0; i < vectorLength; i++) {
      g.push(modPow(SUBGROUP_GEN, hashToScalar('IPA_G', [domainSeed, String(i)]), SAFE_PRIME));
      h.push(modPow(SUBGROUP_GEN, hashToScalar('IPA_H', [domainSeed, String(i)]), SAFE_PRIME));
    }
    this.gensG = g;
    this.gensH = h;
    this.genU = modPow(SUBGROUP_GEN, hashToScalar('IPA_U', [domainSeed]), SAFE_PRIME);
  }

  public getVectorLength(): number {
    return this.vectorLength;
  }

  public commitVectors(
    vecA: readonly bigint[],
    vecB: readonly bigint[]
  ): { commitmentP: bigint; innerProductValue: bigint } {
    if (vecA.length !== this.vectorLength || vecB.length !== this.vectorLength) {
      throw new Error(`Input vectors must have length ${this.vectorLength}`);
    }
    const a = vecA.map((v) => modQ(v));
    const b = vecB.map((v) => modQ(v));
    const c = innerProduct(a, b);
    const commitmentP = modP(
      modP(multiExp(this.gensG, a) * multiExp(this.gensH, b)) *
        modPow(this.genU, c, SAFE_PRIME)
    );
    return { commitmentP, innerProductValue: c };
  }

  public prove(vecA: readonly bigint[], vecB: readonly bigint[]): InnerProductProof {
    if (vecA.length !== this.vectorLength || vecB.length !== this.vectorLength) {
      throw new Error(`Input vectors must have length ${this.vectorLength}`);
    }

    let a = vecA.map((v) => modQ(v));
    let b = vecB.map((v) => modQ(v));
    let g = [...this.gensG];
    let h = [...this.gensH];

    const { commitmentP, innerProductValue } = this.commitVectors(a, b);
    let transcript = hashHex('IPA_INIT', [
      String(this.vectorLength),
      commitmentP.toString(16),
      innerProductValue.toString(16),
    ]);

    const rounds: IPAFoldingRound[] = [];
    let roundIndex = 0;

    while (a.length > 1) {
      const m = a.length >> 1;
      const aL = a.slice(0, m);
      const aR = a.slice(m);
      const bL = b.slice(0, m);
      const bR = b.slice(m);
      const gL = g.slice(0, m);
      const gR = g.slice(m);
      const hL = h.slice(0, m);
      const hR = h.slice(m);

      const cL = innerProduct(aL, bR);
      const cR = innerProduct(aR, bL);

      const leftCommitL = modP(
        modP(multiExp(gR, aL) * multiExp(hL, bR)) * modPow(this.genU, cL, SAFE_PRIME)
      );
      const rightCommitR = modP(
        modP(multiExp(gL, aR) * multiExp(hR, bL)) * modPow(this.genU, cR, SAFE_PRIME)
      );

      const challengeX = hashToScalar('IPA_ROUND_X', [
        transcript,
        String(roundIndex),
        leftCommitL.toString(16),
        rightCommitR.toString(16),
      ]);
      const xInv = modInverseQ(challengeX);

      transcript = hashHex('IPA_STEP', [
        transcript,
        leftCommitL.toString(16),
        rightCommitR.toString(16),
        challengeX.toString(16),
      ]);

      rounds.push({ roundIndex, leftCommitL, rightCommitR, challengeX });

      const nextA = new Array<bigint>(m);
      const nextB = new Array<bigint>(m);
      const nextG = new Array<bigint>(m);
      const nextH = new Array<bigint>(m);

      for (let i = 0; i < m; i++) {
        nextA[i] = modQ(modQ(challengeX * aL[i]) + modQ(xInv * aR[i]));
        nextB[i] = modQ(modQ(xInv * bL[i]) + modQ(challengeX * bR[i]));
        nextG[i] = modP(
          modPow(gL[i], xInv, SAFE_PRIME) * modPow(gR[i], challengeX, SAFE_PRIME)
        );
        nextH[i] = modP(
          modPow(hL[i], challengeX, SAFE_PRIME) * modPow(hR[i], xInv, SAFE_PRIME)
        );
      }

      a = nextA;
      b = nextB;
      g = nextG;
      h = nextH;
      roundIndex++;
    }

    const finalScalarA = a[0];
    const finalScalarB = b[0];
    const transcriptDigest = hashHex('IPA_FINAL', [
      transcript,
      finalScalarA.toString(16),
      finalScalarB.toString(16),
    ]);

    return {
      vectorLength: this.vectorLength,
      initialCommitmentP: commitmentP,
      claimedInnerProduct: innerProductValue,
      rounds,
      finalScalarA,
      finalScalarB,
      transcriptDigest,
    };
  }

  public verify(proof: InnerProductProof): IPAVerificationResult {
    const expectedRounds = Math.round(Math.log2(this.vectorLength));
    if (proof.vectorLength !== this.vectorLength || proof.rounds.length !== expectedRounds) {
      return {
        isValid: false,
        verifiedRounds: 0,
        foldedCommitment: 0n,
        recomputedFinalPoint: 0n,
        reason: 'Proof vector length or folding round count mismatch',
      };
    }

    let transcript = hashHex('IPA_INIT', [
      String(this.vectorLength),
      proof.initialCommitmentP.toString(16),
      modQ(proof.claimedInnerProduct).toString(16),
    ]);

    let foldedCommitment = proof.initialCommitmentP;
    let g = [...this.gensG];
    let h = [...this.gensH];

    for (let i = 0; i < expectedRounds; i++) {
      const r = proof.rounds[i];
      if (r.roundIndex !== i) {
        return {
          isValid: false,
          verifiedRounds: i,
          foldedCommitment,
          recomputedFinalPoint: 0n,
          reason: `Round index mismatch at ${i}`,
        };
      }

      const expectedX = hashToScalar('IPA_ROUND_X', [
        transcript,
        String(i),
        r.leftCommitL.toString(16),
        r.rightCommitR.toString(16),
      ]);
      if (expectedX !== r.challengeX) {
        return {
          isValid: false,
          verifiedRounds: i,
          foldedCommitment,
          recomputedFinalPoint: 0n,
          reason: `Fiat-Shamir challenge mismatch at round ${i}`,
        };
      }

      const xInv = modInverseQ(expectedX);
      const xSq = modQ(expectedX * expectedX);
      const xInvSq = modQ(xInv * xInv);

      foldedCommitment = modP(
        modP(foldedCommitment * modPow(r.leftCommitL, xSq, SAFE_PRIME)) *
          modPow(r.rightCommitR, xInvSq, SAFE_PRIME)
      );

      const m = g.length >> 1;
      const nextG = new Array<bigint>(m);
      const nextH = new Array<bigint>(m);
      for (let j = 0; j < m; j++) {
        nextG[j] = modP(
          modPow(g[j], xInv, SAFE_PRIME) * modPow(g[j + m], expectedX, SAFE_PRIME)
        );
        nextH[j] = modP(
          modPow(h[j], expectedX, SAFE_PRIME) * modPow(h[j + m], xInv, SAFE_PRIME)
        );
      }
      g = nextG;
      h = nextH;

      transcript = hashHex('IPA_STEP', [
        transcript,
        r.leftCommitL.toString(16),
        r.rightCommitR.toString(16),
        expectedX.toString(16),
      ]);
    }

    const expectedFinalDigest = hashHex('IPA_FINAL', [
      transcript,
      modQ(proof.finalScalarA).toString(16),
      modQ(proof.finalScalarB).toString(16),
    ]);
    if (expectedFinalDigest !== proof.transcriptDigest) {
      return {
        isValid: false,
        verifiedRounds: expectedRounds,
        foldedCommitment,
        recomputedFinalPoint: 0n,
        reason: 'Final IPA transcript digest mismatch',
      };
    }

    const finalProduct = modQ(modQ(proof.finalScalarA) * modQ(proof.finalScalarB));
    const recomputedFinalPoint = modP(
      modP(
        modPow(g[0], modQ(proof.finalScalarA), SAFE_PRIME) *
          modPow(h[0], modQ(proof.finalScalarB), SAFE_PRIME)
      ) * modPow(this.genU, finalProduct, SAFE_PRIME)
    );

    if (recomputedFinalPoint !== foldedCommitment) {
      return {
        isValid: false,
        verifiedRounds: expectedRounds,
        foldedCommitment,
        recomputedFinalPoint,
        reason: 'Final folded commitment does not match g_final^a * h_final^b * u^{ab}',
      };
    }

    return {
      isValid: true,
      verifiedRounds: expectedRounds,
      foldedCommitment,
      recomputedFinalPoint,
    };
  }
}
