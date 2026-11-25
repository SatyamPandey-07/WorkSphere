import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Feige-Fiat-Shamir Multi-Round Quadratic Residuosity Batch Prover.
 *
 * Implements the classic Feige-Fiat-Shamir (FFS) zero-knowledge identification & signature
 * protocol over a composite Blum-integer modulus N = p * q (p = q = 3 mod 4) with k parallel
 * secret square-root generators and t Fiat-Shamir challenge rounds (soundness error 2^{-k*t}):
 *  - KeyGen: generates two distinct 64-bit Blum primes p, q (p ≡ q ≡ 3 mod 4), N = p * q.
 *    Samples k secret scalars s_0..s_{k-1} coprime to N and publishes public squares
 *    v_j = s_j^2 mod N.
 *  - Prove: for each round i = 0..t-1, samples random r_i in Z_N*, commits x_i = r_i^2 mod N.
 *    Derives deterministic k*t challenge bits e_{i,j} in {0, 1} via SHA-256 Fiat-Shamir.
 *    Computes response y_i = r_i * prod_{j: e_{i,j}=1} s_j mod N.
 *  - Verify: checks y_i^2 == x_i * prod_{j: e_{i,j}=1} v_j (mod N) for ALL t rounds!
 *  - Also supports batched multi-identity verification with invalid proof fault isolation!
 */

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

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function isProbablePrime(n: bigint): boolean {
  if (n < 2n) return false;
  const smallPrimes = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
  for (const sp of smallPrimes) {
    if (n === sp) return true;
    if (n % sp === 0n) return false;
  }
  let d = n - 1n;
  let s = 0;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    s++;
  }
  const bases = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n];
  for (const a of bases) {
    if (a >= n) continue;
    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let composite = true;
    for (let r = 1; r < s; r++) {
      x = (x * x) % n;
      if (x === n - 1n) {
        composite = false;
        break;
      }
    }
    if (composite) return false;
  }
  return true;
}

function randomBigIntBits(bits: number): bigint {
  const bytes = Math.ceil(bits / 8);
  const buf = randomBytes(bytes);
  buf[0] |= 0x80; // ensure top bit set
  let v = 0n;
  for (const b of buf) v = (v << 8n) | BigInt(b);
  return v >> BigInt(bytes * 8 - bits);
}

function generateBlumPrime(bits = 48): bigint {
  for (let tries = 0; tries < 20000; tries++) {
    let cand = randomBigIntBits(bits);
    cand |= 3n; // force cand ≡ 3 (mod 4)
    if (isProbablePrime(cand)) return cand;
  }
  throw new Error('Failed to generate Blum prime');
}

function randomCoprime(modN: bigint): bigint {
  for (let tries = 0; tries < 1000; tries++) {
    const buf = randomBytes(16);
    let v = 0n;
    for (const b of buf) v = (v << 8n) | BigInt(b);
    const cand = (v % (modN - 3n)) + 2n;
    if (gcd(cand, modN) === 1n) return cand;
  }
  throw new Error('Failed to sample coprime scalar');
}

function sha256Hex(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return h.digest('hex');
}

export interface FFSKeyPair {
  identityId: string;
  modulusN: bigint;
  secretRoots: bigint[];  // s_0..s_{k-1}
  publicSquares: bigint[]; // v_j = s_j^2 mod N
}

export interface FFSRoundTranscript {
  round: number;
  commitmentX: bigint;
  challengeBits: number[]; // length k, each 0 or 1
  responseY: bigint;
}

export interface FFSBatchIdentityProof {
  identityId: string;
  modulusN: bigint;
  publicSquares: bigint[];
  message: string;
  rounds: FFSRoundTranscript[];
  soundnessBits: number;
}

export class ZeroKnowledgeQuadraticResiduosityBatch {
  public generateKeyPair(identityId: string, secretCount = 8, primeBits = 48): FFSKeyPair {
    if (secretCount < 2 || secretCount > 32) throw new RangeError('secretCount must be in [2, 32]');
    const p = generateBlumPrime(primeBits);
    let q = generateBlumPrime(primeBits);
    while (q === p) q = generateBlumPrime(primeBits);
    const modulusN = p * q;

    const secretRoots: bigint[] = [];
    const publicSquares: bigint[] = [];
    for (let j = 0; j < secretCount; j++) {
      const s = randomCoprime(modulusN);
      secretRoots.push(s);
      publicSquares.push((s * s) % modulusN);
    }

    return { identityId, modulusN, secretRoots, publicSquares };
  }

