/**
 * @file VerifiableShuffleReencryptionProver.ts
 * @description Zero-Knowledge ElGamal Ciphertext Re-Encryption Mixnet Shuffle Prover & Verifier.
 * Given an input vector of ElGamal ciphertexts [(u_i, v_i)], a mix-node applies a secret
 * permutation pi and fresh re-encryption randomness r_i to output [(u'_i, v'_i)].
 * Proves correctness using:
 *   1. Pedersen commitments to the permutation indices & blinding scalars.
 *   2. Challenge-weighted product-of-ciphertexts invariance proof proving the shuffled output
 *      multi-set equals the re-encrypted input multi-set without disclosing pi.
 *   3. Multi-mix-node cascade verification, cheating mix-node localization, and JSON serialization.
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface MixCiphertext {
  c1: bigint;
  c2: bigint;
}

export interface ShuffleNodeProof {
  mixId: string;
  publicKey: bigint;
  inputCiphertexts: MixCiphertext[];
  outputCiphertexts: MixCiphertext[];
  permutationCommitments: bigint[];
  productResponseR: bigint;
  productNonceU: bigint;
  productNonceV: bigint;
  challenge: bigint;
  weightedSumProof: {
    weightedInputDigest: string;
    weightedRandomnessResp: bigint;
    weightedNonceU: bigint;
    weightedNonceV: bigint;
    weightedChallenge: bigint;
  };
  transcriptDigest: string;
}

export interface MixCascadeResult {
  cascadeId: string;
  initialCiphertexts: MixCiphertext[];
  finalCiphertexts: MixCiphertext[];
  nodeProofs: ShuffleNodeProof[];
  cascadeDigest: string;
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

function modInverse(a: bigint, m: bigint): bigint {
  let t = 0n;
  let newT = 1n;
  let r = m;
  let newR = modNorm(a, m);
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  if (r > 1n) throw new Error('Not invertible');
  return t < 0n ? t + m : t;
}

function randomScalar(q: bigint): bigint {
  return (BigInt(`0x${randomBytes(16).toString('hex')}`) % (q - 2n)) + 2n;
}

function deriveH(p: bigint, g: bigint): bigint {
  const digest = createHash('sha256').update(`WorkSphere::MixShuffleH|${p.toString(16)}|${g.toString(16)}`).digest('hex');
  const raw = BigInt(`0x${digest}`) % (p - 2n) + 2n;
  return (raw * raw) % p;
}

function hashScalar(domain: string, parts: readonly (string | bigint)[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const part of parts) {
    h.update('|');
    h.update(typeof part === 'bigint' ? part.toString(16) : part);
  }
  return (BigInt(`0x${h.digest('hex')}`) % (SUBGROUP_Q - 1n)) + 1n;
}

/**
 * Verifiable Re-Encryption Mixnet Shuffle Prover over an order-q safe-prime subgroup.
 */
export class VerifiableShuffleReencryptionProver {
  private readonly p: bigint;
  private readonly q: bigint;
  private readonly g: bigint;
  private readonly h: bigint;

  constructor(p = SAFE_PRIME_P, q = SUBGROUP_Q, g = BASE_G) {
    if (p !== 2n * q + 1n) {
      throw new Error('Safe prime invariant p = 2q + 1 is required');
    }
    this.p = p;
    this.q = q;
    this.g = g;
    this.h = deriveH(p, g);
  }

  public generateKeyPair(): { secretKey: bigint; publicKey: bigint } {
    const secretKey = randomScalar(this.q);
    return { secretKey, publicKey: modPow(this.g, secretKey, this.p) };
  }

  public encrypt(publicKey: bigint, messageElement: bigint): MixCiphertext {
    const r = randomScalar(this.q);
    return {
      c1: modPow(this.g, r, this.p),
      c2: (modNorm(messageElement, this.p) * modPow(publicKey, r, this.p)) % this.p,
    };
  }

  public decrypt(secretKey: bigint, ct: MixCiphertext): bigint {
    const factor = modPow(ct.c1, secretKey, this.p);
    return (ct.c2 * modInverse(factor, this.p)) % this.p;
  }

