import { createHash } from 'crypto';

/**
 * Zero-Knowledge Range Membership Bit-Decomposition Prover
 *
 * Proves in zero knowledge that a Pedersen-committed value C_v = g^v * h^r mod P
 * lies strictly within [0, 2^n - 1] over a safe-prime subgroup (P = 2Q + 1).
 * Decomposes v into bits b_0..b_{n-1}, attaches a non-interactive disjunctive
 * Cramer-Damgard-Schoenmakers Sigma-OR proof (b_i in {0, 1}) to each bit
 * commitment C_i = g^{b_i} * h^{r_i}, and verifies homomorphic recombination
 * prod_{i=0}^{n-1} C_i^{2^i} == C_v mod P.
 */

const SUBGROUP_ORDER = 0x7fffffffffffffffffffffffffffe1d3n; // Prime Q
const SAFE_PRIME = 0xffffffffffffffffffffffffffffc3a7n; // Safe prime P = 2Q + 1
const GEN_G = 4n; // Order-Q generator g

export interface BitSigmaORProof {
  readonly bitIndex: number;
  readonly bitCommitment: bigint;
  readonly a0: bigint;
  readonly a1: bigint;
  readonly c0: bigint;
  readonly c1: bigint;
  readonly s0: bigint;
  readonly s1: bigint;
}

export interface RangeBitmapProof {
  readonly bitWidth: number;
  readonly valueCommitment: bigint;
  readonly bitProofs: readonly BitSigmaORProof[];
  readonly transcriptDigest: string;
}

export interface RangeVerificationResult {
  readonly isValid: boolean;
  readonly verifiedBits: number;
  readonly recombinedCommitment: bigint;
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
  for (const part of parts) {
    h.update('|');
    h.update(part);
  }
  const s = modQ(BigInt('0x' + h.digest('hex')));
  return s === 0n ? 1n : s;
}

export class RangeBitmapProver {
  private readonly genH: bigint;
  private readonly invGenG: bigint;

  constructor(domainSeed = 'WORKSPHERE_RANGE_PEDERSEN_H') {
    const hExp = hashToScalar('RANGE_GEN_H', [domainSeed]);
    this.genH = modPow(GEN_G, hExp, SAFE_PRIME);
    this.invGenG = modInverseP(GEN_G);
  }

  public commitValue(value: bigint, blinding: bigint): bigint {
    const gPart = modPow(GEN_G, modQ(value), SAFE_PRIME);
    const hPart = modPow(this.genH, modQ(blinding), SAFE_PRIME);
    return modP(gPart * hPart);
  }

  public proveRange(
    value: bigint,
    blinding: bigint,
    bitWidth: number,
    proofNonce: string
  ): RangeBitmapProof {
    if (!Number.isInteger(bitWidth) || bitWidth < 1 || bitWidth > 64) {
      throw new Error('bitWidth must be an integer between 1 and 64');
    }
    const maxVal = (1n << BigInt(bitWidth)) - 1n;
    if (value < 0n || value > maxVal) {
      throw new Error(`Value ${value} is outside range [0, ${maxVal}]`);
    }

    const totalBlinding = modQ(blinding);
    const valueCommitment = this.commitValue(value, totalBlinding);

    // Choose blinding factors r_0..r_{n-1} such that sum_{i=0}^{n-1} r_i * 2^i == totalBlinding mod Q
    const bitBlindings: bigint[] = new Array<bigint>(bitWidth).fill(0n);
    let weightedSum = 0n;
    for (let i = 1; i < bitWidth; i++) {
      const ri = hashToScalar('RANGE_BIT_BLIND', [proofNonce, String(i), valueCommitment.toString(16)]);
      bitBlindings[i] = ri;
      weightedSum = modQ(weightedSum + modQ(ri * (1n << BigInt(i))));
    }
    bitBlindings[0] = modQ(totalBlinding - weightedSum);

    const bitProofs: BitSigmaORProof[] = [];
    const transcriptHasher = createHash('sha256');
    transcriptHasher.update(`RANGE_BITMAP_PROOF|${bitWidth}|${valueCommitment.toString(16)}`);

    for (let i = 0; i < bitWidth; i++) {
      const bit = Number((value >> BigInt(i)) & 1n) as 0 | 1;
      const ri = bitBlindings[i];
      const bitCommitment = this.commitValue(BigInt(bit), ri);
      const y0 = bitCommitment;
      const y1 = modP(bitCommitment * this.invGenG);

      const realW = hashToScalar('RANGE_SIGMA_W', [proofNonce, String(i), 'REAL']);
      const simC = hashToScalar('RANGE_SIGMA_SIM_C', [proofNonce, String(i), 'SIM']);
      const simS = hashToScalar('RANGE_SIGMA_SIM_S', [proofNonce, String(i), 'SIM']);

      let a0: bigint;
      let a1: bigint;
      let c0: bigint;
      let c1: bigint;
      let s0: bigint;
      let s1: bigint;

      if (bit === 0) {
        a0 = modPow(this.genH, realW, SAFE_PRIME);
        a1 = modP(
          modPow(this.genH, simS, SAFE_PRIME) *
            modInverseP(modPow(y1, simC, SAFE_PRIME))
        );
        const totalC = hashToScalar('RANGE_SIGMA_CHALLENGE', [
          String(i),
          bitCommitment.toString(16),
          a0.toString(16),
          a1.toString(16),
        ]);
        c1 = simC;
        s1 = simS;
        c0 = modQ(totalC - c1);
        s0 = modQ(realW + modQ(c0 * ri));
      } else {
        a0 = modP(
          modPow(this.genH, simS, SAFE_PRIME) *
            modInverseP(modPow(y0, simC, SAFE_PRIME))
        );
        a1 = modPow(this.genH, realW, SAFE_PRIME);
        const totalC = hashToScalar('RANGE_SIGMA_CHALLENGE', [
          String(i),
          bitCommitment.toString(16),
          a0.toString(16),
          a1.toString(16),
        ]);
        c0 = simC;
        s0 = simS;
        c1 = modQ(totalC - c0);
        s1 = modQ(realW + modQ(c1 * ri));
      }

      bitProofs.push({ bitIndex: i, bitCommitment, a0, a1, c0, c1, s0, s1 });
      transcriptHasher.update(
        `|${i}:${bitCommitment.toString(16)}:${a0.toString(16)}:${a1.toString(16)}:${c0.toString(16)}:${c1.toString(16)}:${s0.toString(16)}:${s1.toString(16)}`
      );
    }

    return {
      bitWidth,
      valueCommitment,
      bitProofs,
      transcriptDigest: transcriptHasher.digest('hex'),
    };
  }

