/**
 * @file ZeroKnowledgePaillierAdditiveProver.ts
 * @description Additive Homomorphic Paillier Cryptosystem with Zero-Knowledge Proof of Plaintext
 * Knowledge (Damgard-Jurik / Paillier Sigma Proof), Homomorphic Ciphertext Addition & Scalar
 * Multiplication, Verifiable Decryption Correctness Proofs, and Portable JSON Serialization.
 * For modulus N = p * q, g = N + 1:
 *   Encrypt(m; r) = (1 + m * N) * r^N mod N^2
 *   Homomorphic Addition: Enc(m1) * Enc(m2) = Enc(m1 + m2 mod N) mod N^2
 *   Homomorphic Scaling:  Enc(m)^k = Enc(k * m mod N) mod N^2
 */

import { createHash, randomBytes } from 'node:crypto';

const PAILLIER_SEED_P = 0x00c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5n;
const PAILLIER_SEED_Q = 0x00e3f2a1b0c9d8e7f6a5b4c3d2e1f0a7n;

export interface PaillierKeyPair {
  keyId: string;
  n: bigint;
  nSquared: bigint;
  g: bigint;
  lambda: bigint;
  mu: bigint;
  keyFingerprint: string;
}

export interface PaillierCiphertext {
  ciphertextId: string;
  value: bigint;
}

export interface PaillierPlaintextKnowledgeProof {
  proofId: string;
  ciphertext: bigint;
  commitmentU: bigint;
  challengeE: bigint;
  responseZ1: bigint;
  responseZ2: bigint;
  proofDigest: string;
}

export interface PaillierHomomorphicSumAudit {
  auditId: string;
  operandCiphertexts: bigint[];
  aggregateCiphertext: bigint;
  decryptedSum: bigint;
  randomnessWitnessR: bigint;
  auditDigest: string;
}

function modNorm(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = modNorm(base, mod);
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function extendedGcd(a: bigint, b: bigint): { gcd: bigint; x: bigint; y: bigint } {
  let oldR = a, r = b;
  let oldS = 1n, s = 0n;
  let oldT = 0n, t = 1n;
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
    [oldT, t] = [t, oldT - q * t];
  }
  return { gcd: oldR, x: oldS, y: oldT };
}

function modInverse(a: bigint, m: bigint): bigint {
  const { gcd, x } = extendedGcd(modNorm(a, m), m);
  if (gcd !== 1n) throw new Error('Not invertible modulo m');
  return modNorm(x, m);
}

function lcm(a: bigint, b: bigint): bigint {
  const { gcd } = extendedGcd(a, b);
  return (a / gcd) * b;
}

function isProbablePrime(n: bigint): boolean {
  if (n < 2n) return false;
  for (const p of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n]) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  let d = n - 1n;
  let s = 0n;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    s += 1n;
  }
  for (const a of [2n, 3n, 5n, 7n, 11n]) {
    if (a >= n) continue;
    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let comp = true;
    for (let r = 1n; r < s; r++) {
      x = (x * x) % n;
      if (x === n - 1n) {
        comp = false;
        break;
      }
    }
    if (comp) return false;
  }
  return true;
}

function nextPrime(start: bigint): bigint {
  let c = start % 2n === 0n ? start + 1n : start;
  while (!isProbablePrime(c)) c += 2n;
  return c;
}

function randomCoprime(n: bigint): bigint {
  for (let i = 0; i < 256; i++) {
    const raw = (BigInt(`0x${randomBytes(32).toString('hex')}`) % (n - 3n)) + 2n;
    if (extendedGcd(raw, n).gcd === 1n) return raw;
  }
  throw new Error('Failed to sample coprime r mod N');
}

function lFunction(u: bigint, n: bigint): bigint {
  return (u - 1n) / n;
}

/**
 * Additive Homomorphic Paillier Cryptosystem & Zero-Knowledge Audit Engine.
 */
export class ZeroKnowledgePaillierAdditiveProver {
  /**
   * Generates a Paillier key pair with g = N + 1, lambda = lcm(p-1, q-1), mu = L(g^lambda mod N^2)^-1 mod N.
   */
  public generateKeyPair(keyId: string, offsetP = 0n, offsetQ = 0n): PaillierKeyPair {
    const p = nextPrime(PAILLIER_SEED_P + offsetP * 2n);
    const q = nextPrime(PAILLIER_SEED_Q + offsetQ * 2n);
    if (p === q) throw new Error('Paillier primes p and q must be distinct');

    const n = p * q;
    const nSquared = n * n;
    const g = n + 1n;
    const lambda = lcm(p - 1n, q - 1n);
    const gLambda = modPow(g, lambda, nSquared);
    const mu = modInverse(lFunction(gLambda, n), n);

    const keyFingerprint = createHash('sha256')
      .update(`WorkSphere::PaillierKey|${keyId}|${n.toString(16)}`)
      .digest('hex')
      .slice(0, 32);

    return { keyId, n, nSquared, g, lambda, mu, keyFingerprint };
  }

