import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Committed Multiset Equality Prover.
 *
 * Proves in zero knowledge that two independently committed multisets A = {a_0..a_{n-1}}
 * and B = {b_0..b_{n-1}} contain the EXACT SAME elements with IDENTICAL multiplicities
 * (in any order!) without revealing ANY element of A or B!
 *
 * Uses a Fiat-Shamir Grand-Product Characteristic Polynomial Identity over F_Q:
 *   prod_{i=0}^{n-1} (a_i + gamma) == prod_{i=0}^{n-1} (b_i + gamma)   (mod Q)
 * where gamma = H(C_A, C_B, context), verified via committed running-product chains,
 * per-step Pedersen multiplication gate Sigma proofs, and a final Schnorr equality check!
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
  const v = modScalar(BigInt('0x' + sha256Hex(...parts).slice(0, 32)));
  return v === 0n ? 1n : v;
}

function deriveH(): bigint {
  const raw = (BigInt('0x' + sha256Hex('ZK-MULTISET-EQ-H-V1').slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
  const qr = (raw * raw) % SAFE_PRIME_P;
  return qr === 1n || qr === BASE_G ? 9n : qr;
}

export const BASE_H = deriveH();

export interface CommittedElement {
  value: bigint;
  blinding: bigint;
  commitment: bigint;
}

export interface ProductGateProof {
  commLeft: bigint;
  commRight: bigint;
  commProd: bigint;
  announceRight: bigint;
  announceProd: bigint;
  challenge: bigint;
  respRightVal: bigint;
  respRightBlind: bigint;
  respDeltaBlind: bigint;
}

export interface MultisetEqualityProof {
  size: number;
  commitmentsA: bigint[];
  commitmentsB: bigint[];
  challengeGamma: bigint;
  runningProdA: bigint[];
  runningProdB: bigint[];
  gatesA: ProductGateProof[];
  gatesB: ProductGateProof[];
  finalEqAnnounceR: bigint;
  finalEqChallenge: bigint;
  finalEqResponseR: bigint;
  context: string;
}

export class ZeroKnowledgePedersenMultisetEquality {
  public commitElement(value: bigint, blinding?: bigint): CommittedElement {
    const v = modScalar(value);
    const r = blinding !== undefined ? modScalar(blinding) : randomScalar();
    const commitment = (modPow(BASE_G, v, SAFE_PRIME_P) * modPow(BASE_H, r, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return { value: v, blinding: r, commitment };
  }

  public commitMultiset(values: bigint[]): CommittedElement[] {
    if (values.length === 0) throw new Error('Multiset cannot be empty');
    return values.map((v) => this.commitElement(v));
  }

  private areMultisetsEqual(a: CommittedElement[], b: CommittedElement[]): boolean {
    if (a.length !== b.length) return false;
    const counts = new Map<bigint, number>();
    for (const x of a) counts.set(x.value, (counts.get(x.value) ?? 0) + 1);
    for (const y of b) {
      const c = counts.get(y.value) ?? 0;
      if (c === 0) return false;
      counts.set(y.value, c - 1);
    }
    return true;
  }

  private proveGate(left: CommittedElement, right: CommittedElement, prod: CommittedElement, tag: string): ProductGateProof {
    const rDelta = modScalar(prod.blinding - right.value * left.blinding);
    const kVal = randomScalar();
    const kR = randomScalar();
    const kDelta = randomScalar();

    const announceRight = (modPow(BASE_G, kVal, SAFE_PRIME_P) * modPow(BASE_H, kR, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const announceProd = (modPow(left.commitment, kVal, SAFE_PRIME_P) * modPow(BASE_H, kDelta, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const challenge = hashToScalar(
      'MSET-GATE-V1',
      tag,
      left.commitment.toString(16),
      right.commitment.toString(16),
      prod.commitment.toString(16),
      announceRight.toString(16),
      announceProd.toString(16),
    );

    return {
      commLeft: left.commitment,
      commRight: right.commitment,
      commProd: prod.commitment,
      announceRight,
      announceProd,
      challenge,
      respRightVal: modScalar(kVal + challenge * right.value),
      respRightBlind: modScalar(kR + challenge * right.blinding),
      respDeltaBlind: modScalar(kDelta + challenge * rDelta),
    };
  }

  private verifyGate(g: ProductGateProof, tag: string): boolean {
    const expectedC = hashToScalar(
      'MSET-GATE-V1',
      tag,
      g.commLeft.toString(16),
      g.commRight.toString(16),
      g.commProd.toString(16),
      g.announceRight.toString(16),
      g.announceProd.toString(16),
    );
    if (expectedC !== g.challenge) return false;

    const lhs1 = (modPow(BASE_G, g.respRightVal, SAFE_PRIME_P) * modPow(BASE_H, g.respRightBlind, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const rhs1 = (g.announceRight * modPow(g.commRight, g.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    if (lhs1 !== rhs1) return false;

    const lhs2 = (modPow(g.commLeft, g.respRightVal, SAFE_PRIME_P) * modPow(BASE_H, g.respDeltaBlind, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const rhs2 = (g.announceProd * modPow(g.commProd, g.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return lhs2 === rhs2;
  }

  private buildChain(
    items: CommittedElement[],
    gamma: bigint,
    tagPrefix: string,
  ): { chain: CommittedElement[]; gates: ProductGateProof[] } {
    const gGamma = modPow(BASE_G, gamma, SAFE_PRIME_P);
    const shifted = items.map((it) => ({
      value: modScalar(it.value + gamma),
      blinding: it.blinding,
      commitment: (it.commitment * gGamma) % SAFE_PRIME_P,
    }));

    const chain: CommittedElement[] = [shifted[0]];
    const gates: ProductGateProof[] = [];
    for (let i = 1; i < shifted.length; i++) {
      const prev = chain[i - 1];
      const cur = shifted[i];
      const next = this.commitElement(modScalar(prev.value * cur.value));
      gates.push(this.proveGate(prev, cur, next, `${tagPrefix}:${i}`));
      chain.push(next);
    }
    return { chain, gates };
  }

  public proveMultisetEquality(
    setA: CommittedElement[],
    setB: CommittedElement[],
    context = 'multiset-eq-v1',
  ): MultisetEqualityProof {
    if (setA.length === 0 || setA.length !== setB.length) {
      throw new RangeError('Multisets must be non-empty and have identical cardinality');
    }
    if (!this.areMultisetsEqual(setA, setB)) {
      throw new Error('Input multisets do not contain identical elements/multiplicities');
    }

    const commitmentsA = setA.map((x) => x.commitment);
    const commitmentsB = setB.map((x) => x.commitment);
    const challengeGamma = hashToScalar(
      'MSET-GAMMA-V1',
      context,
      ...commitmentsA.map((c) => c.toString(16)),
      ...commitmentsB.map((c) => c.toString(16)),
    );

    const chainA = this.buildChain(setA, challengeGamma, `${context}:A`);
    const chainB = this.buildChain(setB, challengeGamma, `${context}:B`);

    const lastA = chainA.chain[setA.length - 1];
    const lastB = chainB.chain[setB.length - 1];
    const deltaR = modScalar(lastA.blinding - lastB.blinding);
    const k = randomScalar();
    const finalEqAnnounceR = modPow(BASE_H, k, SAFE_PRIME_P);
    const finalEqChallenge = hashToScalar(
      'MSET-FINAL-EQ-V1',
      context,
      lastA.commitment.toString(16),
      lastB.commitment.toString(16),
      finalEqAnnounceR.toString(16),
    );
    const finalEqResponseR = modScalar(k + finalEqChallenge * deltaR);

    return {
      size: setA.length,
      commitmentsA,
      commitmentsB,
      challengeGamma,
      runningProdA: chainA.chain.map((x) => x.commitment),
      runningProdB: chainB.chain.map((x) => x.commitment),
      gatesA: chainA.gates,
      gatesB: chainB.gates,
      finalEqAnnounceR,
      finalEqChallenge,
      finalEqResponseR,
      context,
    };
  }

  public verifyMultisetEquality(proof: MultisetEqualityProof): boolean {
    const n = proof.size;
    if (
      n < 1 ||
      proof.commitmentsA.length !== n ||
      proof.commitmentsB.length !== n ||
      proof.runningProdA.length !== n ||
      proof.runningProdB.length !== n ||
      proof.gatesA.length !== n - 1 ||
      proof.gatesB.length !== n - 1
    ) {
      return false;
    }

    const expectedGamma = hashToScalar(
      'MSET-GAMMA-V1',
      proof.context,
      ...proof.commitmentsA.map((c) => c.toString(16)),
      ...proof.commitmentsB.map((c) => c.toString(16)),
    );
    if (expectedGamma !== proof.challengeGamma) return false;

    const gGamma = modPow(BASE_G, proof.challengeGamma, SAFE_PRIME_P);
    if ((proof.commitmentsA[0] * gGamma) % SAFE_PRIME_P !== proof.runningProdA[0]) return false;
    if ((proof.commitmentsB[0] * gGamma) % SAFE_PRIME_P !== proof.runningProdB[0]) return false;

    for (let i = 1; i < n; i++) {
      const gA = proof.gatesA[i - 1];
      if (
        gA.commLeft !== proof.runningProdA[i - 1] ||
        gA.commRight !== (proof.commitmentsA[i] * gGamma) % SAFE_PRIME_P ||
        gA.commProd !== proof.runningProdA[i] ||
        !this.verifyGate(gA, `${proof.context}:A:${i}`)
      ) {
        return false;
      }

      const gB = proof.gatesB[i - 1];
      if (
        gB.commLeft !== proof.runningProdB[i - 1] ||
        gB.commRight !== (proof.commitmentsB[i] * gGamma) % SAFE_PRIME_P ||
        gB.commProd !== proof.runningProdB[i] ||
        !this.verifyGate(gB, `${proof.context}:B:${i}`)
      ) {
        return false;
      }
    }

    const lastA = proof.runningProdA[n - 1];
    const lastB = proof.runningProdB[n - 1];
    const expectedFinalC = hashToScalar(
      'MSET-FINAL-EQ-V1',
      proof.context,
      lastA.toString(16),
      lastB.toString(16),
      proof.finalEqAnnounceR.toString(16),
    );
    if (expectedFinalC !== proof.finalEqChallenge) return false;

    const ratio = (lastA * modPow(lastB, SAFE_PRIME_P - 2n, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return modPow(BASE_H, proof.finalEqResponseR, SAFE_PRIME_P) ===
      (proof.finalEqAnnounceR * modPow(ratio, proof.finalEqChallenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  public serializeProof(proof: MultisetEqualityProof): string {
    return JSON.stringify({
      size: proof.size,
      challengeGamma: proof.challengeGamma.toString(16),
      context: proof.context,
    });
  }
}