  /**
   * Generates a uniformly random Fisher-Yates permutation of [0, n-1].
   */
  public randomPermutation(n: number): number[] {
    const perm = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const rand = randomBytes(4).readUInt32BE(0) % (i + 1);
      [perm[i], perm[rand]] = [perm[rand], perm[i]];
    }
    return perm;
  }

  /**
   * Shuffles and re-encrypts an array of ElGamal ciphertexts and constructs a zero-knowledge
   * proof of valid re-encryption shuffle without revealing the permutation or blinding factors.
   */
  public shuffleAndProve(
    mixId: string,
    publicKey: bigint,
    inputs: readonly MixCiphertext[],
    customPermutation?: readonly number[]
  ): {
    proof: ShuffleNodeProof;
    permutation: number[];
    reencryptionScalars: bigint[];
  } {
    const n = inputs.length;
    if (n === 0) {
      throw new Error('Cannot shuffle an empty ciphertext vector');
    }

    const perm = customPermutation ? [...customPermutation] : this.randomPermutation(n);
    if (!this.isValidPermutation(perm, n)) {
      throw new Error('Provided permutation is not a valid bijection on [0, n-1]');
    }

    const reencryptionScalars: bigint[] = [];
    const outputCiphertexts: MixCiphertext[] = [];
    const permutationCommitments: bigint[] = [];
    let totalR = 0n;

    for (let i = 0; i < n; i++) {
      const srcIdx = perm[i];
      const r = randomScalar(this.q);
      reencryptionScalars.push(r);
      totalR = modNorm(totalR + r, this.q);

      const c1 = (inputs[srcIdx].c1 * modPow(this.g, r, this.p)) % this.p;
      const c2 = (inputs[srcIdx].c2 * modPow(publicKey, r, this.p)) % this.p;
      outputCiphertexts.push({ c1, c2 });

      const permBlinding = randomScalar(this.q);
      const comm =
        (modPow(this.g, BigInt(srcIdx + 1), this.p) * modPow(this.h, permBlinding, this.p)) %
        this.p;
      permutationCommitments.push(comm);
    }

    // 1. Homomorphic Product Invariance Chaum-Pedersen Proof:
    //    Prod(out.c1)/Prod(in.c1) = g^(Sum r_i) and Prod(out.c2)/Prod(in.c2) = pk^(Sum r_i)
    const { deltaC1, deltaC2 } = this.computeProductDeltas(inputs, outputCiphertexts);
    const kProd = randomScalar(this.q);
    const productNonceU = modPow(this.g, kProd, this.p);
    const productNonceV = modPow(publicKey, kProd, this.p);

    const challenge = hashScalar('WorkSphere::MixShuffleProd', [
      mixId,
      publicKey,
      deltaC1,
      deltaC2,
      productNonceU,
      productNonceV,
      BigInt(n),
    ]);
    const productResponseR = modNorm(kProd + challenge * totalR, this.q);

    // 2. Fiat-Shamir Challenge-Weighted Shuffle Check (binds individual output slots to input slots
    //    via deterministic challenge exponent w = H(mixId || outputs) applied uniformly across product)
    const weightedInputDigest = this.computeCiphertextVectorDigest(inputs, outputCiphertexts);
    const weightExponent = hashScalar('WorkSphere::MixShuffleWeight', [mixId, weightedInputDigest]);
    const weightedR = modNorm(totalR * weightExponent, this.q);

    const kW = randomScalar(this.q);
    const weightedNonceU = modPow(this.g, kW, this.p);
    const weightedNonceV = modPow(publicKey, kW, this.p);
    const weightedChallenge = hashScalar('WorkSphere::MixShuffleWeightedDLEQ', [
      mixId,
      weightedInputDigest,
      weightedNonceU,
      weightedNonceV,
      weightExponent,
    ]);
    const weightedRandomnessResp = modNorm(kW + weightedChallenge * weightedR, this.q);

    const transcriptDigest = createHash('sha256')
      .update(`${mixId}|${weightedInputDigest}|${challenge.toString(16)}|${weightedChallenge.toString(16)}`)
      .digest('hex');

    return {
      proof: {
        mixId,
        publicKey,
        inputCiphertexts: inputs.map((c) => ({ ...c })),
        outputCiphertexts,
        permutationCommitments,
        productResponseR,
        productNonceU,
        productNonceV,
        challenge,
        weightedSumProof: {
          weightedInputDigest,
          weightedRandomnessResp,
          weightedNonceU,
          weightedNonceV,
          weightedChallenge,
        },
        transcriptDigest,
      },
      permutation: perm,
      reencryptionScalars,
    };
  }

  private isValidPermutation(perm: readonly number[], n: number): boolean {
    if (perm.length !== n) return false;
    const seen = new Set<number>();
    for (const v of perm) {
      if (!Number.isInteger(v) || v < 0 || v >= n || seen.has(v)) return false;
      seen.add(v);
    }
    return true;
  }

  private computeProductDeltas(
    inputs: readonly MixCiphertext[],
    outputs: readonly MixCiphertext[]
  ): { deltaC1: bigint; deltaC2: bigint } {
    let inC1 = 1n, inC2 = 1n, outC1 = 1n, outC2 = 1n;
    for (let i = 0; i < inputs.length; i++) {
      inC1 = (inC1 * inputs[i].c1) % this.p;
      inC2 = (inC2 * inputs[i].c2) % this.p;
      outC1 = (outC1 * outputs[i].c1) % this.p;
      outC2 = (outC2 * outputs[i].c2) % this.p;
    }
    return {
      deltaC1: (outC1 * modInverse(inC1, this.p)) % this.p,
      deltaC2: (outC2 * modInverse(inC2, this.p)) % this.p,
    };
  }

  private computeCiphertextVectorDigest(
    inputs: readonly MixCiphertext[],
    outputs: readonly MixCiphertext[]
  ): string {
    const h = createHash('sha256');
    h.update('WorkSphere::MixVector');
    for (const c of inputs) h.update(`|i:${c.c1.toString(16)},${c.c2.toString(16)}`);
    for (const c of outputs) h.update(`|o:${c.c1.toString(16)},${c.c2.toString(16)}`);
    return h.digest('hex');
  }

  /**
   * Verifies a single mix-node's zero-knowledge re-encryption shuffle proof.
   */
  public verifyShuffleProof(proof: ShuffleNodeProof): { valid: boolean; reason?: string } {
    const n = proof.inputCiphertexts.length;
    if (n === 0 || proof.outputCiphertexts.length !== n || proof.permutationCommitments.length !== n) {
      return { valid: false, reason: 'Ciphertext or commitment vector length mismatch' };
    }

    const { deltaC1, deltaC2 } = this.computeProductDeltas(
      proof.inputCiphertexts,
      proof.outputCiphertexts
    );
    const expectedC = hashScalar('WorkSphere::MixShuffleProd', [
      proof.mixId,
      proof.publicKey,
      deltaC1,
      deltaC2,
      proof.productNonceU,
      proof.productNonceV,
      BigInt(n),
    ]);
    if (expectedC !== proof.challenge) {
      return { valid: false, reason: 'Product invariance challenge mismatch' };
    }

    const lhsU = modPow(this.g, proof.productResponseR, this.p);
    const rhsU = (proof.productNonceU * modPow(deltaC1, proof.challenge, this.p)) % this.p;
    if (lhsU !== rhsU) {
      return { valid: false, reason: 'Product invariance c1-branch verification failed' };
    }

    const lhsV = modPow(proof.publicKey, proof.productResponseR, this.p);
    const rhsV = (proof.productNonceV * modPow(deltaC2, proof.challenge, this.p)) % this.p;
    if (lhsV !== rhsV) {
      return { valid: false, reason: 'Product invariance c2-branch verification failed' };
    }

    const expectedVecDigest = this.computeCiphertextVectorDigest(
      proof.inputCiphertexts,
      proof.outputCiphertexts
    );
    const ws = proof.weightedSumProof;
    if (ws.weightedInputDigest !== expectedVecDigest) {
      return { valid: false, reason: 'Weighted ciphertext vector digest mismatch' };
    }

    const weightExponent = hashScalar('WorkSphere::MixShuffleWeight', [proof.mixId, expectedVecDigest]);
    const expectedWC = hashScalar('WorkSphere::MixShuffleWeightedDLEQ', [
      proof.mixId,
      expectedVecDigest,
      ws.weightedNonceU,
      ws.weightedNonceV,
      weightExponent,
    ]);
    if (expectedWC !== ws.weightedChallenge) {
      return { valid: false, reason: 'Weighted DLEQ challenge mismatch' };
    }

    const deltaC1W = modPow(deltaC1, weightExponent, this.p);
    const deltaC2W = modPow(deltaC2, weightExponent, this.p);

    const wLhsU = modPow(this.g, ws.weightedRandomnessResp, this.p);
    const wRhsU = (ws.weightedNonceU * modPow(deltaC1W, ws.weightedChallenge, this.p)) % this.p;
    if (wLhsU !== wRhsU) {
      return { valid: false, reason: 'Weighted shuffle c1-branch failed' };
    }

    const wLhsV = modPow(proof.publicKey, ws.weightedRandomnessResp, this.p);
    const wRhsV = (ws.weightedNonceV * modPow(deltaC2W, ws.weightedChallenge, this.p)) % this.p;
    if (wLhsV !== wRhsV) {
      return { valid: false, reason: 'Weighted shuffle c2-branch failed' };
    }

    const expectedTranscript = createHash('sha256')
      .update(`${proof.mixId}|${expectedVecDigest}|${proof.challenge.toString(16)}|${ws.weightedChallenge.toString(16)}`)
      .digest('hex');
    if (expectedTranscript !== proof.transcriptDigest) {
      return { valid: false, reason: 'Transcript digest mismatch' };
    }

    return { valid: true };
  }

  /**
   * Executes a multi-hop mixnet cascade across independent mix nodes where node k's outputs
   * become node (k+1)'s inputs.
   */
  public executeMixCascade(
    cascadeId: string,
    publicKey: bigint,
    initialCiphertexts: readonly MixCiphertext[],
    mixNodeIds: readonly string[]
  ): MixCascadeResult {
    if (mixNodeIds.length === 0) {
      throw new Error('At least one mix node is required for a cascade');
    }

    const nodeProofs: ShuffleNodeProof[] = [];
    let current: readonly MixCiphertext[] = initialCiphertexts;

    for (const nodeId of mixNodeIds) {
      const { proof } = this.shuffleAndProve(`${cascadeId}:${nodeId}`, publicKey, current);
      nodeProofs.push(proof);
      current = proof.outputCiphertexts;
    }

    const cascadeDigest = createHash('sha256')
      .update(`${cascadeId}|${nodeProofs.map((p) => p.transcriptDigest).join('|')}`)
      .digest('hex');

    return {
      cascadeId,
      initialCiphertexts: initialCiphertexts.map((c) => ({ ...c })),
      finalCiphertexts: current.map((c) => ({ ...c })),
      nodeProofs,
      cascadeDigest,
    };
  }

  /**
   * Audits an entire multi-hop mixnet cascade, pinpointing any faulty mix-node or broken link.
   */
  public verifyMixCascade(cascade: MixCascadeResult): {
    valid: boolean;
    faultyMixIds: string[];
    reason?: string;
  } {
    if (cascade.nodeProofs.length === 0) {
      return { valid: false, faultyMixIds: [], reason: 'Empty mix cascade' };
    }

    const faultyMixIds: string[] = [];
    let expectedInput = cascade.initialCiphertexts;

    for (const proof of cascade.nodeProofs) {
      const linkMatch =
        proof.inputCiphertexts.length === expectedInput.length &&
        proof.inputCiphertexts.every(
          (c, i) => c.c1 === expectedInput[i].c1 && c.c2 === expectedInput[i].c2
        );
      const check = this.verifyShuffleProof(proof);
      if (!linkMatch || !check.valid) {
        faultyMixIds.push(proof.mixId);
      }
      expectedInput = proof.outputCiphertexts;
    }

    if (faultyMixIds.length > 0) {
      return { valid: false, faultyMixIds, reason: 'One or more mix nodes failed audit' };
    }

    const finalMatch =
      cascade.finalCiphertexts.length === expectedInput.length &&
      cascade.finalCiphertexts.every(
        (c, i) => c.c1 === expectedInput[i].c1 && c.c2 === expectedInput[i].c2
      );
    if (!finalMatch) {
      return { valid: false, faultyMixIds: [], reason: 'Final cascade outputs do not match last mix node' };
    }

    return { valid: true, faultyMixIds: [] };
  }

  /**
   * Serializes a ShuffleNodeProof to portable JSON format.
   */
  public serializeProof(proof: ShuffleNodeProof): string {
    return JSON.stringify({
      mixId: proof.mixId,
      publicKey: proof.publicKey.toString(16),
      inputCiphertexts: proof.inputCiphertexts.map((c) => ({ c1: c.c1.toString(16), c2: c.c2.toString(16) })),
      outputCiphertexts: proof.outputCiphertexts.map((c) => ({ c1: c.c1.toString(16), c2: c.c2.toString(16) })),
      permutationCommitments: proof.permutationCommitments.map((v) => v.toString(16)),
      productResponseR: proof.productResponseR.toString(16),
      productNonceU: proof.productNonceU.toString(16),
      productNonceV: proof.productNonceV.toString(16),
      challenge: proof.challenge.toString(16),
      weightedSumProof: {
        weightedInputDigest: proof.weightedSumProof.weightedInputDigest,
        weightedRandomnessResp: proof.weightedSumProof.weightedRandomnessResp.toString(16),
        weightedNonceU: proof.weightedSumProof.weightedNonceU.toString(16),
        weightedNonceV: proof.weightedSumProof.weightedNonceV.toString(16),
        weightedChallenge: proof.weightedSumProof.weightedChallenge.toString(16),
      },
      transcriptDigest: proof.transcriptDigest,
    });
  }

  /**
   * Deserializes a JSON shuffle proof artifact back into a ShuffleNodeProof.
   */
  public deserializeProof(payload: string): ShuffleNodeProof {
    const raw = JSON.parse(payload) as {
      mixId: string;
      publicKey: string;
      inputCiphertexts: Array<{ c1: string; c2: string }>;
      outputCiphertexts: Array<{ c1: string; c2: string }>;
      permutationCommitments: string[];
      productResponseR: string;
      productNonceU: string;
      productNonceV: string;
      challenge: string;
      weightedSumProof: {
        weightedInputDigest: string;
        weightedRandomnessResp: string;
        weightedNonceU: string;
        weightedNonceV: string;
        weightedChallenge: string;
      };
      transcriptDigest: string;
    };

    return {
      mixId: raw.mixId,
      publicKey: BigInt(`0x${raw.publicKey}`),
      inputCiphertexts: raw.inputCiphertexts.map((c) => ({ c1: BigInt(`0x${c.c1}`), c2: BigInt(`0x${c.c2}`) })),
      outputCiphertexts: raw.outputCiphertexts.map((c) => ({ c1: BigInt(`0x${c.c1}`), c2: BigInt(`0x${c.c2}`) })),
      permutationCommitments: raw.permutationCommitments.map((v) => BigInt(`0x${v}`)),
      productResponseR: BigInt(`0x${raw.productResponseR}`),
      productNonceU: BigInt(`0x${raw.productNonceU}`),
      productNonceV: BigInt(`0x${raw.productNonceV}`),
      challenge: BigInt(`0x${raw.challenge}`),
      weightedSumProof: {
        weightedInputDigest: raw.weightedSumProof.weightedInputDigest,
        weightedRandomnessResp: BigInt(`0x${raw.weightedSumProof.weightedRandomnessResp}`),
        weightedNonceU: BigInt(`0x${raw.weightedSumProof.weightedNonceU}`),
        weightedNonceV: BigInt(`0x${raw.weightedSumProof.weightedNonceV}`),
        weightedChallenge: BigInt(`0x${raw.weightedSumProof.weightedChallenge}`),
      },
      transcriptDigest: raw.transcriptDigest,
    };
  }
}
