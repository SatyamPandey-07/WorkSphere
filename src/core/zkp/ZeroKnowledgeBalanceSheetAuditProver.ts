import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Balance Sheet Solvency Audit Prover.
 *
 * Implements a Maxwell-style Proof of Solvency (Assets >= Liabilities) with privacy:
 *  - Every customer liability account i is committed into a Pedersen Merkle Sum Tree:
 *      C_i = g^{liab_i} * h^{r_i} mod P
 *    Each user can independently verify their exact balance is included in the root liability
 *    commitment C_L = prod(C_i) without learning any other user's balance!
 *  - Exchange/custodian commits to total reserves: C_A = g^{assets} * h^{r_A} mod P
 *  - Solvency excess commitment: C_equity = C_A * C_L^{-1} = g^{assets - liabilities} * h^{r_A - r_L}
 *  - Proves assets >= liabilities in zero knowledge via bit-decomposition OR-proofs showing
 *    equity = assets - liabilities >= 0 fits cleanly in unsigned bitLength bits!
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
  const raw = (BigInt('0x' + sha256Hex('ZK-SOLVENCY-BALANCE-SHEET-H-V1').slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
  const qr = (raw * raw) % SAFE_PRIME_P;
  return qr === 1n || qr === BASE_G ? 9n : qr;
}

export const BASE_H = deriveH();
const INV_G = modPow(BASE_G, SAFE_PRIME_P - 2n, SAFE_PRIME_P);

export interface AccountLiabilityEntry {
  accountId: string;
  balance: bigint;
}

interface CommittedAccount extends AccountLiabilityEntry {
  blinding: bigint;
  commitment: bigint;
  leafHash: string;
}

export interface CustomerInclusionProof {
  accountId: string;
  balance: bigint;
  blinding: bigint;
  leafCommitment: bigint;
  siblings: Array<{ direction: 'left' | 'right'; hash: string; commitment: bigint }>;
  liabilityRootHash: string;
  liabilityRootCommitment: bigint;
}

export interface SolvencyBitProof {
  bitCommitment: bigint;
  a0: bigint;
  a1: bigint;
  c0: bigint;
  c1: bigint;
  s0: bigint;
  s1: bigint;
}

export interface SolvencyAuditProof {
  auditEpoch: string;
  accountCount: number;
  assetCommitment: bigint;
  liabilityRootHash: string;
  liabilityRootCommitment: bigint;
  equityCommitment: bigint;
  equityBitLength: number;
  equityBitProofs: SolvencyBitProof[];
}

export class ZeroKnowledgeBalanceSheetAuditProver {
  private accounts: CommittedAccount[] = [];
  private levels: Array<Array<{ hash: string; commitment: bigint }>> = [];

  private hashLeaf(accountId: string, commitment: bigint): string {
    return sha256Hex('SOLVENCY-LEAF-V1', accountId, commitment.toString(16));
  }

  private hashInternal(leftHash: string, rightHash: string, combinedCommitment: bigint): string {
    return sha256Hex('SOLVENCY-NODE-V1', leftHash, rightHash, combinedCommitment.toString(16));
  }

  private commit(val: bigint, blinding?: bigint): { commitment: bigint; blinding: bigint } {
    const r = blinding !== undefined ? modScalar(blinding) : randomScalar();
    const commitment = (modPow(BASE_G, modScalar(val), SAFE_PRIME_P) * modPow(BASE_H, r, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return { commitment, blinding: r };
  }

  private proveBit(bit: 0 | 1, blinding: bigint, tag: string): SolvencyBitProof {
    const bitCommitment = (modPow(BASE_G, BigInt(bit), SAFE_PRIME_P) * modPow(BASE_H, blinding, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const cDivG = (bitCommitment * INV_G) % SAFE_PRIME_P;

    if (bit === 0) {
      const k0 = randomScalar();
      const a0 = modPow(BASE_H, k0, SAFE_PRIME_P);
      const c1 = randomScalar();
      const s1 = randomScalar();
      const a1 = (modPow(BASE_H, s1, SAFE_PRIME_P) * modPow(cDivG, modScalar(SUBGROUP_Q - c1), SAFE_PRIME_P)) % SAFE_PRIME_P;
      const e = hashToScalar('SOLVENCY-BIT-V1', bitCommitment.toString(16), a0.toString(16), a1.toString(16), tag);
      const c0 = modScalar(e - c1);
      const s0 = modScalar(k0 + c0 * blinding);
      return { bitCommitment, a0, a1, c0, c1, s0, s1 };
    } else {
      const c0 = randomScalar();
      const s0 = randomScalar();
      const a0 = (modPow(BASE_H, s0, SAFE_PRIME_P) * modPow(bitCommitment, modScalar(SUBGROUP_Q - c0), SAFE_PRIME_P)) % SAFE_PRIME_P;
      const k1 = randomScalar();
      const a1 = modPow(BASE_H, k1, SAFE_PRIME_P);
      const e = hashToScalar('SOLVENCY-BIT-V1', bitCommitment.toString(16), a0.toString(16), a1.toString(16), tag);
      const c1 = modScalar(e - c0);
      const s1 = modScalar(k1 + c1 * blinding);
      return { bitCommitment, a0, a1, c0, c1, s0, s1 };
    }
  }

  private verifyBit(bp: SolvencyBitProof, tag: string): boolean {
    const e = hashToScalar('SOLVENCY-BIT-V1', bp.bitCommitment.toString(16), bp.a0.toString(16), bp.a1.toString(16), tag);
    if (modScalar(bp.c0 + bp.c1) !== e) return false;
    const ok0 = modPow(BASE_H, bp.s0, SAFE_PRIME_P) === (bp.a0 * modPow(bp.bitCommitment, bp.c0, SAFE_PRIME_P)) % SAFE_PRIME_P;
    if (!ok0) return false;
    const cDivG = (bp.bitCommitment * INV_G) % SAFE_PRIME_P;
    return modPow(BASE_H, bp.s1, SAFE_PRIME_P) === (bp.a1 * modPow(cDivG, bp.c1, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  public buildLiabilityTree(entries: AccountLiabilityEntry[]): { rootHash: string; rootCommitment: bigint } {
    if (entries.length === 0) throw new Error('Liability ledger cannot be empty');
    this.accounts = entries.map((e) => {
      if (e.balance < 0n) throw new RangeError(`Negative liability balance for ${e.accountId}`);
      const { commitment, blinding } = this.commit(e.balance);
      return { ...e, blinding, commitment, leafHash: this.hashLeaf(e.accountId, commitment) };
    });

    // Pad with zero-balance dummy accounts to power of 2 for uniform tree without duplicating real liabilities
    let targetSize = 1;
    while (targetSize < this.accounts.length) targetSize <<= 1;
    const paddedNodes: Array<{ hash: string; commitment: bigint }> = this.accounts.map((a) => ({
      hash: a.leafHash,
      commitment: a.commitment,
    }));
    while (paddedNodes.length < targetSize) {
      const dummyId = `__pad_${paddedNodes.length}`;
      const dummyComm = 1n; // g^0 * h^0 = 1 (zero balance, zero blinding)
      paddedNodes.push({ hash: this.hashLeaf(dummyId, dummyComm), commitment: dummyComm });
    }

    this.levels = [paddedNodes];
    let cur = paddedNodes;
    while (cur.length > 1) {
      const next: Array<{ hash: string; commitment: bigint }> = [];
      for (let i = 0; i < cur.length; i += 2) {
        const combComm = (cur[i].commitment * cur[i + 1].commitment) % SAFE_PRIME_P;
        const hash = this.hashInternal(cur[i].hash, cur[i + 1].hash, combComm);
        next.push({ hash, commitment: combComm });
      }
      this.levels.push(next);
      cur = next;
    }

    return { rootHash: cur[0].hash, rootCommitment: cur[0].commitment };
  }

  public proveCustomerInclusion(accountId: string): CustomerInclusionProof {
    const idx = this.accounts.findIndex((a) => a.accountId === accountId);
    if (idx === -1) throw new Error(`Account "${accountId}" not found in liability tree`);
    const acct = this.accounts[idx];

    const siblings: Array<{ direction: 'left' | 'right'; hash: string; commitment: bigint }> = [];
    let pos = idx;
    for (let lvl = 0; lvl < this.levels.length - 1; lvl++) {
      const isRight = pos % 2 === 1;
      const sib = this.levels[lvl][isRight ? pos - 1 : pos + 1];
      siblings.push({ direction: isRight ? 'left' : 'right', hash: sib.hash, commitment: sib.commitment });
      pos >>= 1;
    }

    const root = this.levels[this.levels.length - 1][0];
    return {
      accountId: acct.accountId,
      balance: acct.balance,
      blinding: acct.blinding,
      leafCommitment: acct.commitment,
      siblings,
      liabilityRootHash: root.hash,
      liabilityRootCommitment: root.commitment,
    };
  }

  public verifyCustomerInclusion(proof: CustomerInclusionProof): boolean {
    const expectedLeafComm = (modPow(BASE_G, modScalar(proof.balance), SAFE_PRIME_P) * modPow(BASE_H, modScalar(proof.blinding), SAFE_PRIME_P)) % SAFE_PRIME_P;
    if (expectedLeafComm !== proof.leafCommitment) return false;

    let curHash = this.hashLeaf(proof.accountId, proof.leafCommitment);
    let curComm = proof.leafCommitment;

    for (const s of proof.siblings) {
      const nextComm = (curComm * s.commitment) % SAFE_PRIME_P;
      curHash = s.direction === 'left'
        ? this.hashInternal(s.hash, curHash, nextComm)
        : this.hashInternal(curHash, s.hash, nextComm);
      curComm = nextComm;
    }

    return curHash === proof.liabilityRootHash && curComm === proof.liabilityRootCommitment;
  }

  public generateSolvencyProof(auditEpoch: string, totalAssets: bigint, equityBitLength = 32): SolvencyAuditProof {
    if (this.levels.length === 0) throw new Error('Build liability tree before generating solvency proof');
    let totalLiabilities = 0n;
    let totalLiabilityBlinding = 0n;
    for (const a of this.accounts) {
      totalLiabilities += a.balance;
      totalLiabilityBlinding = modScalar(totalLiabilityBlinding + a.blinding);
    }

    if (totalAssets < totalLiabilities) {
      throw new Error(`Insolvent balance sheet: assets (${totalAssets}) < liabilities (${totalLiabilities})`);
    }

    const equity = totalAssets - totalLiabilities;
    if (equity >= (1n << BigInt(equityBitLength))) {
      throw new RangeError('Equity exceeds configured equityBitLength');
    }

    const { commitment: assetCommitment, blinding: assetBlinding } = this.commit(totalAssets);
    const root = this.levels[this.levels.length - 1][0];
    const equityBlinding = modScalar(assetBlinding - totalLiabilityBlinding);
    const equityCommitment = (assetCommitment * modPow(root.commitment, SAFE_PRIME_P - 2n, SAFE_PRIME_P)) % SAFE_PRIME_P;

    // Decompose equity into unsigned bits with matching sum of weighted blindings
    const bitBlindings: bigint[] = [];
    let accR = 0n;
    for (let i = 0; i < equityBitLength; i++) {
      if (i < equityBitLength - 1) {
        const ri = randomScalar();
        bitBlindings.push(ri);
        accR = modScalar(accR + (1n << BigInt(i)) * ri);
      } else {
        const invPow2 = modPow((1n << BigInt(i)) % SUBGROUP_Q, SUBGROUP_Q - 2n, SUBGROUP_Q);
        bitBlindings.push(modScalar((equityBlinding - accR) * invPow2));
      }
    }

    const equityBitProofs: SolvencyBitProof[] = [];
    for (let i = 0; i < equityBitLength; i++) {
      const bit = Number((equity >> BigInt(i)) & 1n) as 0 | 1;
      equityBitProofs.push(this.proveBit(bit, bitBlindings[i], `${auditEpoch}:eq-bit-${i}`));
    }

    return {
      auditEpoch,
      accountCount: this.accounts.length,
      assetCommitment,
      liabilityRootHash: root.hash,
      liabilityRootCommitment: root.commitment,
      equityCommitment,
      equityBitLength,
      equityBitProofs,
    };
  }

  public verifySolvencyProof(proof: SolvencyAuditProof): boolean {
    if (proof.equityBitLength < 1 || proof.equityBitProofs.length !== proof.equityBitLength) return false;
    const expectedEquity = (proof.assetCommitment * modPow(proof.liabilityRootCommitment, SAFE_PRIME_P - 2n, SAFE_PRIME_P)) % SAFE_PRIME_P;
    if (expectedEquity !== proof.equityCommitment) return false;

    let reconstructed = 1n;
    for (let i = 0; i < proof.equityBitLength; i++) {
      const bp = proof.equityBitProofs[i];
      if (!this.verifyBit(bp, `${proof.auditEpoch}:eq-bit-${i}`)) return false;
      reconstructed = (reconstructed * modPow(bp.bitCommitment, 1n << BigInt(i), SAFE_PRIME_P)) % SAFE_PRIME_P;
    }
    return reconstructed === proof.equityCommitment;
  }

  public serializeAudit(proof: SolvencyAuditProof): string {
    return JSON.stringify({
      auditEpoch: proof.auditEpoch,
      accountCount: proof.accountCount,
      liabilityRootHash: proof.liabilityRootHash,
      equityBitLength: proof.equityBitLength,
    });
  }
}
