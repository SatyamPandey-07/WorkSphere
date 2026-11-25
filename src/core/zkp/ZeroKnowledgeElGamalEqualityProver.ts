import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge ElGamal Plaintext Equality Prover.
 *
 * Proves in zero knowledge that two exponential ElGamal ciphertexts encrypted under
 * DIFFERENT (or identical) public keys Y_1, Y_2 encrypt the EXACT SAME secret plaintext m:
 *   CT_1 = (c1_a, c1_b) = (g^{r_1}, Y_1^{r_1} * g^m)
 *   CT_2 = (c2_a, c2_b) = (g^{r_2}, Y_2^{r_2} * g^m)
 *
 * Protocol (3-witness non-interactive Sigma protocol via Fiat-Shamir):
 *  - Prover samples nonces (k_m, k_1, k_2) in Z_Q
 *  - Commitments:
 *      A_1 = g^{k_1}
 *      A_2 = g^{k_2}
 *      B_1 = Y_1^{k_1} * g^{k_m}
 *      B_2 = Y_2^{k_2} * g^{k_m}
 *  - Challenge e = H(Y_1, Y_2, CT_1, CT_2, A_1, A_2, B_1, B_2, context)
 *  - Responses:
 *      z_m = k_m + e*m mod Q
 *      z_1 = k_1 + e*r_1 mod Q
 *      z_2 = k_2 + e*r_2 mod Q
 *
 * Also supports multi-ciphertext equivalence chains, homomorphic difference proofs
 * (proving m_1 - m_2 == delta), and batch verification.
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

export interface ElGamalKeyPair {
  secretKey: bigint;
  publicKey: bigint;
}

export interface ElGamalCiphertext {
  c1: bigint;
  c2: bigint;
}

export interface ElGamalEncryptionWitness {
  ciphertext: ElGamalCiphertext;
  plaintext: bigint;
  randomness: bigint;
  publicKey: bigint;
}

export interface PlaintextEqualityProof {
  publicKey1: bigint;
  publicKey2: bigint;
  ct1: ElGamalCiphertext;
  ct2: ElGamalCiphertext;
  offsetDelta: bigint;
  announceA1: bigint;
  announceA2: bigint;
  announceB1: bigint;
  announceB2: bigint;
  challenge: bigint;
  responseM: bigint;
  responseR1: bigint;
  responseR2: bigint;
  context: string;
}

export class ZeroKnowledgeElGamalEqualityProver {
  public generateKeyPair(secret?: bigint): ElGamalKeyPair {
    const secretKey = secret !== undefined ? modScalar(secret) : randomScalar();
    return {
      secretKey,
      publicKey: modPow(BASE_G, secretKey, SAFE_PRIME_P),
    };
  }