  private deriveChallengeMatrix(
    identityId: string,
    modulusN: bigint,
    publicSquares: bigint[],
    message: string,
    commitments: bigint[],
  ): number[][] {
    const k = publicSquares.length;
    const t = commitments.length;
    const seed = sha256Hex(
      'FFS-QR-CHALLENGE-V1',
      identityId,
      modulusN.toString(16),
      message,
      ...publicSquares.map((v) => v.toString(16)),
      ...commitments.map((x) => x.toString(16)),
    );

    const matrix: number[][] = [];
    for (let r = 0; r < t; r++) {
      const roundHash = sha256Hex('FFS-QR-ROUND-BITS', seed, String(r));
      const bits: number[] = [];
      for (let j = 0; j < k; j++) {
        const byteVal = parseInt(roundHash.slice((j * 2) % 64, ((j * 2) % 64) + 2), 16);
        bits.push(byteVal & 1);
      }
      matrix.push(bits);
    }
    return matrix;
  }

  public prove(keyPair: FFSKeyPair, message: string, roundCount = 10): FFSBatchIdentityProof {
    if (roundCount < 1 || roundCount > 32) throw new RangeError('roundCount must be in [1, 32]');
    const k = keyPair.secretRoots.length;
    const nonces = Array.from({ length: roundCount }, () => randomCoprime(keyPair.modulusN));
    const commitments = nonces.map((r) => (r * r) % keyPair.modulusN);

    const challengeMatrix = this.deriveChallengeMatrix(
      keyPair.identityId,
      keyPair.modulusN,
      keyPair.publicSquares,
      message,
      commitments,
    );

    const rounds: FFSRoundTranscript[] = [];
    for (let i = 0; i < roundCount; i++) {
      let y = nonces[i];
      for (let j = 0; j < k; j++) {
        if (challengeMatrix[i][j] === 1) {
          y = (y * keyPair.secretRoots[j]) % keyPair.modulusN;
        }
      }
      rounds.push({
        round: i,
        commitmentX: commitments[i],
        challengeBits: challengeMatrix[i],
        responseY: y,
      });
    }

    return {
      identityId: keyPair.identityId,
      modulusN: keyPair.modulusN,
      publicSquares: [...keyPair.publicSquares],
      message,
      rounds,
      soundnessBits: k * roundCount,
    };
  }

  public verify(proof: FFSBatchIdentityProof): boolean {
    const k = proof.publicSquares.length;
    const t = proof.rounds.length;
    if (k < 2 || t < 1 || proof.modulusN < 15n) return false;
    if (proof.soundnessBits !== k * t) return false;

    const commitments = proof.rounds.map((r) => r.commitmentX);
    const expectedMatrix = this.deriveChallengeMatrix(
      proof.identityId,
      proof.modulusN,
      proof.publicSquares,
      proof.message,
      commitments,
    );

    for (let i = 0; i < t; i++) {
      const rd = proof.rounds[i];
      if (rd.round !== i || rd.challengeBits.length !== k) return false;
      if (rd.commitmentX <= 0n || rd.commitmentX >= proof.modulusN || rd.responseY <= 0n || rd.responseY >= proof.modulusN) {
        return false;
      }
      for (let j = 0; j < k; j++) {
        if (rd.challengeBits[j] !== expectedMatrix[i][j]) return false;
      }

      // Check y_i^2 == x_i * prod_{j: e_{i,j}=1} v_j (mod N)
      const lhs = (rd.responseY * rd.responseY) % proof.modulusN;
      let rhs = rd.commitmentX % proof.modulusN;
      for (let j = 0; j < k; j++) {
        if (rd.challengeBits[j] === 1) {
          rhs = (rhs * proof.publicSquares[j]) % proof.modulusN;
        }
      }
      if (lhs !== rhs) return false;
    }

    return true;
  }

  public verifyBatch(proofs: FFSBatchIdentityProof[]): { allValid: boolean; failedIdentityIds: string[] } {
    const failedIdentityIds: string[] = [];
    for (const p of proofs) {
      if (!this.verify(p)) failedIdentityIds.push(p.identityId);
    }
    return { allValid: failedIdentityIds.length === 0, failedIdentityIds };
  }

  public serializeProof(proof: FFSBatchIdentityProof): string {
    return JSON.stringify({
      identityId: proof.identityId,
      modulusHex: proof.modulusN.toString(16),
      secretCount: proof.publicSquares.length,
      roundCount: proof.rounds.length,
      soundnessBits: proof.soundnessBits,
    });
  }
}
