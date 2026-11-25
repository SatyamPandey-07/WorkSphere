import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Multi-Milestone Escrow Release & Conservation Prover.
 *
 * Implements staged confidential milestone disbursements backed by Pedersen balance
 * commitments and M-of-N arbiter Schnorr attestations:
 *  - Depositor locks total funds T into Pedersen commitment C_0 = g^T * h^{r_0}.
 *  - Escrow defines ordered milestones M_1, ..., M_k with hidden/committed release amounts.
 *  - Each milestone release requires >= arbiterQuorum valid Schnorr approvals over the
 *    milestone deliverable hash, emits a Pedersen balance-conservation transition proof:
 *      C_{prev} == C_{release} * C_{remaining}   (homomorphic zero-opening check)
 *    and proves remaining balance >= 0 via unsigned bit-decomposition!
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
  const raw = (BigInt('0x' + sha256Hex('ESCROW-MILESTONE-H-V1').slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
  const qr = (raw * raw) % SAFE_PRIME_P;
  return qr === 1n || qr === BASE_G ? 9n : qr;
}

export const BASE_H = deriveH();
const INV_G = modPow(BASE_G, SAFE_PRIME_P - 2n, SAFE_PRIME_P);

export interface ArbiterKeys {
  arbiterId: string;
  secretKey: bigint;
  publicKey: bigint;
}

export interface EscrowBitProof {
  bitCommitment: bigint;
  a0: bigint;
  a1: bigint;
  c0: bigint;
  c1: bigint;
  s0: bigint;
  s1: bigint;
}

export interface NonNegativeProof {
  commitment: bigint;
  bitLength: number;
  bits: EscrowBitProof[];
}

export interface ArbiterAttestation {
  arbiterId: string;
  milestoneId: string;
  deliverableHash: string;
  sigR: bigint;
  sigS: bigint;
}

export interface MilestoneReleaseCertificate {
  escrowId: string;
  milestoneIndex: number;
  milestoneId: string;
  deliverableHash: string;
  previousBalanceComm: bigint;
  releaseAmountComm: bigint;
  remainingBalanceComm: bigint;
  conservationAnnounceR: bigint;
  conservationChallenge: bigint;
  conservationResponseR: bigint;
  releaseNonNegProof: NonNegativeProof;
  remainingNonNegProof: NonNegativeProof;
  arbiterAttestations: ArbiterAttestation[];
}

export interface EscrowVaultState {
  escrowId: string;
  arbiterQuorum: number;
  arbiters: Array<{ arbiterId: string; publicKey: bigint }>;
  initialDepositComm: bigint;
  currentBalance: bigint;
  currentBlinding: bigint;
  currentBalanceComm: bigint;
  completedMilestones: number;
  bitLength: number;
}

export class VerifiableEscrowMilestoneReleaseProver {
  public createArbiter(arbiterId: string): ArbiterKeys {
    const secretKey = randomScalar();
    return { arbiterId, secretKey, publicKey: modPow(BASE_G, secretKey, SAFE_PRIME_P) };
  }

  private commit(val: bigint, blinding?: bigint): { commitment: bigint; blinding: bigint } {
    const r = blinding !== undefined ? modScalar(blinding) : randomScalar();
    return {
      commitment: (modPow(BASE_G, modScalar(val), SAFE_PRIME_P) * modPow(BASE_H, r, SAFE_PRIME_P)) % SAFE_PRIME_P,
      blinding: r,
    };
  }

  private proveBit(bit: 0 | 1, blinding: bigint, tag: string): EscrowBitProof {
    const bitCommitment = (modPow(BASE_G, BigInt(bit), SAFE_PRIME_P) * modPow(BASE_H, blinding, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const cDivG = (bitCommitment * INV_G) % SAFE_PRIME_P;
    if (bit === 0) {
      const k0 = randomScalar();
      const a0 = modPow(BASE_H, k0, SAFE_PRIME_P);
      const c1 = randomScalar();
      const s1 = randomScalar();
      const a1 = (modPow(BASE_H, s1, SAFE_PRIME_P) * modPow(cDivG, modScalar(SUBGROUP_Q - c1), SAFE_PRIME_P)) % SAFE_PRIME_P;
      const e = hashToScalar('ESCROW-BIT-V1', bitCommitment.toString(16), a0.toString(16), a1.toString(16), tag);
      const c0 = modScalar(e - c1);
      const s0 = modScalar(k0 + c0 * blinding);
      return { bitCommitment, a0, a1, c0, c1, s0, s1 };
    } else {
      const c0 = randomScalar();
      const s0 = randomScalar();
      const a0 = (modPow(BASE_H, s0, SAFE_PRIME_P) * modPow(bitCommitment, modScalar(SUBGROUP_Q - c0), SAFE_PRIME_P)) % SAFE_PRIME_P;
      const k1 = randomScalar();
      const a1 = modPow(BASE_H, k1, SAFE_PRIME_P);
      const e = hashToScalar('ESCROW-BIT-V1', bitCommitment.toString(16), a0.toString(16), a1.toString(16), tag);
      const c1 = modScalar(e - c0);
      const s1 = modScalar(k1 + c1 * blinding);
      return { bitCommitment, a0, a1, c0, c1, s0, s1 };
    }
  }

  private verifyBit(bp: EscrowBitProof, tag: string): boolean {
    const e = hashToScalar('ESCROW-BIT-V1', bp.bitCommitment.toString(16), bp.a0.toString(16), bp.a1.toString(16), tag);
    if (modScalar(bp.c0 + bp.c1) !== e) return false;
    if (modPow(BASE_H, bp.s0, SAFE_PRIME_P) !== (bp.a0 * modPow(bp.bitCommitment, bp.c0, SAFE_PRIME_P)) % SAFE_PRIME_P) return false;
    const cDivG = (bp.bitCommitment * INV_G) % SAFE_PRIME_P;
    return modPow(BASE_H, bp.s1, SAFE_PRIME_P) === (bp.a1 * modPow(cDivG, bp.c1, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  private proveNonNeg(val: bigint, blinding: bigint, bitLength: number, tag: string): NonNegativeProof {
    if (val < 0n || val >= (1n << BigInt(bitLength))) throw new RangeError('Value out of unsigned range');
    const commitment = (modPow(BASE_G, val, SAFE_PRIME_P) * modPow(BASE_H, blinding, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const blindings: bigint[] = [];
    let acc = 0n;
    for (let i = 0; i < bitLength; i++) {
      if (i < bitLength - 1) {
        const ri = randomScalar();
        blindings.push(ri);
        acc = modScalar(acc + (1n << BigInt(i)) * ri);
      } else {
        const invPow2 = modPow((1n << BigInt(i)) % SUBGROUP_Q, SUBGROUP_Q - 2n, SUBGROUP_Q);
        blindings.push(modScalar((blinding - acc) * invPow2));
      }
    }
    const bits = Array.from({ length: bitLength }, (_, i) =>
      this.proveBit(Number((val >> BigInt(i)) & 1n) as 0 | 1, blindings[i], `${tag}:b${i}`),
    );
    return { commitment, bitLength, bits };
  }

  private verifyNonNeg(p: NonNegativeProof, tag: string): boolean {
    if (p.bitLength < 1 || p.bits.length !== p.bitLength) return false;
    let acc = 1n;
    for (let i = 0; i < p.bitLength; i++) {
      if (!this.verifyBit(p.bits[i], `${tag}:b${i}`)) return false;
      acc = (acc * modPow(p.bits[i].bitCommitment, 1n << BigInt(i), SAFE_PRIME_P)) % SAFE_PRIME_P;
    }
    return acc === p.commitment;
  }

  public openEscrow(
    escrowId: string,
    totalDeposit: bigint,
    arbiters: Array<Pick<ArbiterKeys, 'arbiterId' | 'publicKey'>>,
    arbiterQuorum: number,
    bitLength = 16,
  ): EscrowVaultState {
    if (arbiterQuorum < 1 || arbiterQuorum > arbiters.length) throw new RangeError('Invalid arbiter quorum');
    if (totalDeposit <= 0n || totalDeposit >= (1n << BigInt(bitLength))) throw new RangeError('Deposit out of bounds');
    const { commitment, blinding } = this.commit(totalDeposit);
    return {
      escrowId,
      arbiterQuorum,
      arbiters: arbiters.map(({ arbiterId, publicKey }) => ({ arbiterId, publicKey })),
      initialDepositComm: commitment,
      currentBalance: totalDeposit,
      currentBlinding: blinding,
      currentBalanceComm: commitment,
      completedMilestones: 0,
      bitLength,
    };
  }

  public attestMilestone(
    arbiter: ArbiterKeys,
    escrowId: string,
    milestoneId: string,
    deliverableHash: string,
    releaseAmountComm: bigint,
  ): ArbiterAttestation {
    const msg = sha256Hex('ESCROW-ATTEST-V1', escrowId, milestoneId, deliverableHash, releaseAmountComm.toString(16));
    const k = randomScalar();
    const sigR = modPow(BASE_G, k, SAFE_PRIME_P);
    const c = hashToScalar('ESCROW-ARB-SIG-V1', sigR.toString(16), arbiter.publicKey.toString(16), msg);
    return { arbiterId: arbiter.arbiterId, milestoneId, deliverableHash, sigR, sigS: modScalar(k + c * arbiter.secretKey) };
  }

  public verifyAttestation(
    arbiterPubKey: bigint,
    escrowId: string,
    releaseAmountComm: bigint,
    att: ArbiterAttestation,
  ): boolean {
    const msg = sha256Hex('ESCROW-ATTEST-V1', escrowId, att.milestoneId, att.deliverableHash, releaseAmountComm.toString(16));
    const c = hashToScalar('ESCROW-ARB-SIG-V1', att.sigR.toString(16), arbiterPubKey.toString(16), msg);
    return modPow(BASE_G, att.sigS, SAFE_PRIME_P) === (att.sigR * modPow(arbiterPubKey, c, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  public releaseMilestone(
    vault: EscrowVaultState,
    milestoneId: string,
    deliverableHash: string,
    releaseAmount: bigint,
    signingArbiters: ArbiterKeys[],
  ): { certificate: MilestoneReleaseCertificate; nextVault: EscrowVaultState } {
    if (releaseAmount <= 0n || releaseAmount > vault.currentBalance) {
      throw new RangeError(`Release amount ${releaseAmount} exceeds remaining balance ${vault.currentBalance}`);
    }

    const rel = this.commit(releaseAmount);
    const remVal = vault.currentBalance - releaseAmount;
    const rem = this.commit(remVal);

    const milestoneIndex = vault.completedMilestones;
    const arbMap = new Map(vault.arbiters.map((a) => [a.arbiterId, a.publicKey]));
    const seen = new Set<string>();
    const arbiterAttestations: ArbiterAttestation[] = [];

    for (const arb of signingArbiters) {
      const regPub = arbMap.get(arb.arbiterId);
      if (!regPub || regPub !== arb.publicKey || seen.has(arb.arbiterId)) continue;
      seen.add(arb.arbiterId);
      arbiterAttestations.push(this.attestMilestone(arb, vault.escrowId, milestoneId, deliverableHash, rel.commitment));
    }

    if (arbiterAttestations.length < vault.arbiterQuorum) {
      throw new Error(`Insufficient arbiter attestations: ${arbiterAttestations.length} < ${vault.arbiterQuorum}`);
    }

    // Conservation: prevComm * (relComm * remComm)^{-1} == h^{rPrev - rRel - rRem}
    const deltaR = modScalar(vault.currentBlinding - rel.blinding - rem.blinding);
    const k = randomScalar();
    const conservationAnnounceR = modPow(BASE_H, k, SAFE_PRIME_P);
    const conservationChallenge = hashToScalar(
      'ESCROW-CONSERVE-V1',
      vault.escrowId,
      String(milestoneIndex),
      milestoneId,
      vault.currentBalanceComm.toString(16),
      rel.commitment.toString(16),
      rem.commitment.toString(16),
      conservationAnnounceR.toString(16),
    );
    const conservationResponseR = modScalar(k + conservationChallenge * deltaR);

    const certificate: MilestoneReleaseCertificate = {
      escrowId: vault.escrowId,
      milestoneIndex,
      milestoneId,
      deliverableHash,
      previousBalanceComm: vault.currentBalanceComm,
      releaseAmountComm: rel.commitment,
      remainingBalanceComm: rem.commitment,
      conservationAnnounceR,
      conservationChallenge,
      conservationResponseR,
      releaseNonNegProof: this.proveNonNeg(releaseAmount, rel.blinding, vault.bitLength, `${vault.escrowId}:${milestoneId}:rel`),
      remainingNonNegProof: this.proveNonNeg(remVal, rem.blinding, vault.bitLength, `${vault.escrowId}:${milestoneId}:rem`),
      arbiterAttestations,
    };

    const nextVault: EscrowVaultState = {
      ...vault,
      currentBalance: remVal,
      currentBlinding: rem.blinding,
      currentBalanceComm: rem.commitment,
      completedMilestones: milestoneIndex + 1,
    };

    return { certificate, nextVault };
  }

  public verifyReleaseCertificate(vaultConfig: Pick<EscrowVaultState, 'escrowId' | 'arbiters' | 'arbiterQuorum'>, cert: MilestoneReleaseCertificate): boolean {
    if (cert.escrowId !== vaultConfig.escrowId) return false;
    const arbMap = new Map(vaultConfig.arbiters.map((a) => [a.arbiterId, a.publicKey]));
    const seen = new Set<string>();
    for (const att of cert.arbiterAttestations) {
      const pub = arbMap.get(att.arbiterId);
      if (!pub || seen.has(att.arbiterId) || att.milestoneId !== cert.milestoneId || att.deliverableHash !== cert.deliverableHash) {
        return false;
      }
      if (!this.verifyAttestation(pub, cert.escrowId, cert.releaseAmountComm, att)) return false;
      seen.add(att.arbiterId);
    }
    if (seen.size < vaultConfig.arbiterQuorum) return false;

    const expectedC = hashToScalar(
      'ESCROW-CONSERVE-V1',
      cert.escrowId,
      String(cert.milestoneIndex),
      cert.milestoneId,
      cert.previousBalanceComm.toString(16),
      cert.releaseAmountComm.toString(16),
      cert.remainingBalanceComm.toString(16),
      cert.conservationAnnounceR.toString(16),
    );
    if (expectedC !== cert.conservationChallenge) return false;

    const invSum = modPow((cert.releaseAmountComm * cert.remainingBalanceComm) % SAFE_PRIME_P, SAFE_PRIME_P - 2n, SAFE_PRIME_P);
    const target = (cert.previousBalanceComm * invSum) % SAFE_PRIME_P;
    if (modPow(BASE_H, cert.conservationResponseR, SAFE_PRIME_P) !== (cert.conservationAnnounceR * modPow(target, cert.conservationChallenge, SAFE_PRIME_P)) % SAFE_PRIME_P) {
      return false;
    }

    if (cert.releaseNonNegProof.commitment !== cert.releaseAmountComm || !this.verifyNonNeg(cert.releaseNonNegProof, `${cert.escrowId}:${cert.milestoneId}:rel`)) {
      return false;
    }
    if (cert.remainingNonNegProof.commitment !== cert.remainingBalanceComm || !this.verifyNonNeg(cert.remainingNonNegProof, `${cert.escrowId}:${cert.milestoneId}:rem`)) {
      return false;
    }
    return true;
  }

  public verifyReleaseChain(
    vaultConfig: Pick<EscrowVaultState, 'escrowId' | 'arbiters' | 'arbiterQuorum' | 'initialDepositComm'>,
    certs: MilestoneReleaseCertificate[],
  ): boolean {
    if (certs.length === 0) return false;
    let expectedPrev = vaultConfig.initialDepositComm;
    for (let i = 0; i < certs.length; i++) {
      const c = certs[i];
      if (c.milestoneIndex !== i || c.previousBalanceComm !== expectedPrev) return false;
      if (!this.verifyReleaseCertificate(vaultConfig, c)) return false;
      expectedPrev = c.remainingBalanceComm;
    }
    return true;
  }

  public serializeCertificate(cert: MilestoneReleaseCertificate): string {
    return JSON.stringify({
      escrowId: cert.escrowId,
      milestoneIndex: cert.milestoneIndex,
      milestoneId: cert.milestoneId,
      arbiterCount: cert.arbiterAttestations.length,
    });
  }
}