  /**
   * Encrypts plaintext m in [0, N-1] returning both ciphertext and randomness r for ZK proofs.
   */
  public encryptWithWitness(
    key: Pick<PaillierKeyPair, 'n' | 'nSquared' | 'g'>,
    ciphertextId: string,
    plaintext: bigint
  ): { ciphertext: PaillierCiphertext; randomnessR: bigint } {
    if (plaintext < 0n || plaintext >= key.n) {
      throw new RangeError('Plaintext must lie in [0, N - 1]');
    }
    const r = randomCoprime(key.n);
    // g^m = (1 + m * N) mod N^2
    const gm = (1n + plaintext * key.n) % key.nSquared;
    const rN = modPow(r, key.n, key.nSquared);
    const value = (gm * rN) % key.nSquared;
    return {
      ciphertext: { ciphertextId, value },
      randomnessR: r,
    };
  }

  /**
   * Decrypts a Paillier ciphertext and recovers both plaintext m and exact encryption randomness r!
   */
  public decryptWithRandomness(
    key: PaillierKeyPair,
    ciphertext: bigint
  ): { plaintext: bigint; randomnessR: bigint } {
    const u = modPow(ciphertext, key.lambda, key.nSquared);
    const plaintext = (lFunction(u, key.n) * key.mu) % key.n;

    // Recover r = (c * (1 - m*N) mod N^2)^{N^{-1} mod lambda} mod N
    const gmInv = modNorm(1n - plaintext * key.n, key.nSquared);
    const cStrip = (modNorm(ciphertext, key.nSquared) * gmInv) % key.nSquared;
    const nInvModLambda = modInverse(key.n, key.lambda);
    const randomnessR = modPow(cStrip % key.n, nInvModLambda, key.n);

    return { plaintext, randomnessR };
  }

  public decrypt(key: PaillierKeyPair, ciphertext: bigint): bigint {
    return this.decryptWithRandomness(key, ciphertext).plaintext;
  }

  /**
   * Homomorphic ciphertext addition: Enc(m1) * Enc(m2) mod N^2 == Enc(m1 + m2 mod N).
   */
  public homomorphicAdd(
    key: Pick<PaillierKeyPair, 'nSquared'>,
    resultId: string,
    ciphertexts: readonly bigint[]
  ): PaillierCiphertext {
    if (ciphertexts.length === 0) throw new Error('At least one ciphertext required for homomorphic addition');
    let acc = 1n;
    for (const c of ciphertexts) {
      acc = (acc * modNorm(c, key.nSquared)) % key.nSquared;
    }
    return { ciphertextId: resultId, value: acc };
  }

  /**
   * Homomorphic scalar multiplication: Enc(m)^k mod N^2 == Enc(k * m mod N).
   */
  public homomorphicScale(
    key: Pick<PaillierKeyPair, 'n' | 'nSquared'>,
    resultId: string,
    ciphertext: bigint,
    scalar: bigint
  ): PaillierCiphertext {
    if (scalar < 0n) throw new RangeError('Homomorphic scalar must be non-negative');
    const value = modPow(ciphertext, scalar, key.nSquared);
    return { ciphertextId: resultId, value };
  }

  /**
   * Re-randomizes a Paillier ciphertext without altering its underlying plaintext.
   */
  public rerandomize(
    key: Pick<PaillierKeyPair, 'n' | 'nSquared'>,
    ciphertext: bigint
  ): bigint {
    const r = randomCoprime(key.n);
    return (modNorm(ciphertext, key.nSquared) * modPow(r, key.n, key.nSquared)) % key.nSquared;
  }

  /**
   * Non-interactive Fiat-Shamir Sigma proof of knowledge of (m, r) such that c = g^m * r^N mod N^2:
   *   1. Prover picks random alpha in [0, N-1], beta in Z_N^*, computes U = g^alpha * beta^N mod N^2.
   *   2. Challenge e = H(proofId || N || c || U) (64-bit positive integer).
   *   3. Prover computes:
   *        z1 = (alpha + e * m) mod N,  q1 = floor((alpha + e * m) / N)
   *        z2 = beta * r^e * g^{q1} mod N  (adjusting for carry q1 * N into r^N factor!)
   *      Actually cleanly: g^{alpha + e*m} = g^{z1} * g^{q1*N} = g^{z1} * (1 + N)^{q1*N} = g^{z1} mod N^2
   *      Wait: (1 + N)^N = 1 + N^2 = 1 mod N^2! So g^N == 1 mod N^2 identically!!
   *      Therefore g^{z1} * (beta * r^e)^N == g^{alpha + e*m} * beta^N * r^{e*N} == U * c^e mod N^2!
   */
  public provePlaintextKnowledge(
    proofId: string,
    key: Pick<PaillierKeyPair, 'n' | 'nSquared' | 'g'>,
    ciphertext: bigint,
    plaintext: bigint,
    randomnessR: bigint
  ): PaillierPlaintextKnowledgeProof {
    const alpha = BigInt(`0x${randomBytes(32).toString('hex')}`) % key.n;
    const beta = randomCoprime(key.n);
    const commitmentU = (((1n + alpha * key.n) % key.nSquared) * modPow(beta, key.n, key.nSquared)) % key.nSquared;

    const eHex = createHash('sha256')
      .update(`WorkSphere::PaillierPoK|${proofId}|${key.n.toString(16)}|${ciphertext.toString(16)}|${commitmentU.toString(16)}`)
      .digest('hex');
    const challengeE = BigInt(`0x${eHex.slice(0, 16)}`) | 1n;

    const responseZ1 = modNorm(alpha + challengeE * plaintext, key.n);
    const responseZ2 = (beta * modPow(randomnessR, challengeE, key.n)) % key.n;

    const proofDigest = createHash('sha256')
      .update(`${proofId}|${ciphertext.toString(16)}|${challengeE.toString(16)}|${responseZ1.toString(16)}`)
      .digest('hex');

    return {
      proofId,
      ciphertext,
      commitmentU,
      challengeE,
      responseZ1,
      responseZ2,
      proofDigest,
    };
  }

