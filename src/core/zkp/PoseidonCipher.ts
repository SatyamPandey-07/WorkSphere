/**
 * @file PoseidonCipher.ts
 * @description Zero-knowledge friendly Poseidon cryptographic sponge and duplex symmetric cipher over BN254.
 * Implements Hades design strategy with quintic S-box (x^5 mod p), MDS matrix diffusion, and AEAD encryption.
 */

import { createHash } from 'crypto';

/**
 * BN254 / Alt-bn128 scalar field prime order.
 */
export const BN254_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Poseidon sponge configuration parameters.
 */
export interface PoseidonParams {
  readonly t: number; // State width (e.g., 3 for 2-to-1 hash, 4 for 3-to-1)
  readonly rf: number; // Full rounds (R_F)
  readonly rp: number; // Partial rounds (R_P)
  readonly roundConstants: bigint[]; // Flattened (rf + rp) * t constants
  readonly mdsMatrix: bigint[][]; // t x t MDS matrix
}

/**
 * Encrypted payload structure produced by PoseidonCipher duplex AEAD.
 */
export interface EncryptedPayload {
  readonly ciphertext: bigint[];
  readonly tag: bigint;
  readonly nonce: bigint;
}

/**
 * Modular arithmetic helper methods over finite field F_p.
 */
export class FieldMath {
  public static add(a: bigint, b: bigint, p: bigint = BN254_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = BN254_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = BN254_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = BN254_PRIME): bigint {
    let res = 1n;
    let b = base % p;
    let e = exponent;
    while (e > 0n) {
      if (e & 1n) {
        res = (res * b) % p;
      }
      b = (b * b) % p;
      e >>= 1n;
    }
    return res;
  }

  public static inv(val: bigint, p: bigint = BN254_PRIME): bigint {
    if (val === 0n) {
      throw new Error('FieldMath: Cannot invert zero in finite field');
    }
    return FieldMath.exp(val, p - 2n, p);
  }
}

/**
 * Generates deterministic Cauchy Maximum Distance Separable (MDS) matrix of size t x t.
 * M[i][j] = 1 / (x[i] + y[j]) mod p where x and y are distinct sets of non-zero elements.
 */
export function generateMDSMatrix(t: number, p: bigint = BN254_PRIME): bigint[][] {
  const x: bigint[] = [];
  const y: bigint[] = [];

  for (let i = 0; i < t; i++) {
    x.push(BigInt(i + 1));
    y.push(BigInt(t + i + 1));
  }

  const matrix: bigint[][] = [];
  for (let i = 0; i < t; i++) {
    const row: bigint[] = [];
    for (let j = 0; j < t; j++) {
      const denom = FieldMath.add(x[i], y[j], p);
      row.push(FieldMath.inv(denom, p));
    }
    matrix.push(row);
  }
  return matrix;
}

/**
 * Deterministically generates round constants for Poseidon using cryptographic SHAKE/SHA256 expansion.
 */
export function generateRoundConstants(
  t: number,
  rounds: number,
  seedStr: string = 'Poseidon_BN254_WorkSphere_Constants',
  p: bigint = BN254_PRIME
): bigint[] {
  const total = rounds * t;
  const constants: bigint[] = [];
  let counter = 0;

  while (constants.length < total) {
    const hash = createHash('sha256')
      .update(`${seedStr}_t${t}_idx${counter}`)
      .digest();
    let num = 0n;
    for (let i = 0; i < 32; i++) {
      num = (num << 8n) | BigInt(hash[i]);
    }
    constants.push(num % p);
    counter++;
  }
  return constants;
}

/**
 * Creates Poseidon configuration parameters for a given state width t.
 */
export function createPoseidonParams(t: number = 3, rf: number = 8, rp: number = 57): PoseidonParams {
  const totalRounds = rf + rp;
  return {
    t,
    rf,
    rp,
    roundConstants: generateRoundConstants(t, totalRounds),
    mdsMatrix: generateMDSMatrix(t),
  };
}

/**
 * Internal Poseidon permutation engine following the Hades strategy.
 */
export class PoseidonPermutation {
  public readonly params: PoseidonParams;

  constructor(params?: PoseidonParams) {
    this.params = params ?? createPoseidonParams(3, 8, 57);
  }

