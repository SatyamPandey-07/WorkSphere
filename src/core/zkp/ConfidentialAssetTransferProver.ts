/**
 * @file ConfidentialAssetTransferProver.ts
 * @description Zero-Knowledge Confidential Budget & Asset Transfer Prover.
 * Allows internal WorkSphere departments to transfer confidential resource credits without
 * revealing balances or transfer amounts on the shared ledger:
 *   1. Pedersen commitments hide sender input balance, transfer amount, and sender change.
 *   2. Homomorphic conservation proof proves input == transfer + change + fee (zero inflation).
 *   3. Chaum-Pedersen 0/1 bit-decomposition range proofs prove BOTH transfer >= 0 AND change >= 0.
 *   4. Multi-transfer batch auditing & JSON serialization for ledger settlement.
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface ConfidentialAccountState {
  accountId: string;
  balance: bigint;
  blinding: bigint;
  commitment: bigint;
}

export interface BitRangeProof {
  commitment: bigint;
  a0: bigint;
  a1: bigint;
  c0: bigint;
  c1: bigint;
  z0: bigint;
  z1: bigint;
}

export interface NonNegativeRangeProof {
  targetCommitment: bigint;
  bitLength: number;
  bitProofs: BitRangeProof[];
  linkNonce: bigint;
  linkResponse: bigint;
}

export interface ConfidentialTransferProof {
  transferId: string;
  senderId: string;
  recipientId: string;
  publicFee: bigint;
  senderOldCommitment: bigint;
  senderNewCommitment: bigint;
  transferCommitment: bigint;
  conservationNonce: bigint;
  conservationChallenge: bigint;
  conservationResponse: bigint;
  transferRangeProof: NonNegativeRangeProof;
  changeRangeProof: NonNegativeRangeProof;
  txDigest: string;
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
  const digest = createHash('sha256').update(`WorkSphere::ConfAssetH|${p.toString(16)}|${g.toString(16)}`).digest('hex');
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
 * Confidential Asset Transfer Prover & Verifier (Mimbelwimble / Confidential Transactions style).
 */
export class ConfidentialAssetTransferProver {
  private readonly p: bigint;
  private readonly q: bigint;
  private readonly g: bigint;
  private readonly h: bigint;
  private readonly gInv: bigint;

  constructor(p = SAFE_PRIME_P, q = SUBGROUP_Q, g = BASE_G) {
    if (p !== 2n * q + 1n) {
      throw new Error('Safe prime invariant p = 2q + 1 is required');
    }
    this.p = p;
    this.q = q;
    this.g = g;
    this.h = deriveH(p, g);
    this.gInv = modInverse(g, p);
  }

  public commit(value: bigint, blinding: bigint): bigint {
    return (
      modPow(this.g, modNorm(value, this.q), this.p) *
      modPow(this.h, modNorm(blinding, this.q), this.p)
    ) % this.p;
  }

  public createAccount(accountId: string, initialBalance: bigint): ConfidentialAccountState {
    if (initialBalance < 0n) {
      throw new RangeError('Initial balance must be non-negative');
    }
    const blinding = randomScalar(this.q);
    return {
      accountId,
      balance: initialBalance,
      blinding,
      commitment: this.commit(initialBalance, blinding),
    };
  }

  private proveBit(bit: 0n | 1n, r: bigint, ctx: string): BitRangeProof {
    const commitment = this.commit(bit, r);
    const w = randomScalar(this.q);
    const simC = randomScalar(this.q);
    const simZ = randomScalar(this.q);

    let a0: bigint, a1: bigint, c0: bigint, c1: bigint, z0: bigint, z1: bigint;

    if (bit === 0n) {
      a0 = modPow(this.h, w, this.p);
      const cOverG = (commitment * this.gInv) % this.p;
      a1 = (modPow(this.h, simZ, this.p) * modPow(cOverG, modNorm(this.q - simC, this.q), this.p)) % this.p;
      const e = hashScalar('WorkSphere::ConfBitOR', [ctx, commitment, a0, a1]);
      c1 = simC;
      c0 = modNorm(e - c1, this.q);
      z0 = modNorm(w + c0 * r, this.q);
      z1 = simZ;
    } else {
      a0 = (modPow(this.h, simZ, this.p) * modPow(commitment, modNorm(this.q - simC, this.q), this.p)) % this.p;
      a1 = modPow(this.h, w, this.p);
      const e = hashScalar('WorkSphere::ConfBitOR', [ctx, commitment, a0, a1]);
      c0 = simC;
      c1 = modNorm(e - c0, this.q);
      z0 = simZ;
      z1 = modNorm(w + c1 * r, this.q);
    }

    return { commitment, a0, a1, c0, c1, z0, z1 };
  }