  public encrypt(publicKey: bigint, plaintext: bigint, randomness?: bigint): ElGamalEncryptionWitness {
    const m = modScalar(plaintext);
    const r = randomness !== undefined ? modScalar(randomness) : randomScalar();
    const c1 = modPow(BASE_G, r, SAFE_PRIME_P);
    const c2 = (modPow(publicKey, r, SAFE_PRIME_P) * modPow(BASE_G, m, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return {
      ciphertext: { c1, c2 },
      plaintext: m,
      randomness: r,
      publicKey,
    };
  }

  public decryptGroupElement(secretKey: bigint, ct: ElGamalCiphertext): bigint {
    const shared = modPow(ct.c1, secretKey, SAFE_PRIME_P);
    const invShared = modPow(shared, SAFE_PRIME_P - 2n, SAFE_PRIME_P);
    return (ct.c2 * invShared) % SAFE_PRIME_P;
  }

  public rerandomize(publicKey: bigint, ct: ElGamalCiphertext, extraR?: bigint): { ciphertext: ElGamalCiphertext; deltaR: bigint } {
    const deltaR = extraR !== undefined ? modScalar(extraR) : randomScalar();
    return {
      ciphertext: {
        c1: (ct.c1 * modPow(BASE_G, deltaR, SAFE_PRIME_P)) % SAFE_PRIME_P,
        c2: (ct.c2 * modPow(publicKey, deltaR, SAFE_PRIME_P)) % SAFE_PRIME_P,
      },
      deltaR,
    };
  }

  private computeChallenge(
    pk1: bigint,
    pk2: bigint,
    ct1: ElGamalCiphertext,
    ct2: ElGamalCiphertext,
    offsetDelta: bigint,
    a1: bigint,
    a2: bigint,
    b1: bigint,
    b2: bigint,
    context: string,
  ): bigint {
    return hashToScalar(
      'ELGAMAL-PLAINTEXT-EQ-V1',
      pk1.toString(16),
      pk2.toString(16),
      ct1.c1.toString(16),
      ct1.c2.toString(16),
      ct2.c1.toString(16),
      ct2.c2.toString(16),
      offsetDelta.toString(16),
      a1.toString(16),
      a2.toString(16),
      b1.toString(16),
      b2.toString(16),
      context,
    );
  }

  /**
   * Proves m_2 = m_1 + offsetDelta mod Q (default offsetDelta = 0 proves exact equality m_1 == m_2).
   */
  public provePlaintextRelation(
    w1: ElGamalEncryptionWitness,
    w2: ElGamalEncryptionWitness,
    offsetDelta = 0n,
    context = 'default',
  ): PlaintextEqualityProof {
    const delta = modScalar(offsetDelta);
    if (modScalar(w1.plaintext + delta) !== w2.plaintext) {
      throw new Error('Witness plaintexts do not satisfy m_2 == m_1 + offsetDelta');
    }

    const km = randomScalar();
    const k1 = randomScalar();
    const k2 = randomScalar();

    const announceA1 = modPow(BASE_G, k1, SAFE_PRIME_P);
    const announceA2 = modPow(BASE_G, k2, SAFE_PRIME_P);
    const announceB1 = (modPow(w1.publicKey, k1, SAFE_PRIME_P) * modPow(BASE_G, km, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const announceB2 = (modPow(w2.publicKey, k2, SAFE_PRIME_P) * modPow(BASE_G, km, SAFE_PRIME_P)) % SAFE_PRIME_P;

    const challenge = this.computeChallenge(
      w1.publicKey,
      w2.publicKey,
      w1.ciphertext,
      w2.ciphertext,
      delta,
      announceA1,
      announceA2,
      announceB1,
      announceB2,
      context,
    );

    const responseM = modScalar(km + challenge * w1.plaintext);
    const responseR1 = modScalar(k1 + challenge * w1.randomness);
    const responseR2 = modScalar(k2 + challenge * w2.randomness);

    return {
      publicKey1: w1.publicKey,
      publicKey2: w2.publicKey,
      ct1: w1.ciphertext,
      ct2: w2.ciphertext,
      offsetDelta: delta,
      announceA1,
      announceA2,
      announceB1,
      announceB2,
      challenge,
      responseM,
      responseR1,
      responseR2,
      context,
    };
  }

  public verifyPlaintextRelation(proof: PlaintextEqualityProof): boolean {
    const expectedC = this.computeChallenge(
      proof.publicKey1,
      proof.publicKey2,
      proof.ct1,
      proof.ct2,
      proof.offsetDelta,
      proof.announceA1,
      proof.announceA2,
      proof.announceB1,
      proof.announceB2,
      proof.context,
    );
    if (expectedC !== proof.challenge) return false;

    const eq1 = modPow(BASE_G, proof.responseR1, SAFE_PRIME_P) ===
      (proof.announceA1 * modPow(proof.ct1.c1, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    if (!eq1) return false;

    const eq2 = modPow(BASE_G, proof.responseR2, SAFE_PRIME_P) ===
      (proof.announceA2 * modPow(proof.ct2.c1, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    if (!eq2) return false;

    const eq3 = (modPow(proof.publicKey1, proof.responseR1, SAFE_PRIME_P) * modPow(BASE_G, proof.responseM, SAFE_PRIME_P)) % SAFE_PRIME_P ===
      (proof.announceB1 * modPow(proof.ct1.c2, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    if (!eq3) return false;

    // Adjusted ct2.c2' = ct2.c2 * g^{-offsetDelta} encrypts m_1 under publicKey2
    const gNegDelta = modPow(BASE_G, modScalar(SUBGROUP_Q - proof.offsetDelta), SAFE_PRIME_P);
    const adjustedC2 = (proof.ct2.c2 * gNegDelta) % SAFE_PRIME_P;
    const eq4 = (modPow(proof.publicKey2, proof.responseR2, SAFE_PRIME_P) * modPow(BASE_G, proof.responseM, SAFE_PRIME_P)) % SAFE_PRIME_P ===
      (proof.announceB2 * modPow(adjustedC2, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;

    return eq4;
  }

  public proveMultiRecipientEquivalence(
    witnesses: ElGamalEncryptionWitness[],
    context = 'multi-recipient',
  ): PlaintextEqualityProof[] {
    if (witnesses.length < 2) throw new Error('Need at least two encrypted witnesses');
    const proofs: PlaintextEqualityProof[] = [];
    for (let i = 1; i < witnesses.length; i++) {
      proofs.push(this.provePlaintextRelation(witnesses[0], witnesses[i], 0n, `${context}:${i}`));
    }
    return proofs;
  }

  public verifyBatch(proofs: PlaintextEqualityProof[]): { allValid: boolean; failedIndices: number[] } {
    const failedIndices: number[] = [];
    for (let i = 0; i < proofs.length; i++) {
      if (!this.verifyPlaintextRelation(proofs[i])) {
        failedIndices.push(i);
      }
    }
    return { allValid: failedIndices.length === 0, failedIndices };
  }

  public serializeProof(proof: PlaintextEqualityProof): string {
    return JSON.stringify({
      publicKey1: proof.publicKey1.toString(16),
      publicKey2: proof.publicKey2.toString(16),
      ct1: { c1: proof.ct1.c1.toString(16), c2: proof.ct1.c2.toString(16) },
      ct2: { c1: proof.ct2.c1.toString(16), c2: proof.ct2.c2.toString(16) },
      offsetDelta: proof.offsetDelta.toString(),
      announceA1: proof.announceA1.toString(16),
      announceA2: proof.announceA2.toString(16),
      announceB1: proof.announceB1.toString(16),
      announceB2: proof.announceB2.toString(16),
      challenge: proof.challenge.toString(16),
      responseM: proof.responseM.toString(16),
      responseR1: proof.responseR1.toString(16),
      responseR2: proof.responseR2.toString(16),
      context: proof.context,
    });
  }
}
