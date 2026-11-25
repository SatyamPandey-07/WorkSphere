import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Pedersen Commitment Shuffle Audit Prover.
 *
 * Proves in zero knowledge that a list of re-blinded Pedersen commitments
 *   C'_i = g^{v_{pi(i)}} * h^{r'_i}
 * is a TRUE permutation of input commitments
 *   C_i = g^{v_i} * h^{r_i}
 * without revealing the secret permutation pi or any committed value v_i!
 *
 * Uses a Fiat-Shamir Grand-Product Permutation Argument:
 *  1. Verifier challenge beta = H(C_0..C_{n-1}, C'_0..C'_{n-1}, context).
 *  2. Because two multisets {v_i} and {v'_i} are identical iff the polynomials
 *       prod_i (v_i + beta) == prod_i (v'_i + beta)  (Schwartz-Zippel lemma over F_Q),
 *     the prover commits to intermediate running products P_k = prod_{i=0..k} (v_i + beta)
 *     and P'_k = prod_{i=0..k} (v'_i + beta) via Pedersen commitments, proves each
 *     multiplication step P_k = P_{k-1} * (v_k + beta) via a zero-knowledge Pedersen
 *     multiplication Sigma proof, and proves P_{n-1} == P'_{n-1} via a Schnorr equality proof!
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
  const raw = (BigInt('0x' + sha256Hex('ZK-PEDERSEN-SHUFFLE-H-V1').slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
  const qr = (raw * raw) % SAFE_PRIME_P;
  return qr === 1n || qr === BASE_G ? 9n : qr;
}

export const BASE_H = deriveH();

export interface CommittedItem {
  value: bigint;
  blinding: bigint;
  commitment: bigint;
}

export interface MultGateProof {
  commA: bigint;
  commB: bigint;
  commC: bigint;
  // Proves C commits to a * b given A = g^a h^{ra}, B = g^b h^{rb}, C = g^{ab} h^{rc}
  // using C = A^b * h^{rc - b*ra}: PoK of (b, rb, rDelta = rc - b*ra)
  announceB: bigint; // g^{kb} * h^{krb}
  announceC: bigint; // A^{kb} * h^{krDelta}
  challenge: bigint;
  respB: bigint;
  respRb: bigint;
  respRDelta: bigint;
}

export interface PedersenShuffleProof {
  inputs: bigint[];
  outputs: bigint[];
  challengeBeta: bigint;
  inputProductChain: bigint[];
  outputProductChain: bigint[];
  inputMultProofs: MultGateProof[];
  outputMultProofs: MultGateProof[];
  // Proves final products commit to the exact same value: P_last / P'_last = h^{r_last - r'_last}
  equalityAnnounceR: bigint;
  equalityChallenge: bigint;
  equalityResponseR: bigint;
  // Homomorphic sum invariance check: prod(inputs) / prod(outputs) = h^{sum r - sum r'}
  sumAnnounceR: bigint;
  sumChallenge: bigint;
  sumResponseR: bigint;
  context: string;
}

export class ZeroKnowledgePedersenShuffleAudit {
  public commit(value: bigint, blinding?: bigint): CommittedItem {
    const v = modScalar(value);
    const r = blinding !== undefined ? modScalar(blinding) : randomScalar();
    const commitment = (modPow(BASE_G, v, SAFE_PRIME_P) * modPow(BASE_H, r, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return { value: v, blinding: r, commitment };
  }

  public commitBatch(values: bigint[]): CommittedItem[] {
    if (values.length === 0) throw new Error('Cannot commit empty list');
    return values.map((v) => this.commit(v));
  }

  private proveMultGate(
    a: CommittedItem,
    b: CommittedItem,
    c: CommittedItem,
    tag: string,
  ): MultGateProof {
    // rDelta = c.blinding - b.value * a.blinding mod Q  =>  C == A^{b.value} * H^{rDelta}
    const rDelta = modScalar(c.blinding - b.value * a.blinding);
    const kb = randomScalar();
    const krb = randomScalar();
    const krDelta = randomScalar();

    const announceB = (modPow(BASE_G, kb, SAFE_PRIME_P) * modPow(BASE_H, krb, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const announceC = (modPow(a.commitment, kb, SAFE_PRIME_P) * modPow(BASE_H, krDelta, SAFE_PRIME_P)) % SAFE_PRIME_P;

    const challenge = hashToScalar(
      'SHUFFLE-MULT-GATE-V1',
      tag,
      a.commitment.toString(16),
      b.commitment.toString(16),
      c.commitment.toString(16),
      announceB.toString(16),
      announceC.toString(16),
    );

    return {
      commA: a.commitment,
      commB: b.commitment,
      commC: c.commitment,
      announceB,
      announceC,
      challenge,
      respB: modScalar(kb + challenge * b.value),
      respRb: modScalar(krb + challenge * b.blinding),
      respRDelta: modScalar(krDelta + challenge * rDelta),
    };
  }

  private verifyMultGate(p: MultGateProof, tag: string): boolean {
    const expectedC = hashToScalar(
      'SHUFFLE-MULT-GATE-V1',
      tag,
      p.commA.toString(16),
      p.commB.toString(16),
      p.commC.toString(16),
      p.announceB.toString(16),
      p.announceC.toString(16),
    );
    if (expectedC !== p.challenge) return false;

    const lhsB = (modPow(BASE_G, p.respB, SAFE_PRIME_P) * modPow(BASE_H, p.respRb, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const rhsB = (p.announceB * modPow(p.commB, p.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    if (lhsB !== rhsB) return false;

    const lhsC = (modPow(p.commA, p.respB, SAFE_PRIME_P) * modPow(BASE_H, p.respRDelta, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const rhsC = (p.announceC * modPow(p.commC, p.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return lhsC === rhsC;
  }

  private buildProductChain(
    items: CommittedItem[],
    beta: bigint,
    sideTag: string,
  ): { chain: CommittedItem[]; multProofs: MultGateProof[] } {
    const shifted = items.map((it) => ({
      value: modScalar(it.value + beta),
      blinding: it.blinding,
      commitment: (it.commitment * modPow(BASE_G, beta, SAFE_PRIME_P)) % SAFE_PRIME_P,
    }));

    const chain: CommittedItem[] = [shifted[0]];
    const multProofs: MultGateProof[] = [];

    for (let i = 1; i < shifted.length; i++) {
      const prev = chain[i - 1];
      const cur = shifted[i];
      const prodVal = modScalar(prev.value * cur.value);
      const next = this.commit(prodVal);
      multProofs.push(this.proveMultGate(prev, cur, next, `${sideTag}:${i}`));
      chain.push(next);
    }

    return { chain, multProofs };
  }

  public shuffleAndProve(
    inputItems: CommittedItem[],
    context = 'shuffle-v1',
    customPermutation?: number[],
  ): { outputItems: CommittedItem[]; proof: PedersenShuffleProof } {
    const n = inputItems.length;
    if (n === 0) throw new Error('Cannot shuffle empty batch');

    const perm = customPermutation ? [...customPermutation] : Array.from({ length: n }, (_, i) => i);
    if (!customPermutation) {
      for (let i = n - 1; i > 0; i--) {
        const j = randomBytes(4).readUInt32BE(0) % (i + 1);
        [perm[i], perm[j]] = [perm[j], perm[i]];
      }
    }

    const outputItems = perm.map((idx) => this.commit(inputItems[idx].value));
    const inputs = inputItems.map((x) => x.commitment);
    const outputs = outputItems.map((x) => x.commitment);

    const challengeBeta = hashToScalar(
      'SHUFFLE-BETA-V1',
      context,
      ...inputs.map((c) => c.toString(16)),
      ...outputs.map((c) => c.toString(16)),
    );

    const inProd = this.buildProductChain(inputItems, challengeBeta, `${context}:in`);
    const outProd = this.buildProductChain(outputItems, challengeBeta, `${context}:out`);

    // Prove equality of final running products
    const lastIn = inProd.chain[n - 1];
    const lastOut = outProd.chain[n - 1];
    const eqDeltaR = modScalar(lastIn.blinding - lastOut.blinding);
    const kEq = randomScalar();
    const equalityAnnounceR = modPow(BASE_H, kEq, SAFE_PRIME_P);
    const equalityChallenge = hashToScalar(
      'SHUFFLE-EQ-V1',
      context,
      lastIn.commitment.toString(16),
      lastOut.commitment.toString(16),
      equalityAnnounceR.toString(16),
    );
    const equalityResponseR = modScalar(kEq + equalityChallenge * eqDeltaR);

    // Homomorphic sum conservation check
    let sumInR = 0n;
    let sumOutR = 0n;
    for (let i = 0; i < n; i++) {
      sumInR = modScalar(sumInR + inputItems[i].blinding);
      sumOutR = modScalar(sumOutR + outputItems[i].blinding);
    }
    const sumDeltaR = modScalar(sumInR - sumOutR);
    const kSum = randomScalar();
    const sumAnnounceR = modPow(BASE_H, kSum, SAFE_PRIME_P);
    const sumChallenge = hashToScalar(
      'SHUFFLE-SUM-V1',
      context,
      challengeBeta.toString(16),
      sumAnnounceR.toString(16),
    );
    const sumResponseR = modScalar(kSum + sumChallenge * sumDeltaR);

    return {
      outputItems,
      proof: {
        inputs,
        outputs,
        challengeBeta,
        inputProductChain: inProd.chain.map((x) => x.commitment),
        outputProductChain: outProd.chain.map((x) => x.commitment),
        inputMultProofs: inProd.multProofs,
        outputMultProofs: outProd.multProofs,
        equalityAnnounceR,
        equalityChallenge,
        equalityResponseR,
        sumAnnounceR,
        sumChallenge,
        sumResponseR,
        context,
      },
    };
  }

  public verifyShuffle(proof: PedersenShuffleProof): boolean {
    const n = proof.inputs.length;
    if (
      n === 0 ||
      proof.outputs.length !== n ||
      proof.inputProductChain.length !== n ||
      proof.outputProductChain.length !== n ||
      proof.inputMultProofs.length !== n - 1 ||
      proof.outputMultProofs.length !== n - 1
    ) {
      return false;
    }

    const expectedBeta = hashToScalar(
      'SHUFFLE-BETA-V1',
      proof.context,
      ...proof.inputs.map((c) => c.toString(16)),
      ...proof.outputs.map((c) => c.toString(16)),
    );
    if (expectedBeta !== proof.challengeBeta) return false;

    const gBeta = modPow(BASE_G, proof.challengeBeta, SAFE_PRIME_P);
    if ((proof.inputs[0] * gBeta) % SAFE_PRIME_P !== proof.inputProductChain[0]) return false;
    if ((proof.outputs[0] * gBeta) % SAFE_PRIME_P !== proof.outputProductChain[0]) return false;

    for (let i = 1; i < n; i++) {
      const inM = proof.inputMultProofs[i - 1];
      const expectedInB = (proof.inputs[i] * gBeta) % SAFE_PRIME_P;
      if (inM.commA !== proof.inputProductChain[i - 1] || inM.commB !== expectedInB || inM.commC !== proof.inputProductChain[i]) {
        return false;
      }
      if (!this.verifyMultGate(inM, `${proof.context}:in:${i}`)) return false;

      const outM = proof.outputMultProofs[i - 1];
      const expectedOutB = (proof.outputs[i] * gBeta) % SAFE_PRIME_P;
      if (outM.commA !== proof.outputProductChain[i - 1] || outM.commB !== expectedOutB || outM.commC !== proof.outputProductChain[i]) {
        return false;
      }
      if (!this.verifyMultGate(outM, `${proof.context}:out:${i}`)) return false;
    }

    // Verify final grand-product equality
    const lastIn = proof.inputProductChain[n - 1];
    const lastOut = proof.outputProductChain[n - 1];
    const expectedEqC = hashToScalar(
      'SHUFFLE-EQ-V1',
      proof.context,
      lastIn.toString(16),
      lastOut.toString(16),
      proof.equalityAnnounceR.toString(16),
    );
    if (expectedEqC !== proof.equalityChallenge) return false;
    const eqRatio = (lastIn * modPow(lastOut, SAFE_PRIME_P - 2n, SAFE_PRIME_P)) % SAFE_PRIME_P;
    if (modPow(BASE_H, proof.equalityResponseR, SAFE_PRIME_P) !== (proof.equalityAnnounceR * modPow(eqRatio, proof.equalityChallenge, SAFE_PRIME_P)) % SAFE_PRIME_P) {
      return false;
    }

    // Verify homomorphic sum conservation
    const expectedSumC = hashToScalar('SHUFFLE-SUM-V1', proof.context, proof.challengeBeta.toString(16), proof.sumAnnounceR.toString(16));
    if (expectedSumC !== proof.sumChallenge) return false;
    let prodIn = 1n;
    let prodOut = 1n;
    for (let i = 0; i < n; i++) {
      prodIn = (prodIn * proof.inputs[i]) % SAFE_PRIME_P;
      prodOut = (prodOut * proof.outputs[i]) % SAFE_PRIME_P;
    }
    const sumRatio = (prodIn * modPow(prodOut, SAFE_PRIME_P - 2n, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return modPow(BASE_H, proof.sumResponseR, SAFE_PRIME_P) === (proof.sumAnnounceR * modPow(sumRatio, proof.sumChallenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  public serializeProof(proof: PedersenShuffleProof): string {
    return JSON.stringify({
      batchSize: proof.inputs.length,
      challengeBeta: proof.challengeBeta.toString(16),
      context: proof.context,
    });
  }
}