  private verifyBit(bp: BitRangeProof, ctx: string): boolean {
    const e = hashScalar('WorkSphere::ConfBitOR', [ctx, bp.commitment, bp.a0, bp.a1]);
    if (modNorm(bp.c0 + bp.c1, this.q) !== e) return false;

    const lhs0 = modPow(this.h, bp.z0, this.p);
    const rhs0 = (bp.a0 * modPow(bp.commitment, bp.c0, this.p)) % this.p;
    if (lhs0 !== rhs0) return false;

    const cOverG = (bp.commitment * this.gInv) % this.p;
    const lhs1 = modPow(this.h, bp.z1, this.p);
    const rhs1 = (bp.a1 * modPow(cOverG, bp.c1, this.p)) % this.p;
    return lhs1 === rhs1;
  }

  private proveRange(
    value: bigint,
    blinding: bigint,
    targetCommitment: bigint,
    bitLength: number,
    ctx: string
  ): NonNegativeRangeProof {
    const maxVal = (1n << BigInt(bitLength)) - 1n;
    if (value < 0n || value > maxVal) {
      throw new RangeError(`Value ${value} out of [0, ${maxVal}] range`);
    }

    const bitProofs: BitRangeProof[] = [];
    let weightedBlinding = 0n;

    for (let i = 0; i < bitLength; i++) {
      const bit = ((value >> BigInt(i)) & 1n) === 1n ? 1n : 0n;
      const rBit = randomScalar(this.q);
      bitProofs.push(this.proveBit(bit, rBit, `${ctx}:b:${i}`));
      weightedBlinding = modNorm(weightedBlinding + rBit * (1n << BigInt(i)), this.q);
    }

    const deltaR = modNorm(blinding - weightedBlinding, this.q);
    const k = randomScalar(this.q);
    const linkNonce = modPow(this.h, k, this.p);
    const eLink = hashScalar('WorkSphere::ConfRangeLink', [ctx, targetCommitment, linkNonce]);
    const linkResponse = modNorm(k + eLink * deltaR, this.q);

    return {
      targetCommitment,
      bitLength,
      bitProofs,
      linkNonce,
      linkResponse,
    };
  }

  private verifyRange(rp: NonNegativeRangeProof, expectedCommitment: bigint, ctx: string): boolean {
    if (rp.targetCommitment !== expectedCommitment) return false;
    if (rp.bitProofs.length !== rp.bitLength || rp.bitLength < 1) return false;

    let reconstructed = 1n;
    for (let i = 0; i < rp.bitLength; i++) {
      const bp = rp.bitProofs[i];
      if (!this.verifyBit(bp, `${ctx}:b:${i}`)) return false;
      reconstructed = (reconstructed * modPow(bp.commitment, 1n << BigInt(i), this.p)) % this.p;
    }

    const ratio = (expectedCommitment * modInverse(reconstructed, this.p)) % this.p;
    const eLink = hashScalar('WorkSphere::ConfRangeLink', [ctx, expectedCommitment, rp.linkNonce]);
    const lhs = modPow(this.h, rp.linkResponse, this.p);
    const rhs = (rp.linkNonce * modPow(ratio, eLink, this.p)) % this.p;
    return lhs === rhs;
  }

