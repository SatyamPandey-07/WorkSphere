import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Confidential UTXO Split & Merge Conservation Prover.
 *
 * Implements Confidential Transactions (CT / Mimblewimble-style) asset conservation proofs:
 *  - Consumes M hidden input Pedersen UTXO commitments C_in[i] = g^{in_i} * h^{r_in_i}
 *  - Produces K hidden output Pedersen UTXO commitments C_out[j] = g^{out_j} * h^{r_out_j}
 *    plus an explicit public transaction fee F >= 0
 *  - Proves ZERO-INFLATION CONSERVATION via homomorphic excess opening:
 *      (prod C_in[i]) * (prod C_out[j])^{-1} * g^{-fee} == h^{sum r_in - sum r_out}
 *  - Proves NON-NEGATIVITY of EVERY output commitment via bit-decomposition OR-proofs
 *    so no attacker can mint coins by creating a negative-value wraparound output!
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
  const raw = (BigInt('0x' + sha256Hex('ZK-UTXO-SPLIT-MERGE-H-V1').slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
  const qr = (raw * raw) % SAFE_PRIME_P;
  return qr === 1n || qr === BASE_G ? 9n : qr;
}

export const BASE_H = deriveH();
const INV_G = modPow(BASE_G, SAFE_PRIME_P - 2n, SAFE_PRIME_P);

export interface ConfidentialUTXO {
  utxoId: string;
  amount: bigint;
  blinding: bigint;
  commitment: bigint;
}

export interface OutputBitProof {
  bitCommitment: bigint;
  a0: bigint;
  a1: bigint;
  c0: bigint;
  c1: bigint;
  s0: bigint;
  s1: bigint;
}

export interface OutputRangeProof {
  utxoId: string;
  commitment: bigint;
  bitLength: number;
  bits: OutputBitProof[];
}

export interface ConfidentialTransferTx {
  txId: string;
  inputIds: string[];
  inputCommitments: bigint[];
  outputIds: string[];
  outputCommitments: bigint[];
  outputRangeProofs: OutputRangeProof[];
  fee: bigint;
  excessAnnouncementR: bigint;
  excessChallenge: bigint;
  excessResponseBlinding: bigint;
}

export class ZeroKnowledgePedersenCommitmentSplitProver {
  private spentInputIds = new Set<string>();

  public mintUTXO(utxoId: string, amount: bigint, blinding?: bigint): ConfidentialUTXO {
    if (amount < 0n || amount >= SUBGROUP_Q) throw new RangeError('UTXO amount out of range');
    const r = blinding !== undefined ? modScalar(blinding) : randomScalar();
    const commitment = (modPow(BASE_G, amount, SAFE_PRIME_P) * modPow(BASE_H, r, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return { utxoId, amount, blinding: r, commitment };
  }

  private proveBit(bit: 0 | 1, blinding: bigint, tag: string): OutputBitProof {
    const bitCommitment = (modPow(BASE_G, BigInt(bit), SAFE_PRIME_P) * modPow(BASE_H, blinding, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const cDivG = (bitCommitment * INV_G) % SAFE_PRIME_P;
    if (bit === 0) {
      const k0 = randomScalar();
      const a0 = modPow(BASE_H, k0, SAFE_PRIME_P);
      const c1 = randomScalar();
      const s1 = randomScalar();
      const a1 = (modPow(BASE_H, s1, SAFE_PRIME_P) * modPow(cDivG, modScalar(SUBGROUP_Q - c1), SAFE_PRIME_P)) % SAFE_PRIME_P;
      const e = hashToScalar('UTXO-BIT-V1', bitCommitment.toString(16), a0.toString(16), a1.toString(16), tag);
      const c0 = modScalar(e - c1);
      const s0 = modScalar(k0 + c0 * blinding);
      return { bitCommitment, a0, a1, c0, c1, s0, s1 };
    } else {
      const c0 = randomScalar();
      const s0 = randomScalar();
      const a0 = (modPow(BASE_H, s0, SAFE_PRIME_P) * modPow(bitCommitment, modScalar(SUBGROUP_Q - c0), SAFE_PRIME_P)) % SAFE_PRIME_P;
      const k1 = randomScalar();
      const a1 = modPow(BASE_H, k1, SAFE_PRIME_P);
      const e = hashToScalar('UTXO-BIT-V1', bitCommitment.toString(16), a0.toString(16), a1.toString(16), tag);
      const c1 = modScalar(e - c0);
      const s1 = modScalar(k1 + c1 * blinding);
      return { bitCommitment, a0, a1, c0, c1, s0, s1 };
    }
  }

  private verifyBit(bp: OutputBitProof, tag: string): boolean {
    const e = hashToScalar('UTXO-BIT-V1', bp.bitCommitment.toString(16), bp.a0.toString(16), bp.a1.toString(16), tag);
    if (modScalar(bp.c0 + bp.c1) !== e) return false;
    if (modPow(BASE_H, bp.s0, SAFE_PRIME_P) !== (bp.a0 * modPow(bp.bitCommitment, bp.c0, SAFE_PRIME_P)) % SAFE_PRIME_P) return false;
    const cDivG = (bp.bitCommitment * INV_G) % SAFE_PRIME_P;
    return modPow(BASE_H, bp.s1, SAFE_PRIME_P) === (bp.a1 * modPow(cDivG, bp.c1, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  private proveOutputRange(utxo: ConfidentialUTXO, bitLength: number, txId: string): OutputRangeProof {
    if (utxo.amount < 0n || utxo.amount >= (1n << BigInt(bitLength))) {
      throw new RangeError(`Output ${utxo.utxoId} amount ${utxo.amount} out of [0, 2^${bitLength})`);
    }
    const blindings: bigint[] = [];
    let acc = 0n;
    for (let i = 0; i < bitLength; i++) {
      if (i < bitLength - 1) {
        const ri = randomScalar();
        blindings.push(ri);
        acc = modScalar(acc + (1n << BigInt(i)) * ri);
      } else {
        const invPow2 = modPow((1n << BigInt(i)) % SUBGROUP_Q, SUBGROUP_Q - 2n, SUBGROUP_Q);
        blindings.push(modScalar((utxo.blinding - acc) * invPow2));
      }
    }
    const bits: OutputBitProof[] = [];
    for (let i = 0; i < bitLength; i++) {
      bits.push(this.proveBit(Number((utxo.amount >> BigInt(i)) & 1n) as 0 | 1, blindings[i], `${txId}:${utxo.utxoId}:b${i}`));
    }
    return { utxoId: utxo.utxoId, commitment: utxo.commitment, bitLength, bits };
  }

  private verifyOutputRange(rp: OutputRangeProof, txId: string): boolean {
    if (rp.bitLength < 1 || rp.bits.length !== rp.bitLength) return false;
    let reconstructed = 1n;
    for (let i = 0; i < rp.bitLength; i++) {
      if (!this.verifyBit(rp.bits[i], `${txId}:${rp.utxoId}:b${i}`)) return false;
      reconstructed = (reconstructed * modPow(rp.bits[i].bitCommitment, 1n << BigInt(i), SAFE_PRIME_P)) % SAFE_PRIME_P;
    }
    return reconstructed === rp.commitment;
  }

  public createConfidentialTransfer(
    txId: string,
    inputs: ConfidentialUTXO[],
    outputSpecs: Array<{ utxoId: string; amount: bigint }>,
    fee: bigint,
    rangeBits = 16,
  ): { tx: ConfidentialTransferTx; createdOutputs: ConfidentialUTXO[] } {
    if (inputs.length === 0 || outputSpecs.length === 0) throw new Error('Inputs and outputs must be non-empty');
    if (fee < 0n) throw new RangeError('Fee cannot be negative');

    const seenIn = new Set<string>();
    let totalIn = 0n;
    let totalInR = 0n;
    for (const inp of inputs) {
      if (seenIn.has(inp.utxoId)) throw new Error(`Duplicate input UTXO "${inp.utxoId}"`);
      seenIn.add(inp.utxoId);
      totalIn += inp.amount;
      totalInR = modScalar(totalInR + inp.blinding);
    }

    const createdOutputs = outputSpecs.map((spec) => this.mintUTXO(spec.utxoId, spec.amount));
    const seenOut = new Set<string>();
    let totalOut = 0n;
    let totalOutR = 0n;
    for (const out of createdOutputs) {
      if (seenOut.has(out.utxoId)) throw new Error(`Duplicate output UTXO "${out.utxoId}"`);
      seenOut.add(out.utxoId);
      totalOut += out.amount;
      totalOutR = modScalar(totalOutR + out.blinding);
    }

    if (totalIn !== totalOut + fee) {
      throw new Error(`Value conservation violated: inputs(${totalIn}) != outputs(${totalOut}) + fee(${fee})`);
    }

    const outputRangeProofs = createdOutputs.map((out) => this.proveOutputRange(out, rangeBits, txId));

    // Excess blinding = sum(r_in) - sum(r_out) mod Q
    const excessBlinding = modScalar(totalInR - totalOutR);
    const k = randomScalar();
    const excessAnnouncementR = modPow(BASE_H, k, SAFE_PRIME_P);
    const excessChallenge = hashToScalar(
      'UTXO-CONSERVE-V1',
      txId,
      fee.toString(),
      ...inputs.map((i) => i.commitment.toString(16)),
      ...createdOutputs.map((o) => o.commitment.toString(16)),
      excessAnnouncementR.toString(16),
    );
    const excessResponseBlinding = modScalar(k + excessChallenge * excessBlinding);

    const tx: ConfidentialTransferTx = {
      txId,
      inputIds: inputs.map((i) => i.utxoId),
      inputCommitments: inputs.map((i) => i.commitment),
      outputIds: createdOutputs.map((o) => o.utxoId),
      outputCommitments: createdOutputs.map((o) => o.commitment),
      outputRangeProofs,
      fee,
      excessAnnouncementR,
      excessChallenge,
      excessResponseBlinding,
    };

    return { tx, createdOutputs };
  }

  public verifyTransfer(tx: ConfidentialTransferTx): boolean {
    if (
      tx.inputIds.length === 0 ||
      tx.outputIds.length === 0 ||
      tx.inputIds.length !== tx.inputCommitments.length ||
      tx.outputIds.length !== tx.outputCommitments.length ||
      tx.outputIds.length !== tx.outputRangeProofs.length ||
      tx.fee < 0n
    ) {
      return false;
    }

    if (new Set(tx.inputIds).size !== tx.inputIds.length || new Set(tx.outputIds).size !== tx.outputIds.length) {
      return false;
    }

    let prodIn = 1n;
    for (const c of tx.inputCommitments) prodIn = (prodIn * c) % SAFE_PRIME_P;

    let prodOut = 1n;
    for (let i = 0; i < tx.outputIds.length; i++) {
      const rp = tx.outputRangeProofs[i];
      if (rp.utxoId !== tx.outputIds[i] || rp.commitment !== tx.outputCommitments[i]) return false;
      if (!this.verifyOutputRange(rp, tx.txId)) return false;
      prodOut = (prodOut * tx.outputCommitments[i]) % SAFE_PRIME_P;
    }

    const expectedC = hashToScalar(
      'UTXO-CONSERVE-V1',
      tx.txId,
      tx.fee.toString(),
      ...tx.inputCommitments.map((c) => c.toString(16)),
      ...tx.outputCommitments.map((c) => c.toString(16)),
      tx.excessAnnouncementR.toString(16),
    );
    if (expectedC !== tx.excessChallenge) return false;

    const outWithFee = (prodOut * modPow(BASE_G, modScalar(tx.fee), SAFE_PRIME_P)) % SAFE_PRIME_P;
    const excessTarget = (prodIn * modPow(outWithFee, SAFE_PRIME_P - 2n, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return modPow(BASE_H, tx.excessResponseBlinding, SAFE_PRIME_P) ===
      (tx.excessAnnouncementR * modPow(excessTarget, tx.excessChallenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  public executeAndSpend(tx: ConfidentialTransferTx): { accepted: boolean; doubleSpentInput?: string } {
    if (!this.verifyTransfer(tx)) return { accepted: false };
    for (const id of tx.inputIds) {
      if (this.spentInputIds.has(id)) return { accepted: false, doubleSpentInput: id };
    }
    for (const id of tx.inputIds) this.spentInputIds.add(id);
    return { accepted: true };
  }

  public serializeTx(tx: ConfidentialTransferTx): string {
    return JSON.stringify({
      txId: tx.txId,
      inputCount: tx.inputIds.length,
      outputCount: tx.outputIds.length,
      fee: tx.fee.toString(),
    });
  }
}