  /**
   * Applies the Hades permutation to state vector.
   * R_F / 2 full rounds -> R_P partial rounds -> R_F / 2 full rounds.
   */
  public permute(state: bigint[]): bigint[] {
    const { t, rf, rp, roundConstants, mdsMatrix } = this.params;
    if (state.length !== t) {
      throw new Error(`PoseidonPermutation: Invalid state length ${state.length}, expected ${t}`);
    }

    let curState = [...state];
    const halfRf = Math.floor(rf / 2);
    let cIdx = 0;

    // First half of full rounds
    for (let r = 0; r < halfRf; r++) {
      curState = this.addRoundConstants(curState, cIdx);
      cIdx += t;
      curState = this.applyFullSbox(curState);
      curState = this.applyMDS(curState, mdsMatrix);
    }

    // Partial rounds (S-Box on state[0] only)
    for (let r = 0; r < rp; r++) {
      curState = this.addRoundConstants(curState, cIdx);
      cIdx += t;
      curState = this.applyPartialSbox(curState);
      curState = this.applyMDS(curState, mdsMatrix);
    }

    // Second half of full rounds
    for (let r = 0; r < halfRf; r++) {
      curState = this.addRoundConstants(curState, cIdx);
      cIdx += t;
      curState = this.applyFullSbox(curState);
      curState = this.applyMDS(curState, mdsMatrix);
    }

    return curState;
  }

  private addRoundConstants(state: bigint[], offset: number): bigint[] {
    const t = this.params.t;
    const res = new Array<bigint>(t);
    for (let i = 0; i < t; i++) {
      res[i] = FieldMath.add(state[i], this.params.roundConstants[offset + i]);
    }
    return res;
  }

  private applyFullSbox(state: bigint[]): bigint[] {
    return state.map((x) => FieldMath.exp(x, 5n));
  }

  private applyPartialSbox(state: bigint[]): bigint[] {
    const res = [...state];
    res[0] = FieldMath.exp(res[0], 5n);
    return res;
  }

  private applyMDS(state: bigint[], mds: bigint[][]): bigint[] {
    const t = this.params.t;
    const nextState = new Array<bigint>(t);
    for (let i = 0; i < t; i++) {
      let sum = 0n;
      for (let j = 0; j < t; j++) {
        sum = FieldMath.add(sum, FieldMath.mul(mds[i][j], state[j]));
      }
      nextState[i] = sum;
    }
    return nextState;
  }
}

/**
 * Computes SNARK-friendly Poseidon hash of input field elements.
 */
export function poseidonHash(inputs: bigint[], t: number = 3): bigint {
  if (inputs.length === 0) {
    throw new Error('poseidonHash: Input elements array cannot be empty');
  }

  const rate = t - 1;
  const perm = new PoseidonPermutation(createPoseidonParams(t));
  let state = new Array<bigint>(t).fill(0n);

  // Set initial capacity element to indicate input length domain separator
  state[0] = BigInt(inputs.length);

  let inputIdx = 0;
  while (inputIdx < inputs.length) {
    for (let i = 0; i < rate && inputIdx < inputs.length; i++, inputIdx++) {
      state[i + 1] = FieldMath.add(state[i + 1], inputs[inputIdx] % BN254_PRIME);
    }
    state = perm.permute(state);
  }

  // Squeeze output from state[0]
  return state[0];
}

/**
 * Poseidon Duplex Authenticated Encryption with Associated Data (AEAD) Cipher.
 * Symmetric cipher suitable for off-chain encryption with on-chain verifiable decryption in SNARKs.
 */
export class PoseidonCipher {
  private readonly perm: PoseidonPermutation;
  public readonly params: PoseidonParams;

  constructor(t: number = 4) {
    this.params = createPoseidonParams(t, 8, 57);
    this.perm = new PoseidonPermutation(this.params);
  }