  /**
   * Executes a confidential transfer from sender to recipient with optional public fee,
   * returning updated confidential states and a publicly verifiable zero-knowledge proof.
   */
  public createConfidentialTransfer(
    transferId: string,
    sender: ConfidentialAccountState,
    recipient: ConfidentialAccountState,
    transferAmount: bigint,
    publicFee = 0n,
    bitLength = 16
  ): {
    proof: ConfidentialTransferProof;
    updatedSender: ConfidentialAccountState;
    updatedRecipient: ConfidentialAccountState;
    transferBlinding: bigint;
  } {
    if (transferAmount < 0n || publicFee < 0n) {
      throw new RangeError('Transfer amount and fee must be non-negative');
    }
    const changeBalance = sender.balance - transferAmount - publicFee;
    if (changeBalance < 0n) {
      throw new Error('Insufficient confidential sender balance');
    }

    const changeBlinding = randomScalar(this.q);
    const transferBlinding = randomScalar(this.q);

    const senderNewCommitment = this.commit(changeBalance, changeBlinding);
    const transferCommitment = this.commit(transferAmount, transferBlinding);

    // Conservation equation: C_old / (C_new * C_tx * g^fee) = h^(r_old - r_new - r_tx)
    const excessBlinding = modNorm(sender.blinding - changeBlinding - transferBlinding, this.q);
    const kCons = randomScalar(this.q);
    const conservationNonce = modPow(this.h, kCons, this.p);
    const conservationChallenge = hashScalar('WorkSphere::ConfConservation', [
      transferId,
      sender.accountId,
      recipient.accountId,
      sender.commitment,
      senderNewCommitment,
      transferCommitment,
      publicFee,
      conservationNonce,
    ]);
    const conservationResponse = modNorm(kCons + conservationChallenge * excessBlinding, this.q);

    const transferRangeProof = this.proveRange(
      transferAmount,
      transferBlinding,
      transferCommitment,
      bitLength,
      `${transferId}:tx`
    );
    const changeRangeProof = this.proveRange(
      changeBalance,
      changeBlinding,
      senderNewCommitment,
      bitLength,
      `${transferId}:chg`
    );

    const txDigest = createHash('sha256')
      .update(
        `${transferId}|${sender.accountId}|${recipient.accountId}|${sender.commitment.toString(16)}|${senderNewCommitment.toString(16)}|${transferCommitment.toString(16)}`
      )
      .digest('hex');

    const updatedSender: ConfidentialAccountState = {
      accountId: sender.accountId,
      balance: changeBalance,
      blinding: changeBlinding,
      commitment: senderNewCommitment,
    };

    // Recipient homomorphically credits their own balance commitment
    const newRecipientBlinding = modNorm(recipient.blinding + transferBlinding, this.q);
    const updatedRecipient: ConfidentialAccountState = {
      accountId: recipient.accountId,
      balance: recipient.balance + transferAmount,
      blinding: newRecipientBlinding,
      commitment: (recipient.commitment * transferCommitment) % this.p,
    };

    return {
      proof: {
        transferId,
        senderId: sender.accountId,
        recipientId: recipient.accountId,
        publicFee,
        senderOldCommitment: sender.commitment,
        senderNewCommitment,
        transferCommitment,
        conservationNonce,
        conservationChallenge,
        conservationResponse,
        transferRangeProof,
        changeRangeProof,
        txDigest,
      },
      updatedSender,
      updatedRecipient,
      transferBlinding,
    };
  }

  /**
   * Publicly verifies a confidential transfer proof without learning sender balance,
   * change balance, or transfer amount.
   */
  public verifyTransferProof(proof: ConfidentialTransferProof): { valid: boolean; reason?: string } {
    if (proof.publicFee < 0n) {
      return { valid: false, reason: 'Negative public fee' };
    }

    const expectedDigest = createHash('sha256')
      .update(
        `${proof.transferId}|${proof.senderId}|${proof.recipientId}|${proof.senderOldCommitment.toString(16)}|${proof.senderNewCommitment.toString(16)}|${proof.transferCommitment.toString(16)}`
      )
      .digest('hex');
    if (expectedDigest !== proof.txDigest) {
      return { valid: false, reason: 'Transaction digest mismatch' };
    }

    const expectedC = hashScalar('WorkSphere::ConfConservation', [
      proof.transferId,
      proof.senderId,
      proof.recipientId,
      proof.senderOldCommitment,
      proof.senderNewCommitment,
      proof.transferCommitment,
      proof.publicFee,
      proof.conservationNonce,
    ]);
    if (expectedC !== proof.conservationChallenge) {
      return { valid: false, reason: 'Conservation proof challenge mismatch' };
    }

    const gFee = modPow(this.g, modNorm(proof.publicFee, this.q), this.p);
    const denom = (((proof.senderNewCommitment * proof.transferCommitment) % this.p) * gFee) % this.p;
    const excessCommit = (proof.senderOldCommitment * modInverse(denom, this.p)) % this.p;

    const lhs = modPow(this.h, proof.conservationResponse, this.p);
    const rhs = (proof.conservationNonce * modPow(excessCommit, proof.conservationChallenge, this.p)) % this.p;
    if (lhs !== rhs) {
      return { valid: false, reason: 'Homomorphic value conservation failed (inflation detected)' };
    }

    if (!this.verifyRange(proof.transferRangeProof, proof.transferCommitment, `${proof.transferId}:tx`)) {
      return { valid: false, reason: 'Transfer amount range proof failed' };
    }

    if (!this.verifyRange(proof.changeRangeProof, proof.senderNewCommitment, `${proof.transferId}:chg`)) {
      return { valid: false, reason: 'Sender change range proof failed' };
    }

    return { valid: true };
  }

