import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Hash+Timelock Escrow Atomic Swap Prover.
 *
 * Implements cryptographic atomic swap contracts (HTLCs) paired with Pedersen confidential
 * amount commitments and Schnorr authorization proofs:
 *  - Party A locks asset A on Chain 1 under hashlock H = SHA-256(preimage) and timelock T_A
 *  - Party B locks asset B on Chain 2 under the SAME hashlock H and shorter timelock T_B < T_A
 *  - Safety invariant verification ensures T_A - T_B >= minSafetyDeltaBlocks so A cannot grief B
 *  - Claiming with preimage reveals the secret atomically to unlock the counterparty leg
 *  - Refunding after timelock expiry requires a valid Schnorr signature + blockHeight >= timelock.
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
  const raw = (BigInt('0x' + sha256Hex('HTLC-ESCROW-H-V1').slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
  const qr = (raw * raw) % SAFE_PRIME_P;
  return qr === 1n || qr === BASE_G ? 9n : qr;
}

export const BASE_H = deriveH();

export interface SwapPartyKeys {
  partyId: string;
  secretKey: bigint;
  publicKey: bigint;
}

export interface HTLCContract {
  contractId: string;
  chain: string;
  senderPubKey: bigint;
  recipientPubKey: bigint;
  amountCommitment: bigint;
  hashlock: string;
  timelockBlock: number;
  contractDigest: string;
  status: 'LOCKED' | 'CLAIMED' | 'REFUNDED';
}

export interface ClaimReceipt {
  contractId: string;
  preimageHex: string;
  claimBlock: number;
  recipientSigR: bigint;
  recipientSigS: bigint;
}

export interface RefundReceipt {
  contractId: string;
  refundBlock: number;
  senderSigR: bigint;
  senderSigS: bigint;
}

export class VerifiableTimelockEscrowSwapProver {
  private contracts = new Map<string, HTLCContract>();

  public generatePartyKeys(partyId: string): SwapPartyKeys {
    const secretKey = randomScalar();
    return { partyId, secretKey, publicKey: modPow(BASE_G, secretKey, SAFE_PRIME_P) };
  }

  public generatePreimageAndLock(): { preimageHex: string; hashlock: string } {
    const preimageHex = randomBytes(32).toString('hex');
    return { preimageHex, hashlock: this.computeHashlock(preimageHex) };
  }

  public computeHashlock(preimageHex: string): string {
    return sha256Hex('HTLC-HASHLOCK-V1', preimageHex);
  }

  public commitAmount(amount: bigint, blinding?: bigint): { commitment: bigint; blinding: bigint } {
    if (amount <= 0n) throw new RangeError('Escrow amount must be positive');
    const r = blinding !== undefined ? modScalar(blinding) : randomScalar();
    return {
      commitment: (modPow(BASE_G, modScalar(amount), SAFE_PRIME_P) * modPow(BASE_H, r, SAFE_PRIME_P)) % SAFE_PRIME_P,
      blinding: r,
    };
  }

  private sign(secretKey: bigint, publicKey: bigint, msg: string): { R: bigint; s: bigint } {
    const k = randomScalar();
    const R = modPow(BASE_G, k, SAFE_PRIME_P);
    const c = hashToScalar('HTLC-SIG-V1', R.toString(16), publicKey.toString(16), msg);
    return { R, s: modScalar(k + c * secretKey) };
  }

  private verifySig(publicKey: bigint, msg: string, R: bigint, s: bigint): boolean {
    const c = hashToScalar('HTLC-SIG-V1', R.toString(16), publicKey.toString(16), msg);
    return modPow(BASE_G, s, SAFE_PRIME_P) === (R * modPow(publicKey, c, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  public createContract(params: {
    contractId: string;
    chain: string;
    senderPubKey: bigint;
    recipientPubKey: bigint;
    amountCommitment: bigint;
    hashlock: string;
    timelockBlock: number;
  }): HTLCContract {
    if (this.contracts.has(params.contractId)) {
      throw new Error(`Contract "${params.contractId}" already exists`);
    }
    const contractDigest = sha256Hex(
      'HTLC-CONTRACT-V1',
      params.contractId,
      params.chain,
      params.senderPubKey.toString(16),
      params.recipientPubKey.toString(16),
      params.amountCommitment.toString(16),
      params.hashlock,
      String(params.timelockBlock),
    );
    const contract: HTLCContract = { ...params, contractDigest, status: 'LOCKED' };
    this.contracts.set(params.contractId, contract);
    return { ...contract };
  }

  public verifySwapPairSafety(
    initiatorContract: HTLCContract,
    responderContract: HTLCContract,
    minSafetyDeltaBlocks = 12,
  ): { safe: boolean; reason?: string } {
    if (initiatorContract.hashlock !== responderContract.hashlock) {
      return { safe: false, reason: 'Hashlock mismatch between swap legs' };
    }
    if (initiatorContract.chain === responderContract.chain) {
      return { safe: false, reason: 'Atomic swap legs should span distinct settlement domains' };
    }
    if (
      initiatorContract.senderPubKey !== responderContract.recipientPubKey ||
      initiatorContract.recipientPubKey !== responderContract.senderPubKey
    ) {
      return { safe: false, reason: 'Counterparty public keys do not mirror across legs' };
    }
    if (initiatorContract.timelockBlock - responderContract.timelockBlock < minSafetyDeltaBlocks) {
      return { safe: false, reason: 'Insufficient timelock safety margin between initiator and responder' };
    }
    return { safe: true };
  }

  public claim(contractId: string, recipientKeys: SwapPartyKeys, preimageHex: string, claimBlock: number): ClaimReceipt {
    const contract = this.contracts.get(contractId);
    if (!contract) throw new Error(`Unknown contract ${contractId}`);
    if (contract.status !== 'LOCKED') throw new Error(`Contract ${contractId} is not LOCKED`);
    if (claimBlock >= contract.timelockBlock) throw new Error('Cannot claim after timelock expiry');
    if (this.computeHashlock(preimageHex) !== contract.hashlock) throw new Error('Invalid hashlock preimage');

    const msg = sha256Hex('HTLC-CLAIM', contract.contractDigest, preimageHex, String(claimBlock));
    const sig = this.sign(recipientKeys.secretKey, recipientKeys.publicKey, msg);
    if (!this.verifySig(contract.recipientPubKey, msg, sig.R, sig.s)) {
      throw new Error('Claimant keys do not match contract recipient');
    }

    contract.status = 'CLAIMED';
    return { contractId, preimageHex, claimBlock, recipientSigR: sig.R, recipientSigS: sig.s };
  }

  public verifyClaimReceipt(contract: HTLCContract, receipt: ClaimReceipt): boolean {
    if (receipt.contractId !== contract.contractId) return false;
    if (receipt.claimBlock >= contract.timelockBlock) return false;
    if (this.computeHashlock(receipt.preimageHex) !== contract.hashlock) return false;
    const msg = sha256Hex('HTLC-CLAIM', contract.contractDigest, receipt.preimageHex, String(receipt.claimBlock));
    return this.verifySig(contract.recipientPubKey, msg, receipt.recipientSigR, receipt.recipientSigS);
  }

  public refund(contractId: string, senderKeys: SwapPartyKeys, refundBlock: number): RefundReceipt {
    const contract = this.contracts.get(contractId);
    if (!contract) throw new Error(`Unknown contract ${contractId}`);
    if (contract.status !== 'LOCKED') throw new Error(`Contract ${contractId} is not LOCKED`);
    if (refundBlock < contract.timelockBlock) throw new Error('Cannot refund before timelock expiry');

    const msg = sha256Hex('HTLC-REFUND', contract.contractDigest, String(refundBlock));
    const sig = this.sign(senderKeys.secretKey, senderKeys.publicKey, msg);
    if (!this.verifySig(contract.senderPubKey, msg, sig.R, sig.s)) {
      throw new Error('Refunder keys do not match contract sender');
    }

    contract.status = 'REFUNDED';
    return { contractId, refundBlock, senderSigR: sig.R, senderSigS: sig.s };
  }

  public verifyRefundReceipt(contract: HTLCContract, receipt: RefundReceipt): boolean {
    if (receipt.contractId !== contract.contractId) return false;
    if (receipt.refundBlock < contract.timelockBlock) return false;
    const msg = sha256Hex('HTLC-REFUND', contract.contractDigest, String(receipt.refundBlock));
    return this.verifySig(contract.senderPubKey, msg, receipt.senderSigR, receipt.senderSigS);
  }

  public serializeContract(contract: HTLCContract): string {
    return JSON.stringify({
      contractId: contract.contractId,
      chain: contract.chain,
      hashlock: contract.hashlock,
      timelockBlock: contract.timelockBlock,
      status: contract.status,
    });
  }
}
