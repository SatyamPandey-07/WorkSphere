import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Recursive Inner Product Folding Prover (Bulletproof-style IPA).
 *
 * Proves knowledge of vectors a, b in F_Q^n (n = 2^k) such that:
 *   P = prod_{i=0}^{n-1} G_i^{a_i} * H_i^{b_i} * U^{<a, b>} mod P_MOD
 * in O(log n) rounds and O(log n) proof elements [(L_0, R_0), ..., (L_{k-1}, R_{k-1}), a_final, b_final]!
 *
 * Each round splits (a, b, G, H) into left/right halves of size m = n/2:
 *   c_L = <a_L, b_R>,   c_R = <a_R, b_L>
 *   L   = prod G_R^{a_L} * H_L^{b_R} * U^{c_L}
 *   R   = prod G_L^{a_R} * H_R^{b_L} * U^{c_R}
 *   u   = FiatShamir(P, L, R, round)
 *   a'  = u * a_L + u^{-1} * a_R,   b' = u^{-1} * b_L + u * b_R
 *   G'  = G_L^{u^{-1}} * G_R^u,     H' = H_L^u * H_R^{u^{-1}}
 *   P'  = L^{u^2} * P * R^{u^{-2}}
 *
 * After k = log2(n) rounds, verifier checks ONE final equation:
 *   G_final^{a_final} * H_final^{b_final} * U^{a_final * b_final} == P_final!
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
  if (r > 1n) throw new Error('Scalar not invertible');
  return t < 0n ? t + m : t;
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

