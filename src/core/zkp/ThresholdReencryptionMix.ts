import { createHash } from 'crypto';

/**
 * Zero-Knowledge Verifiable Threshold ElGamal Re-Encryption Mixnet
 *
 * Implements a verifiable ElGamal re-encryption mixnet and (t, n) threshold
 * decryption engine over a safe-prime subgroup (P = 2Q + 1):
 *   1. Threshold Shamir key sharing with public verification points Y_i = g^{x_i}
 *   2. Individual Chaum-Pedersen DLEQ re-encryption validity proofs
 *   3. Verifiable mix-node shuffling with aggregate product-of-ciphertexts DLEQ proof
 *   4. Verifiable threshold Chaum-Pedersen DLEQ decryption shares and Lagrange recovery
 */

const SUBGROUP_ORDER = 0x7fffffffffffffffffffffffffffe1d3n; // Prime Q
const SAFE_PRIME = 0xffffffffffffffffffffffffffffc3a7n; // Safe prime P = 2Q + 1
const SUBGROUP_GEN = 4n; // Order-Q generator g

export interface ElGamalCiphertext {
  readonly c1: bigint;
  readonly c2: bigint;
}

export interface ChaumPedersenDLEQProof {
  readonly a1: bigint;
  readonly a2: bigint;
  readonly challenge: bigint;
  readonly response: bigint;
}

export interface ReencryptionProof {
  readonly input: ElGamalCiphertext;
  readonly output: ElGamalCiphertext;
  readonly dleq: ChaumPedersenDLEQProof;
}

export interface MixRoundProof {
  readonly mixNodeId: string;
  readonly inputCiphertexts: readonly ElGamalCiphertext[];
  readonly outputCiphertexts: readonly ElGamalCiphertext[];
  readonly productDleq: ChaumPedersenDLEQProof;
  readonly roundDigest: string;
}

export interface MixTrusteeShare {
  readonly trusteeId: number;
  readonly secretScalar: bigint;
  readonly publicVerificationPoint: bigint;
}

export interface ThresholdDecryptionShare {
  readonly trusteeId: number;
  readonly partialFactor: bigint;
  readonly dleq: ChaumPedersenDLEQProof;
}

export interface MixnetSetup {
  readonly threshold: number;
  readonly totalTrustees: number;
  readonly publicKeyPoint: bigint;
  readonly trustees: readonly MixTrusteeShare[];
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

function modInverseQ(a: bigint): bigint {
  const val = modQ(a);
  if (val === 0n) throw new Error('Cannot invert zero mod Q');
  return modPow(val, SUBGROUP_ORDER - 2n, SUBGROUP_ORDER);
}

function hashToScalar(domain: string, parts: readonly string[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const p of parts) {
    h.update('|');
    h.update(p);
  }
  const s = modQ(BigInt('0x' + h.digest('hex')));
  return s === 0n ? 1n : s;
}

export class ThresholdReencryptionMix {
  private readonly threshold: number;
  private readonly totalTrustees: number;

  constructor(threshold: number, totalTrustees: number) {
    if (!Number.isInteger(threshold) || !Number.isInteger(totalTrustees)) {
      throw new Error('threshold and totalTrustees must be integers');
    }
    if (threshold < 2 || threshold > totalTrustees) {
      throw new Error('Require 2 <= threshold <= totalTrustees');
    }
    this.threshold = threshold;
    this.totalTrustees = totalTrustees;
  }

  public encodeMessagePoint(exponent: bigint): bigint {
    return modPow(SUBGROUP_GEN, modQ(exponent), SAFE_PRIME);
  }

  public generateCommittee(committeeSeed: string): MixnetSetup {
    const coeffs: bigint[] = [];
    for (let k = 0; k < this.threshold; k++) {
      coeffs.push(hashToScalar('MIX_COMMITTEE_POLY', [committeeSeed, String(k)]));
    }
    const publicKeyPoint = modPow(SUBGROUP_GEN, coeffs[0], SAFE_PRIME);
    const trustees: MixTrusteeShare[] = [];

    for (let id = 1; id <= this.totalTrustees; id++) {
      const x = BigInt(id);
      let y = 0n;
      let xPow = 1n;
      for (let k = 0; k < coeffs.length; k++) {
        y = modQ(y + modQ(coeffs[k] * xPow));
        xPow = modQ(xPow * x);
      }
      trustees.push({
        trusteeId: id,
        secretScalar: y,
        publicVerificationPoint: modPow(SUBGROUP_GEN, y, SAFE_PRIME),
      });
    }

    return {
      threshold: this.threshold,
      totalTrustees: this.totalTrustees,
      publicKeyPoint,
      trustees,
    };
  }

  public encrypt(
    publicKeyPoint: bigint,
    messagePoint: bigint,
    randomnessLabel: string
  ): ElGamalCiphertext {
    const r = hashToScalar('MIX_ENC_RAND', [publicKeyPoint.toString(16), messagePoint.toString(16), randomnessLabel]);
    const c1 = modPow(SUBGROUP_GEN, r, SAFE_PRIME);
    const c2 = modP(messagePoint * modPow(publicKeyPoint, r, SAFE_PRIME));
    return { c1, c2 };
  }