  public verifyRange(proof: RangeBitmapProof): RangeVerificationResult {
    if (proof.bitWidth < 1 || proof.bitWidth > 64 || proof.bitProofs.length !== proof.bitWidth) {
      return {
        isValid: false,
        verifiedBits: 0,
        recombinedCommitment: 0n,
        reason: 'Invalid bitWidth or bit proof vector length',
      };
    }

    const transcriptHasher = createHash('sha256');
    transcriptHasher.update(`RANGE_BITMAP_PROOF|${proof.bitWidth}|${proof.valueCommitment.toString(16)}`);

    let recombinedCommitment = 1n;

    for (let i = 0; i < proof.bitWidth; i++) {
      const bp = proof.bitProofs[i];
      if (bp.bitIndex !== i) {
        return {
          isValid: false,
          verifiedBits: i,
          recombinedCommitment,
          reason: `Bit proof index mismatch at position ${i}`,
        };
      }

      const expectedC = hashToScalar('RANGE_SIGMA_CHALLENGE', [
        String(i),
        bp.bitCommitment.toString(16),
        bp.a0.toString(16),
        bp.a1.toString(16),
      ]);
      if (modQ(bp.c0 + bp.c1) !== expectedC) {
        return {
          isValid: false,
          verifiedBits: i,
          recombinedCommitment,
          reason: `Sigma-OR challenge split failed at bit ${i}`,
        };
      }

      const y0 = bp.bitCommitment;
      const y1 = modP(bp.bitCommitment * this.invGenG);

      const lhs0 = modPow(this.genH, modQ(bp.s0), SAFE_PRIME);
      const rhs0 = modP(bp.a0 * modPow(y0, modQ(bp.c0), SAFE_PRIME));
      if (lhs0 !== rhs0) {
        return {
          isValid: false,
          verifiedBits: i,
          recombinedCommitment,
          reason: `Sigma-OR branch 0 verification failed at bit ${i}`,
        };
      }

      const lhs1 = modPow(this.genH, modQ(bp.s1), SAFE_PRIME);
      const rhs1 = modP(bp.a1 * modPow(y1, modQ(bp.c1), SAFE_PRIME));
      if (lhs1 !== rhs1) {
        return {
          isValid: false,
          verifiedBits: i,
          recombinedCommitment,
          reason: `Sigma-OR branch 1 verification failed at bit ${i}`,
        };
      }

      const weightExp = 1n << BigInt(i);
      recombinedCommitment = modP(
        recombinedCommitment * modPow(bp.bitCommitment, weightExp, SAFE_PRIME)
      );

      transcriptHasher.update(
        `|${i}:${bp.bitCommitment.toString(16)}:${bp.a0.toString(16)}:${bp.a1.toString(16)}:${bp.c0.toString(16)}:${bp.c1.toString(16)}:${bp.s0.toString(16)}:${bp.s1.toString(16)}`
      );
    }

    if (recombinedCommitment !== proof.valueCommitment) {
      return {
        isValid: false,
        verifiedBits: proof.bitWidth,
        recombinedCommitment,
        reason: 'Homomorphic bit commitment recombination does not match value commitment',
      };
    }

    if (transcriptHasher.digest('hex') !== proof.transcriptDigest) {
      return {
        isValid: false,
        verifiedBits: proof.bitWidth,
        recombinedCommitment,
        reason: 'Range proof transcript digest mismatch',
      };
    }

    return {
      isValid: true,
      verifiedBits: proof.bitWidth,
      recombinedCommitment,
    };
  }
}