  /**
   * Publicly verifies a Paillier Proof-of-Plaintext-Knowledge without learning m or r.
   */
  public verifyPlaintextKnowledge(
    key: Pick<PaillierKeyPair, 'n' | 'nSquared' | 'g'>,
    proof: PaillierPlaintextKnowledgeProof
  ): boolean {
    if (proof.responseZ1 < 0n || proof.responseZ1 >= key.n) return false;
    if (proof.responseZ2 <= 0n || proof.responseZ2 >= key.n) return false;

    const eHex = createHash('sha256')
      .update(`WorkSphere::PaillierPoK|${proof.proofId}|${key.n.toString(16)}|${proof.ciphertext.toString(16)}|${proof.commitmentU.toString(16)}`)
      .digest('hex');
    const expectedE = BigInt(`0x${eHex.slice(0, 16)}`) | 1n;
    if (expectedE !== proof.challengeE) return false;

    const lhs =
      (((1n + proof.responseZ1 * key.n) % key.nSquared) *
        modPow(proof.responseZ2, key.n, key.nSquared)) %
      key.nSquared;
    const rhs =
      (modNorm(proof.commitmentU, key.nSquared) *
        modPow(proof.ciphertext, proof.challengeE, key.nSquared)) %
      key.nSquared;
    return lhs === rhs;
  }

  /**
   * Homomorphically sums encrypted values, decrypts the sum, and emits a verifiable decryption
   * audit record (including aggregate randomness witness r_agg) so anyone can verify
   * Enc(decryptedSum; r_agg) == Prod(operandCiphertexts) mod N^2!
   */
  public auditHomomorphicSum(
    auditId: string,
    key: PaillierKeyPair,
    operandCiphertexts: readonly bigint[]
  ): PaillierHomomorphicSumAudit {
    const agg = this.homomorphicAdd(key, auditId, operandCiphertexts);
    const { plaintext, randomnessR } = this.decryptWithRandomness(key, agg.value);
    const auditDigest = createHash('sha256')
      .update(`${auditId}|n:${operandCiphertexts.length}|sum:${plaintext.toString(16)}|agg:${agg.value.toString(16)}`)
      .digest('hex');

    return {
      auditId,
      operandCiphertexts: [...operandCiphertexts],
      aggregateCiphertext: agg.value,
      decryptedSum: plaintext,
      randomnessWitnessR: randomnessR,
      auditDigest,
    };
  }

  public verifyHomomorphicSumAudit(
    key: Pick<PaillierKeyPair, 'n' | 'nSquared'>,
    audit: PaillierHomomorphicSumAudit
  ): boolean {
    const recomputedAgg = this.homomorphicAdd(key, audit.auditId, audit.operandCiphertexts).value;
    if (recomputedAgg !== audit.aggregateCiphertext) return false;
    const reconstructed =
      (((1n + audit.decryptedSum * key.n) % key.nSquared) *
        modPow(audit.randomnessWitnessR, key.n, key.nSquared)) %
      key.nSquared;
    return reconstructed === audit.aggregateCiphertext;
  }

  public serializePoKProof(proof: PaillierPlaintextKnowledgeProof): string {
    return JSON.stringify({
      proofId: proof.proofId,
      ciphertext: proof.ciphertext.toString(16),
      commitmentU: proof.commitmentU.toString(16),
      challengeE: proof.challengeE.toString(16),
      responseZ1: proof.responseZ1.toString(16),
      responseZ2: proof.responseZ2.toString(16),
      proofDigest: proof.proofDigest,
    });
  }

  public deserializePoKProof(payload: string): PaillierPlaintextKnowledgeProof {
    const raw = JSON.parse(payload) as Record<string, string>;
    return {
      proofId: raw.proofId,
      ciphertext: BigInt(`0x${raw.ciphertext}`),
      commitmentU: BigInt(`0x${raw.commitmentU}`),
      challengeE: BigInt(`0x${raw.challengeE}`),
      responseZ1: BigInt(`0x${raw.responseZ1}`),
      responseZ2: BigInt(`0x${raw.responseZ2}`),
      proofDigest: raw.proofDigest,
    };
  }
}
