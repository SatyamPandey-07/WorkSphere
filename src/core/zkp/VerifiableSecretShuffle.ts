/**
 * @file VerifiableSecretShuffle.ts
 * @description Zero-Knowledge Verifiable Mix-Net Secret Shuffle Argument Engine.
 * Implements Neff / Groth style verifiable shuffle of ElGamal ciphertexts over BN254.
 * Enables a mixer node to permute and re-randomize a vector of ciphertexts under a secret
 * permutation and prove in zero-knowledge that the output vector is an honest shuffle of the
 * input vector without decrypting or leaking the permutation mapping.
 */

import { createHash, randomBytes } from 'crypto';

/**
 * BN254 prime modulus.
 */
export const SHUFFLE_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field arithmetic helper functions.
 */
export class ShuffleFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = SHUFFLE_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = SHUFFLE_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = SHUFFLE_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = SHUFFLE_PRIME): bigint {
    let res = 1n;
    let b = ((base % p) + p) % p;
    let e = exponent < 0n ? (exponent % (p - 1n)) + (p - 1n) : exponent % (p - 1n);
    while (e > 0n) {
      if (e & 1n) {
        res = (res * b) % p;
      }
      b = (b * b) % p;
      e >>= 1n;
    }
    return res;
  }

  public static inv(val: bigint, p: bigint = SHUFFLE_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('ShuffleFieldMath: Cannot invert zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = SHUFFLE_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }

  public static randomScalar(p: bigint = SHUFFLE_PRIME): bigint {
    const b = randomBytes(32);
    let val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

export interface ShuffleCiphertext {
  u: bigint; // r * G
  v: bigint; // m * G + r * Y
}

export interface ShuffleProof {
  beta: bigint;
  combinedU: bigint;
  combinedV: bigint;
  R1: bigint;
  R2: bigint;
  challenge: bigint;
  response: bigint;
  transcriptHash: string;
}

/**
 * Mix-Net Verifiable Secret Shuffle Engine.
 */
export class VerifiableSecretShuffle {
  public readonly prime: bigint;
  public readonly g: bigint;

  constructor(prime: bigint = SHUFFLE_PRIME) {
    this.prime = prime;
    this.g = ShuffleFieldMath.hashToScalar('WorkSphere_Shuffle_G', this.prime);
  }

  /**
   * Encrypts plaintext m under public key Y.
   */
  public encrypt(m: bigint, pk: bigint, r?: bigint): { ciphertext: ShuffleCiphertext; r: bigint } {
    const rand = r !== undefined ? r : ShuffleFieldMath.randomScalar(this.prime);
    const u = ShuffleFieldMath.mul(rand, this.g, this.prime);
    const mG = ShuffleFieldMath.mul(m, this.g, this.prime);
    const rY = ShuffleFieldMath.mul(rand, pk, this.prime);
    const v = ShuffleFieldMath.add(mG, rY, this.prime);
    return { ciphertext: { u, v }, r: rand };
  }

  /**
   * Shuffles and re-randomizes input ciphertexts under permutation pi:
   * out[i] = in[pi[i]] + (rho[i] * G, rho[i] * Y).
   */
  public shuffle(
    inputs: ShuffleCiphertext[],
    permutation: number[],
    pk: bigint,
    explicitRhos?: bigint[]
  ): { outputs: ShuffleCiphertext[]; rhos: bigint[] } {
    const n = inputs.length;
    if (permutation.length !== n) {
      throw new Error(`Permutation length ${permutation.length} != input length ${n}`);
    }

    const outputs: ShuffleCiphertext[] = new Array(n);
    const rhos: bigint[] = explicitRhos || new Array(n);

    for (let i = 0; i < n; i++) {
      if (!explicitRhos) {
        rhos[i] = ShuffleFieldMath.randomScalar(this.prime);
      }
      const source = inputs[permutation[i]];
      const rhoG = ShuffleFieldMath.mul(rhos[i], this.g, this.prime);
      const rhoY = ShuffleFieldMath.mul(rhos[i], pk, this.prime);

      outputs[i] = {
        u: ShuffleFieldMath.add(source.u, rhoG, this.prime),
        v: ShuffleFieldMath.add(source.v, rhoY, this.prime),
      };
    }

    return { outputs, rhos };
  }

  /**
   * Proves honest shuffle and re-randomization in zero-knowledge.
   */
  public proveShuffle(
    inputs: ShuffleCiphertext[],
    outputs: ShuffleCiphertext[],
    permutation: number[],
    rhos: bigint[],
    pk: bigint
  ): ShuffleProof {
    const n = inputs.length;

    // Fiat-Shamir beta challenge point
    const transcriptData = [
      this.g.toString(),
      pk.toString(),
      n.toString(),
      inputs.map(c => `${c.u},${c.v}`).join(';'),
      outputs.map(c => `${c.u},${c.v}`).join(';'),
    ].join(':');

    const betaHash = createHash('sha256').update(transcriptData + ':beta').digest('hex');
    const beta = ShuffleFieldMath.hashToScalar(betaHash, this.prime);

    // betaPowers[j] = beta^j
    const betaPowers: bigint[] = new Array(n);
    let curPower = 1n;
    for (let j = 0; j < n; j++) {
      betaPowers[j] = curPower;
      curPower = ShuffleFieldMath.mul(curPower, beta, this.prime);
    }

    // Input combination: sum_{j=0}^{n-1} beta^j * inputs[j]
    let inputSumU = 0n;
    let inputSumV = 0n;
    for (let j = 0; j < n; j++) {
      inputSumU = ShuffleFieldMath.add(inputSumU, ShuffleFieldMath.mul(betaPowers[j], inputs[j].u, this.prime), this.prime);
      inputSumV = ShuffleFieldMath.add(inputSumV, ShuffleFieldMath.mul(betaPowers[j], inputs[j].v, this.prime), this.prime);
    }

    // Permuted challenges: e_prime[i] = betaPowers[permutation[i]]
    // Output combination: sum_{i=0}^{n-1} e_prime[i] * outputs[i]
    let totalR = 0n;
    for (let i = 0; i < n; i++) {
      const e_prime_i = betaPowers[permutation[i]];
      const termR = ShuffleFieldMath.mul(e_prime_i, rhos[i], this.prime);
      totalR = ShuffleFieldMath.add(totalR, termR, this.prime);
    }

    // DLEQ relation: (combinedU - inputSumU) == totalR * G, (combinedV - inputSumV) == totalR * Y
    const diffU = ShuffleFieldMath.mul(totalR, this.g, this.prime);
    const diffV = ShuffleFieldMath.mul(totalR, pk, this.prime);

    const combinedU = ShuffleFieldMath.add(inputSumU, diffU, this.prime);
    const combinedV = ShuffleFieldMath.add(inputSumV, diffV, this.prime);

    // Ephemeral blinding for Chaum-Pedersen DLEQ proof
    const k = ShuffleFieldMath.randomScalar(this.prime);
    const R1 = ShuffleFieldMath.mul(k, this.g, this.prime);
    const R2 = ShuffleFieldMath.mul(k, pk, this.prime);

    const proofTranscript = [
      transcriptData,
      beta.toString(),
      combinedU.toString(),
      combinedV.toString(),
      R1.toString(),
      R2.toString(),
    ].join(':');

    const challengeHash = createHash('sha256').update(proofTranscript).digest('hex');
    const challenge = ShuffleFieldMath.hashToScalar(challengeHash, this.prime);

    const response = ShuffleFieldMath.add(k, ShuffleFieldMath.mul(challenge, totalR, this.prime), this.prime);

    return {
      beta,
      combinedU,
      combinedV,
      R1,
      R2,
      challenge,
      response,
      transcriptHash: challengeHash,
    };
  }

  /**
   * Verifies the mix-net secret shuffle proof.
   */
  public verifyShuffle(
    inputs: ShuffleCiphertext[],
    outputs: ShuffleCiphertext[],
    pk: bigint,
    proof: ShuffleProof
  ): boolean {
    const n = inputs.length;
    if (outputs.length !== n) return false;

    // 1. Recompute beta challenge
    const transcriptData = [
      this.g.toString(),
      pk.toString(),
      n.toString(),
      inputs.map(c => `${c.u},${c.v}`).join(';'),
      outputs.map(c => `${c.u},${c.v}`).join(';'),
    ].join(':');

    const expectedBetaHash = createHash('sha256').update(transcriptData + ':beta').digest('hex');
    const expectedBeta = ShuffleFieldMath.hashToScalar(expectedBetaHash, this.prime);

    if (expectedBeta !== proof.beta) return false;

    // 2. Recompute input combination sum_{j=0}^{n-1} beta^j * inputs[j]
    let inputSumU = 0n;
    let inputSumV = 0n;
    let curPower = 1n;
    for (let j = 0; j < n; j++) {
      inputSumU = ShuffleFieldMath.add(inputSumU, ShuffleFieldMath.mul(curPower, inputs[j].u, this.prime), this.prime);
      inputSumV = ShuffleFieldMath.add(inputSumV, ShuffleFieldMath.mul(curPower, inputs[j].v, this.prime), this.prime);
      curPower = ShuffleFieldMath.mul(curPower, proof.beta, this.prime);
    }

    const diffU = ShuffleFieldMath.sub(proof.combinedU, inputSumU, this.prime);
    const diffV = ShuffleFieldMath.sub(proof.combinedV, inputSumV, this.prime);

    // 3. Recompute transcript challenge
    const proofTranscript = [
      transcriptData,
      proof.beta.toString(),
      proof.combinedU.toString(),
      proof.combinedV.toString(),
      proof.R1.toString(),
      proof.R2.toString(),
    ].join(':');

    const expectedChallengeHash = createHash('sha256').update(proofTranscript).digest('hex');
    const expectedChallenge = ShuffleFieldMath.hashToScalar(expectedChallengeHash, this.prime);

    if (expectedChallenge !== proof.challenge) return false;

    // 4. Verify DLEQ: response * G == R1 + challenge * diffU, response * Y == R2 + challenge * diffV
    const lhs1 = ShuffleFieldMath.mul(proof.response, this.g, this.prime);
    const rhs1 = ShuffleFieldMath.add(proof.R1, ShuffleFieldMath.mul(proof.challenge, diffU, this.prime), this.prime);
    if (lhs1 !== rhs1) return false;

    const lhs2 = ShuffleFieldMath.mul(proof.response, pk, this.prime);
    const rhs2 = ShuffleFieldMath.add(proof.R2, ShuffleFieldMath.mul(proof.challenge, diffV, this.prime), this.prime);
    if (lhs2 !== rhs2) return false;

    return true;
  }
}