  /**
   * Batch-audits a ledger block of confidential transfers and totals all public fees.
   */
  public batchAuditTransfers(proofs: readonly ConfidentialTransferProof[]): {
    allValid: boolean;
    totalPublicFees: bigint;
    verifiedIds: string[];
    failedTransfers: Array<{ transferId: string; reason: string }>;
  } {
    let totalPublicFees = 0n;
    const verifiedIds: string[] = [];
    const failedTransfers: Array<{ transferId: string; reason: string }> = [];

    for (const p of proofs) {
      const res = this.verifyTransferProof(p);
      if (res.valid) {
        verifiedIds.push(p.transferId);
        totalPublicFees += p.publicFee;
      } else {
        failedTransfers.push({ transferId: p.transferId, reason: res.reason ?? 'Unknown error' });
      }
    }

    return {
      allValid: proofs.length > 0 && failedTransfers.length === 0,
      totalPublicFees,
      verifiedIds,
      failedTransfers,
    };
  }

  public serializeTransferProof(proof: ConfidentialTransferProof): string {
    const serRange = (rp: NonNegativeRangeProof) => ({
      targetCommitment: rp.targetCommitment.toString(16),
      bitLength: rp.bitLength,
      linkNonce: rp.linkNonce.toString(16),
      linkResponse: rp.linkResponse.toString(16),
      bitProofs: rp.bitProofs.map((bp) => ({
        commitment: bp.commitment.toString(16),
        a0: bp.a0.toString(16),
        a1: bp.a1.toString(16),
        c0: bp.c0.toString(16),
        c1: bp.c1.toString(16),
        z0: bp.z0.toString(16),
        z1: bp.z1.toString(16),
      })),
    });

    return JSON.stringify({
      transferId: proof.transferId,
      senderId: proof.senderId,
      recipientId: proof.recipientId,
      publicFee: proof.publicFee.toString(),
      senderOldCommitment: proof.senderOldCommitment.toString(16),
      senderNewCommitment: proof.senderNewCommitment.toString(16),
      transferCommitment: proof.transferCommitment.toString(16),
      conservationNonce: proof.conservationNonce.toString(16),
      conservationChallenge: proof.conservationChallenge.toString(16),
      conservationResponse: proof.conservationResponse.toString(16),
      transferRangeProof: serRange(proof.transferRangeProof),
      changeRangeProof: serRange(proof.changeRangeProof),
      txDigest: proof.txDigest,
    });
  }

  public deserializeTransferProof(payload: string): ConfidentialTransferProof {
    const raw = JSON.parse(payload) as Record<string, any>;
    const deserRange = (rp: any): NonNegativeRangeProof => ({
      targetCommitment: BigInt(`0x${rp.targetCommitment}`),
      bitLength: Number(rp.bitLength),
      linkNonce: BigInt(`0x${rp.linkNonce}`),
      linkResponse: BigInt(`0x${rp.linkResponse}`),
      bitProofs: rp.bitProofs.map((bp: Record<string, string>) => ({
        commitment: BigInt(`0x${bp.commitment}`),
        a0: BigInt(`0x${bp.a0}`),
        a1: BigInt(`0x${bp.a1}`),
        c0: BigInt(`0x${bp.c0}`),
        c1: BigInt(`0x${bp.c1}`),
        z0: BigInt(`0x${bp.z0}`),
        z1: BigInt(`0x${bp.z1}`),
      })),
    });

    return {
      transferId: raw.transferId,
      senderId: raw.senderId,
      recipientId: raw.recipientId,
      publicFee: BigInt(raw.publicFee),
      senderOldCommitment: BigInt(`0x${raw.senderOldCommitment}`),
      senderNewCommitment: BigInt(`0x${raw.senderNewCommitment}`),
      transferCommitment: BigInt(`0x${raw.transferCommitment}`),
      conservationNonce: BigInt(`0x${raw.conservationNonce}`),
      conservationChallenge: BigInt(`0x${raw.conservationChallenge}`),
      conservationResponse: BigInt(`0x${raw.conservationResponse}`),
      transferRangeProof: deserRange(raw.transferRangeProof),
      changeRangeProof: deserRange(raw.changeRangeProof),
      txDigest: raw.txDigest,
    };
  }
}