  private proveDLEQ(
    base1: bigint,
    target1: bigint,
    base2: bigint,
    target2: bigint,
    exponent: bigint,
    contextTag: string
  ): ChaumPedersenDLEQProof {
    const w = hashToScalar('MIX_DLEQ_NONCE', [
      contextTag,
      base1.toString(16),
      target1.toString(16),
      base2.toString(16),
      target2.toString(16),
    ]);
    const a1 = modPow(base1, w, SAFE_PRIME);
    const a2 = modPow(base2, w, SAFE_PRIME);
    const challenge = hashToScalar('MIX_DLEQ_CHALLENGE', [
      base1.toString(16),
      target1.toString(16),
      base2.toString(16),
      target2.toString(16),
      a1.toString(16),
      a2.toString(16),
    ]);
    const response = modQ(w + modQ(challenge * modQ(exponent)));
    return { a1, a2, challenge, response };
  }

  private verifyDLEQ(
    base1: bigint,
    target1: bigint,
    base2: bigint,
    target2: bigint,
    proof: ChaumPedersenDLEQProof
  ): boolean {
    const expectedC = hashToScalar('MIX_DLEQ_CHALLENGE', [
      base1.toString(16),
      target1.toString(16),
      base2.toString(16),
      target2.toString(16),
      proof.a1.toString(16),
      proof.a2.toString(16),
    ]);
    if (expectedC !== proof.challenge) return false;

    const lhs1 = modPow(base1, modQ(proof.response), SAFE_PRIME);
    const rhs1 = modP(proof.a1 * modPow(target1, expectedC, SAFE_PRIME));
    const lhs2 = modPow(base2, modQ(proof.response), SAFE_PRIME);
    const rhs2 = modP(proof.a2 * modPow(target2, expectedC, SAFE_PRIME));
    return lhs1 === rhs1 && lhs2 === rhs2;
  }

  public reencryptWithProof(
    publicKeyPoint: bigint,
    input: ElGamalCiphertext,
    rerandLabel: string
  ): ReencryptionProof {
    const s = hashToScalar('MIX_RERAND', [input.c1.toString(16), input.c2.toString(16), rerandLabel]);
    const delta1 = modPow(SUBGROUP_GEN, s, SAFE_PRIME);
    const delta2 = modPow(publicKeyPoint, s, SAFE_PRIME);
    const output: ElGamalCiphertext = {
      c1: modP(input.c1 * delta1),
      c2: modP(input.c2 * delta2),
    };
    const dleq = this.proveDLEQ(SUBGROUP_GEN, delta1, publicKeyPoint, delta2, s, `REENC:${rerandLabel}`);
    return { input, output, dleq };
  }

  public verifyReencryption(publicKeyPoint: bigint, proof: ReencryptionProof): boolean {
    const delta1 = modP(proof.output.c1 * modInverseP(proof.input.c1));
    const delta2 = modP(proof.output.c2 * modInverseP(proof.input.c2));
    return this.verifyDLEQ(SUBGROUP_GEN, delta1, publicKeyPoint, delta2, proof.dleq);
  }

  public executeMixRound(
    mixNodeId: string,
    publicKeyPoint: bigint,
    inputs: readonly ElGamalCiphertext[],
    roundNonce: string
  ): MixRoundProof {
    if (inputs.length === 0) {
      throw new Error('Mix round requires at least one ciphertext');
    }

    // Deterministic Fisher-Yates permutation derived from roundNonce
    const perm = inputs.map((_, idx) => idx);
    for (let i = perm.length - 1; i > 0; i--) {
      const randVal = hashToScalar('MIX_PERM', [mixNodeId, roundNonce, String(i)]);
      const j = Number(randVal % BigInt(i + 1));
      const tmp = perm[i];
      perm[i] = perm[j];
      perm[j] = tmp;
    }

    let totalRerand = 0n;
    let inProd1 = 1n;
    let inProd2 = 1n;
    let outProd1 = 1n;
    let outProd2 = 1n;
    const outputCiphertexts: ElGamalCiphertext[] = [];

    for (let outIdx = 0; outIdx < inputs.length; outIdx++) {
      const orig = inputs[perm[outIdx]];
      inProd1 = modP(inProd1 * orig.c1);
      inProd2 = modP(inProd2 * orig.c2);

      const s = hashToScalar('MIX_NODE_S', [mixNodeId, roundNonce, String(outIdx)]);
      totalRerand = modQ(totalRerand + s);
      const outCt: ElGamalCiphertext = {
        c1: modP(orig.c1 * modPow(SUBGROUP_GEN, s, SAFE_PRIME)),
        c2: modP(orig.c2 * modPow(publicKeyPoint, s, SAFE_PRIME)),
      };
      outProd1 = modP(outProd1 * outCt.c1);
      outProd2 = modP(outProd2 * outCt.c2);
      outputCiphertexts.push(outCt);
    }

    const deltaProd1 = modP(outProd1 * modInverseP(inProd1));
    const deltaProd2 = modP(outProd2 * modInverseP(inProd2));
    const productDleq = this.proveDLEQ(
      SUBGROUP_GEN,
      deltaProd1,
      publicKeyPoint,
      deltaProd2,
      totalRerand,
      `MIX_PROD:${mixNodeId}:${roundNonce}`
    );

    const roundDigest = createHash('sha256')
      .update(`MIX_ROUND|${mixNodeId}|${inputs.length}|`)
      .update(`${productDleq.challenge.toString(16)}|${productDleq.response.toString(16)}`)
      .digest('hex');

    return {
      mixNodeId,
      inputCiphertexts: inputs,
      outputCiphertexts,
      productDleq,
      roundDigest,
    };
  }