  /**
   * Encrypts plaintext field elements using shared key and nonce with optional associated data.
   */
  public encrypt(
    key: bigint[],
    nonce: bigint,
    plaintext: bigint[],
    associatedData: bigint[] = []
  ): EncryptedPayload {
    const t = this.params.t;
    const rate = t - 1;

    if (key.length === 0) {
      throw new Error('PoseidonCipher: Key must contain at least one field element');
    }

    // Initialize sponge state: [capacity/domain, key[0..rate-2], nonce]
    let state = new Array<bigint>(t).fill(0n);
    state[0] = BigInt(plaintext.length); // Domain separation & length binding
    for (let i = 0; i < rate && i < key.length; i++) {
      state[i + 1] = key[i] % BN254_PRIME;
    }
    state[t - 1] = FieldMath.add(state[t - 1], nonce % BN254_PRIME);
    state = this.perm.permute(state);

    // Absorb associated data
    let adIdx = 0;
    while (adIdx < associatedData.length) {
      for (let i = 0; i < rate && adIdx < associatedData.length; i++, adIdx++) {
        state[i] = FieldMath.add(state[i], associatedData[adIdx] % BN254_PRIME);
      }
      state = this.perm.permute(state);
    }

    // Encrypt plaintext stream
    const ciphertext: bigint[] = [];
    let ptIdx = 0;
    while (ptIdx < plaintext.length) {
      for (let i = 0; i < rate && ptIdx < plaintext.length; i++, ptIdx++) {
        const ptElem = plaintext[ptIdx] % BN254_PRIME;
        const ctElem = FieldMath.add(ptElem, state[i]);
        ciphertext.push(ctElem);
        // Absorb plaintext into state for duplex sponge authentication
        state[i] = ptElem;
      }
      state = this.perm.permute(state);
    }

    // Final squeeze gives authentication tag (MAC)
    const tag = state[0];

    return {
      ciphertext,
      tag,
      nonce,
    };
  }

  /**
   * Decrypts ciphertext and verifies authentication tag.
   * Throws Error if tag verification fails or ciphertext has been altered.
   */
  public decrypt(
    key: bigint[],
    nonce: bigint,
    ciphertext: bigint[],
    tag: bigint,
    associatedData: bigint[] = []
  ): bigint[] {
    const t = this.params.t;
    const rate = t - 1;

    if (key.length === 0) {
      throw new Error('PoseidonCipher: Key must contain at least one field element');
    }

    let state = new Array<bigint>(t).fill(0n);
    state[0] = BigInt(ciphertext.length);
    for (let i = 0; i < rate && i < key.length; i++) {
      state[i + 1] = key[i] % BN254_PRIME;
    }
    state[t - 1] = FieldMath.add(state[t - 1], nonce % BN254_PRIME);
    state = this.perm.permute(state);

    // Absorb associated data
    let adIdx = 0;
    while (adIdx < associatedData.length) {
      for (let i = 0; i < rate && adIdx < associatedData.length; i++, adIdx++) {
        state[i] = FieldMath.add(state[i], associatedData[adIdx] % BN254_PRIME);
      }
      state = this.perm.permute(state);
    }

    // Decrypt ciphertext stream
    const plaintext: bigint[] = [];
    let ctIdx = 0;
    while (ctIdx < ciphertext.length) {
      for (let i = 0; i < rate && ctIdx < ciphertext.length; i++, ctIdx++) {
        const ctElem = ciphertext[ctIdx] % BN254_PRIME;
        const ptElem = FieldMath.sub(ctElem, state[i]);
        plaintext.push(ptElem);
        // Absorb reconstructed plaintext into state
        state[i] = ptElem;
      }
      state = this.perm.permute(state);
    }

    // Verify authentication tag
    const expectedTag = state[0];
    if (expectedTag !== (tag % BN254_PRIME)) {
      throw new Error(
        'PoseidonCipher: Authentication tag verification failed - ciphertext or associated data tampered'
      );
    }

    return plaintext;
  }

  /**
   * Convenience utility to encode UTF-8 text into an array of BN254 field elements (31 bytes each).
   */
  public static textToFieldElements(text: string): bigint[] {
    const buf = Buffer.from(text, 'utf-8');
    const elements: bigint[] = [];
    const chunkSize = 31; // 31 bytes fits safely within BN254 scalar field

    for (let i = 0; i < buf.length; i += chunkSize) {
      const slice = buf.subarray(i, Math.min(i + chunkSize, buf.length));
      let val = 0n;
      for (let b = 0; b < slice.length; b++) {
        val = (val << 8n) | BigInt(slice[b]);
      }
      elements.push(val);
    }
    return elements;
  }

  /**
   * Convenience utility to decode an array of BN254 field elements back into UTF-8 text.
   */
  public static fieldElementsToText(elements: bigint[]): string {
    const chunks: Buffer[] = [];
    for (const elem of elements) {
      let val = elem;
      const bytes: number[] = [];
      while (val > 0n) {
        bytes.unshift(Number(val & 0xffn));
        val >>= 8n;
      }
      chunks.push(Buffer.from(bytes));
    }
    return Buffer.concat(chunks).toString('utf-8');
  }
}