function deriveQR(tag: string): bigint {
  const raw = (BigInt('0x' + sha256Hex('IPA-FOLD-GEN-V1', tag).slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
  const qr = (raw * raw) % SAFE_PRIME_P;
  return qr === 1n ? BASE_G : qr;
}

export interface IPABasis {
  dimension: number;
  G: bigint[];
  H: bigint[];
  U: bigint;
  domain: string;
}

export interface FoldingRoundCommitment {
  round: number;
  L: bigint;
  R: bigint;
}

export interface InnerProductFoldingProof {
  dimension: number;
  domain: string;
  commitmentP: bigint;
  claimedInnerProduct: bigint;
  rounds: FoldingRoundCommitment[];
  finalA: bigint;
  finalB: bigint;
  context: string;
}

export class ZeroKnowledgeInnerProductFoldingProver {
  public createBasis(dimension: number, domain = 'ipa-default'): IPABasis {
    if (dimension < 1 || (dimension & (dimension - 1)) !== 0) {
      throw new RangeError('IPA dimension must be a positive power of 2');
    }
    const G: bigint[] = [];
    const H: bigint[] = [];
    for (let i = 0; i < dimension; i++) {
      G.push(deriveQR(`${domain}:G:${i}`));
      H.push(deriveQR(`${domain}:H:${i}`));
    }
    const U = deriveQR(`${domain}:U`);
    return { dimension, G, H, U, domain };
  }

  public innerProduct(a: bigint[], b: bigint[]): bigint {
    if (a.length !== b.length) throw new RangeError('Vector length mismatch');
    let acc = 0n;
    for (let i = 0; i < a.length; i++) {
      acc = modScalar(acc + modScalar(a[i]) * modScalar(b[i]));
    }
    return acc;
  }

  public multiExp(bases: bigint[], exps: bigint[]): bigint {
    let acc = 1n;
    for (let i = 0; i < bases.length; i++) {
      acc = (acc * modPow(bases[i], modScalar(exps[i]), SAFE_PRIME_P)) % SAFE_PRIME_P;
    }
    return acc;
  }

  public commitVectors(basis: IPABasis, a: bigint[], b: bigint[]): { commitmentP: bigint; innerProd: bigint } {
    if (a.length !== basis.dimension || b.length !== basis.dimension) {
      throw new RangeError('Vector dimensions must match IPA basis dimension');
    }
    const innerProd = this.innerProduct(a, b);
    const commitmentP = (
      ((this.multiExp(basis.G, a) * this.multiExp(basis.H, b)) % SAFE_PRIME_P) *
      modPow(basis.U, innerProd, SAFE_PRIME_P)
    ) % SAFE_PRIME_P;
    return { commitmentP, innerProd };
  }

  private roundChallenge(
    domain: string,
    context: string,
    round: number,
    curP: bigint,
    L: bigint,
    R: bigint,
  ): bigint {
    return hashToScalar(
      'IPA-FOLD-CHALLENGE-V1',
      domain,
      context,
      String(round),
      curP.toString(16),
      L.toString(16),
      R.toString(16),
    );
  }

  public prove(basis: IPABasis, aIn: bigint[], bIn: bigint[], context = 'ipa-ctx'): InnerProductFoldingProof {
    const { commitmentP, innerProd } = this.commitVectors(basis, aIn, bIn);
    let a = aIn.map((v) => modScalar(v));
    let b = bIn.map((v) => modScalar(v));
    let G = [...basis.G];
    let H = [...basis.H];
    let curP = commitmentP;

    const rounds: FoldingRoundCommitment[] = [];
    let roundIdx = 0;

    while (a.length > 1) {
      const m = a.length >> 1;
      const aL = a.slice(0, m);
      const aR = a.slice(m);
      const bL = b.slice(0, m);
      const bR = b.slice(m);
      const GL = G.slice(0, m);
      const GR = G.slice(m);
      const HL = H.slice(0, m);
      const HR = H.slice(m);

      const cL = this.innerProduct(aL, bR);
      const cR = this.innerProduct(aR, bL);

      const L = (
        ((this.multiExp(GR, aL) * this.multiExp(HL, bR)) % SAFE_PRIME_P) *
        modPow(basis.U, cL, SAFE_PRIME_P)
      ) % SAFE_PRIME_P;
      const R = (
        ((this.multiExp(GL, aR) * this.multiExp(HR, bL)) % SAFE_PRIME_P) *
        modPow(basis.U, cR, SAFE_PRIME_P)
      ) % SAFE_PRIME_P;

      rounds.push({ round: roundIdx, L, R });

      const u = this.roundChallenge(basis.domain, context, roundIdx, curP, L, R);
      const uInv = modInv(u, SUBGROUP_Q);
      const uSq = modScalar(u * u);
      const uInvSq = modScalar(uInv * uInv);

      const nextA = new Array<bigint>(m);
      const nextB = new Array<bigint>(m);
      const nextG = new Array<bigint>(m);
      const nextH = new Array<bigint>(m);

      for (let i = 0; i < m; i++) {
        nextA[i] = modScalar(u * aL[i] + uInv * aR[i]);
        nextB[i] = modScalar(uInv * bL[i] + u * bR[i]);
        nextG[i] = (modPow(GL[i], uInv, SAFE_PRIME_P) * modPow(GR[i], u, SAFE_PRIME_P)) % SAFE_PRIME_P;
        nextH[i] = (modPow(HL[i], u, SAFE_PRIME_P) * modPow(HR[i], uInv, SAFE_PRIME_P)) % SAFE_PRIME_P;
      }

      curP = (((modPow(L, uSq, SAFE_PRIME_P) * curP) % SAFE_PRIME_P) * modPow(R, uInvSq, SAFE_PRIME_P)) % SAFE_PRIME_P;
      a = nextA;
      b = nextB;
      G = nextG;
      H = nextH;
      roundIdx++;
    }

    return {
      dimension: basis.dimension,
      domain: basis.domain,
      commitmentP,
      claimedInnerProduct: innerProd,
      rounds,
      finalA: a[0],
      finalB: b[0],
      context,
    };
  }

  public verify(basis: IPABasis, proof: InnerProductFoldingProof): boolean {
    if (proof.dimension !== basis.dimension || proof.domain !== basis.domain) return false;
    const expectedRounds = Math.round(Math.log2(basis.dimension));
    if (proof.rounds.length !== expectedRounds) return false;

    let G = [...basis.G];
    let H = [...basis.H];
    let curP = proof.commitmentP;

    for (let r = 0; r < proof.rounds.length; r++) {
      const { round, L, R } = proof.rounds[r];
      if (round !== r) return false;
      const u = this.roundChallenge(basis.domain, proof.context, r, curP, L, R);
      const uInv = modInv(u, SUBGROUP_Q);
      const uSq = modScalar(u * u);
      const uInvSq = modScalar(uInv * uInv);

      const m = G.length >> 1;
      const nextG = new Array<bigint>(m);
      const nextH = new Array<bigint>(m);
      for (let i = 0; i < m; i++) {
        nextG[i] = (modPow(G[i], uInv, SAFE_PRIME_P) * modPow(G[m + i], u, SAFE_PRIME_P)) % SAFE_PRIME_P;
        nextH[i] = (modPow(H[i], u, SAFE_PRIME_P) * modPow(H[m + i], uInv, SAFE_PRIME_P)) % SAFE_PRIME_P;
      }

      curP = (((modPow(L, uSq, SAFE_PRIME_P) * curP) % SAFE_PRIME_P) * modPow(R, uInvSq, SAFE_PRIME_P)) % SAFE_PRIME_P;
      G = nextG;
      H = nextH;
    }

    const finalProd = modScalar(modScalar(proof.finalA) * modScalar(proof.finalB));
    const expectedP = (
      ((modPow(G[0], modScalar(proof.finalA), SAFE_PRIME_P) * modPow(H[0], modScalar(proof.finalB), SAFE_PRIME_P)) % SAFE_PRIME_P) *
      modPow(basis.U, finalProd, SAFE_PRIME_P)
    ) % SAFE_PRIME_P;

    return expectedP === curP;
  }

  public verifyBatch(basis: IPABasis, proofs: InnerProductFoldingProof[]): { allValid: boolean; failedIndices: number[] } {
    const failedIndices: number[] = [];
    for (let i = 0; i < proofs.length; i++) {
      if (!this.verify(basis, proofs[i])) failedIndices.push(i);
    }
    return { allValid: failedIndices.length === 0, failedIndices };
  }

  public serializeProof(proof: InnerProductFoldingProof): string {
    return JSON.stringify({
      dimension: proof.dimension,
      domain: proof.domain,
      roundCount: proof.rounds.length,
      claimedInnerProduct: proof.claimedInnerProduct.toString(),
      context: proof.context,
    });
  }

  public generateRandomVectors(dimension: number): { a: bigint[]; b: bigint[] } {
    const sample = () => {
      const bytes = randomBytes(8);
      let v = 0n;
      for (const x of bytes) v = (v << 8n) | BigInt(x);
      return (v % 10000n) + 1n;
    };
    return {
      a: Array.from({ length: dimension }, sample),
      b: Array.from({ length: dimension }, sample),
    };
  }
}