  public verifyMixRound(publicKeyPoint: bigint, round: MixRoundProof): boolean {
    if (
      round.inputCiphertexts.length === 0 ||
      round.inputCiphertexts.length !== round.outputCiphertexts.length
    ) {
      return false;
    }

    const expectedDigest = createHash('sha256')
      .update(`MIX_ROUND|${round.mixNodeId}|${round.inputCiphertexts.length}|`)
      .update(`${round.productDleq.challenge.toString(16)}|${round.productDleq.response.toString(16)}`)
      .digest('hex');
    if (expectedDigest !== round.roundDigest) {
      return false;
    }

    let inProd1 = 1n;
    let inProd2 = 1n;
    let outProd1 = 1n;
    let outProd2 = 1n;
    for (let i = 0; i < round.inputCiphertexts.length; i++) {
      inProd1 = modP(inProd1 * round.inputCiphertexts[i].c1);
      inProd2 = modP(inProd2 * round.inputCiphertexts[i].c2);
      outProd1 = modP(outProd1 * round.outputCiphertexts[i].c1);
      outProd2 = modP(outProd2 * round.outputCiphertexts[i].c2);
    }

    const deltaProd1 = modP(outProd1 * modInverseP(inProd1));
    const deltaProd2 = modP(outProd2 * modInverseP(inProd2));
    return this.verifyDLEQ(SUBGROUP_GEN, deltaProd1, publicKeyPoint, deltaProd2, round.productDleq);
  }

  public createDecryptionShare(
    trustee: MixTrusteeShare,
    ciphertext: ElGamalCiphertext,
    nonceLabel: string
  ): ThresholdDecryptionShare {
    const partialFactor = modPow(ciphertext.c1, modQ(trustee.secretScalar), SAFE_PRIME);
    const dleq = this.proveDLEQ(
      SUBGROUP_GEN,
      trustee.publicVerificationPoint,
      ciphertext.c1,
      partialFactor,
      trustee.secretScalar,
      `DEC:${trustee.trusteeId}:${nonceLabel}`
    );
    return {
      trusteeId: trustee.trusteeId,
      partialFactor,
      dleq,
    };
  }

  public verifyDecryptionShare(
    publicVerificationPoint: bigint,
    ciphertext: ElGamalCiphertext,
    share: ThresholdDecryptionShare
  ): boolean {
    return this.verifyDLEQ(
      SUBGROUP_GEN,
      publicVerificationPoint,
      ciphertext.c1,
      share.partialFactor,
      share.dleq
    );
  }

  public combineDecryptionShares(
    ciphertext: ElGamalCiphertext,
    shares: readonly ThresholdDecryptionShare[],
    publicPointsByTrustee: ReadonlyMap<number, bigint>
  ): { isValid: boolean; recoveredMessagePoint: bigint; reason?: string } {
    if (shares.length < this.threshold) {
      return {
        isValid: false,
        recoveredMessagePoint: 0n,
        reason: `Need at least ${this.threshold} valid decryption shares`,
      };
    }

    const selected = shares.slice(0, this.threshold);
    const ids = selected.map((s) => s.trusteeId);
    if (new Set(ids).size !== ids.length) {
      return {
        isValid: false,
        recoveredMessagePoint: 0n,
        reason: 'Duplicate trustee IDs detected',
      };
    }

    let combinedFactor = 1n;
    for (const share of selected) {
      const pubPoint = publicPointsByTrustee.get(share.trusteeId);
      if (!pubPoint || !this.verifyDecryptionShare(pubPoint, ciphertext, share)) {
        return {
          isValid: false,
          recoveredMessagePoint: 0n,
          reason: `Invalid Chaum-Pedersen DLEQ proof for trustee ${share.trusteeId}`,
        };
      }

      // Lagrange coefficient lambda_i(0) mod Q
      let num = 1n;
      let den = 1n;
      const xI = BigInt(share.trusteeId);
      for (const otherId of ids) {
        if (otherId === share.trusteeId) continue;
        const xJ = BigInt(otherId);
        num = modQ(num * modQ(-xJ));
        den = modQ(den * modQ(xI - xJ));
      }
      const lambda = modQ(num * modInverseQ(den));
      combinedFactor = modP(combinedFactor * modPow(share.partialFactor, lambda, SAFE_PRIME));
    }

    const recoveredMessagePoint = modP(ciphertext.c2 * modInverseP(combinedFactor));
    return { isValid: true, recoveredMessagePoint };
  }
}
