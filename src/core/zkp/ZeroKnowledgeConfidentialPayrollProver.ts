import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Confidential Payroll & Tax Withholding Audit Prover.
 *
 * Allows an employer to prove payroll regulatory compliance WITHOUT exposing any employee's
 * individual salary to public auditors or coworkers:
 *  - For each employee i, commits to (gross_i, tax_i, net_i) via hiding Pedersen commitments:
 *      C_gross_i, C_tax_i, C_net_i
 *  - Proves per-employee accounting identity: gross_i == tax_i + net_i (homomorphic zero opening)
 *  - Proves per-employee salary band compliance: minSalary <= gross_i <= maxSalary via
 *    bit-decomposition OR-proofs!
 *  - Proves aggregate treasury reconciliation:
 *      sum(gross_i) == totalTreasuryDisbursement   AND   sum(tax_i) == totalTaxRemittance
 *    so tax authorities & treasury auditors verify 100% penny-exact compliance with ZERO salary leakage!
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
  const raw = (BigInt('0x' + sha256Hex('ZK-CONFIDENTIAL-PAYROLL-H-V1').slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
  const qr = (raw * raw) % SAFE_PRIME_P;
  return qr === 1n || qr === BASE_G ? 9n : qr;
}

export const BASE_H = deriveH();
const INV_G = modPow(BASE_G, SAFE_PRIME_P - 2n, SAFE_PRIME_P);

export interface EmployeePayrollInput {
  employeeId: string;
  grossPay: bigint;
  taxWithheld: bigint;
  netPay: bigint;
}

export interface PayrollBitProof {
  bitCommitment: bigint;
  a0: bigint;
  a1: bigint;
  c0: bigint;
  c1: bigint;
  s0: bigint;
  s1: bigint;
}

export interface BandGapProof {
  commitment: bigint;
  bitLength: number;
  bits: PayrollBitProof[];
}

export interface ZeroOpeningProof {
  announcementR: bigint;
  challenge: bigint;
  responseBlinding: bigint;
}

export interface EmployeePayrollProof {
  employeeId: string;
  grossComm: bigint;
  taxComm: bigint;
  netComm: bigint;
  balanceIdentityProof: ZeroOpeningProof; // proves gross == tax + net
  minBandProof: BandGapProof;             // proves gross - minSalary >= 0
  maxBandProof: BandGapProof;             // proves maxSalary - gross >= 0
}

export interface ConfidentialPayrollAuditBundle {
  payrollPeriod: string;
  minSalary: bigint;
  maxSalary: bigint;
  totalGrossDisbursed: bigint;
  totalTaxRemitted: bigint;
  totalNetPaid: bigint;
  employeeProofs: EmployeePayrollProof[];
  grossAggregateOpening: ZeroOpeningProof;
  taxAggregateOpening: ZeroOpeningProof;
  netAggregateOpening: ZeroOpeningProof;
}

export class ZeroKnowledgeConfidentialPayrollProver {
  private commit(val: bigint, blinding?: bigint): { commitment: bigint; blinding: bigint } {
    const r = blinding !== undefined ? modScalar(blinding) : randomScalar();
    const commitment = (modPow(BASE_G, modScalar(val), SAFE_PRIME_P) * modPow(BASE_H, r, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return { commitment, blinding: r };
  }

  private proveZeroOpening(targetComm: bigint, secretBlinding: bigint, tag: string): ZeroOpeningProof {
    const k = randomScalar();
    const announcementR = modPow(BASE_H, k, SAFE_PRIME_P);
    const challenge = hashToScalar('PAYROLL-ZERO-V1', tag, targetComm.toString(16), announcementR.toString(16));
    return { announcementR, challenge, responseBlinding: modScalar(k + challenge * secretBlinding) };
  }

  private verifyZeroOpening(targetComm: bigint, proof: ZeroOpeningProof, tag: string): boolean {
    const expectedC = hashToScalar('PAYROLL-ZERO-V1', tag, targetComm.toString(16), proof.announcementR.toString(16));
    if (expectedC !== proof.challenge) return false;
    return modPow(BASE_H, proof.responseBlinding, SAFE_PRIME_P) ===
      (proof.announcementR * modPow(targetComm, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  private proveBit(bit: 0 | 1, blinding: bigint, tag: string): PayrollBitProof {
    const bitCommitment = (modPow(BASE_G, BigInt(bit), SAFE_PRIME_P) * modPow(BASE_H, blinding, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const cDivG = (bitCommitment * INV_G) % SAFE_PRIME_P;
    if (bit === 0) {
      const k0 = randomScalar();
      const a0 = modPow(BASE_H, k0, SAFE_PRIME_P);
      const c1 = randomScalar();
      const s1 = randomScalar();
      const a1 = (modPow(BASE_H, s1, SAFE_PRIME_P) * modPow(cDivG, modScalar(SUBGROUP_Q - c1), SAFE_PRIME_P)) % SAFE_PRIME_P;
      const e = hashToScalar('PAYROLL-BIT-V1', bitCommitment.toString(16), a0.toString(16), a1.toString(16), tag);
      const c0 = modScalar(e - c1);
      const s0 = modScalar(k0 + c0 * blinding);
      return { bitCommitment, a0, a1, c0, c1, s0, s1 };
    } else {
      const c0 = randomScalar();
      const s0 = randomScalar();
      const a0 = (modPow(BASE_H, s0, SAFE_PRIME_P) * modPow(bitCommitment, modScalar(SUBGROUP_Q - c0), SAFE_PRIME_P)) % SAFE_PRIME_P;
      const k1 = randomScalar();
      const a1 = modPow(BASE_H, k1, SAFE_PRIME_P);
      const e = hashToScalar('PAYROLL-BIT-V1', bitCommitment.toString(16), a0.toString(16), a1.toString(16), tag);
      const c1 = modScalar(e - c0);
      const s1 = modScalar(k1 + c1 * blinding);
      return { bitCommitment, a0, a1, c0, c1, s0, s1 };
    }
  }

  private verifyBit(bp: PayrollBitProof, tag: string): boolean {
    const e = hashToScalar('PAYROLL-BIT-V1', bp.bitCommitment.toString(16), bp.a0.toString(16), bp.a1.toString(16), tag);
    if (modScalar(bp.c0 + bp.c1) !== e) return false;
    if (modPow(BASE_H, bp.s0, SAFE_PRIME_P) !== (bp.a0 * modPow(bp.bitCommitment, bp.c0, SAFE_PRIME_P)) % SAFE_PRIME_P) return false;
    const cDivG = (bp.bitCommitment * INV_G) % SAFE_PRIME_P;
    return modPow(BASE_H, bp.s1, SAFE_PRIME_P) === (bp.a1 * modPow(cDivG, bp.c1, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  private proveGap(val: bigint, blinding: bigint, bitLength: number, tag: string): BandGapProof {
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
    const bits: PayrollBitProof[] = [];
    for (let i = 0; i < bitLength; i++) {
      bits.push(this.proveBit(Number((val >> BigInt(i)) & 1n) as 0 | 1, blindings[i], `${tag}:b${i}`));
    }
    return { commitment, bitLength, bits };
  }

  private verifyGap(proof: BandGapProof, tag: string): boolean {
    if (proof.bitLength < 1 || proof.bits.length !== proof.bitLength) return false;
    let acc = 1n;
    for (let i = 0; i < proof.bitLength; i++) {
      if (!this.verifyBit(proof.bits[i], `${tag}:b${i}`)) return false;
      acc = (acc * modPow(proof.bits[i].bitCommitment, 1n << BigInt(i), SAFE_PRIME_P)) % SAFE_PRIME_P;
    }
    return acc === proof.commitment;
  }

  public generatePayrollAudit(
    payrollPeriod: string,
    employees: EmployeePayrollInput[],
    minSalary: bigint,
    maxSalary: bigint,
  ): ConfidentialPayrollAuditBundle {
    if (employees.length === 0) throw new Error('Payroll roster cannot be empty');
    if (minSalary < 0n || minSalary > maxSalary) throw new RangeError('Invalid salary band');

    const bandSpan = maxSalary - minSalary;
    const bandBits = bandSpan <= 0n ? 1 : bandSpan.toString(2).length;
    const seen = new Set<string>();

    let totalGross = 0n;
    let totalTax = 0n;
    let totalNet = 0n;
    let sumGrossR = 0n;
    let sumTaxR = 0n;
    let sumNetR = 0n;
    let prodGrossC = 1n;
    let prodTaxC = 1n;
    let prodNetC = 1n;

    const employeeProofs: EmployeePayrollProof[] = [];

    for (const emp of employees) {
      if (seen.has(emp.employeeId)) throw new Error(`Duplicate employeeId "${emp.employeeId}"`);
      seen.add(emp.employeeId);
      if (emp.taxWithheld < 0n || emp.netPay < 0n || emp.grossPay !== emp.taxWithheld + emp.netPay) {
        throw new Error(`Accounting mismatch for employee "${emp.employeeId}": gross != tax + net`);
      }
      if (emp.grossPay < minSalary || emp.grossPay > maxSalary) {
        throw new RangeError(`Employee "${emp.employeeId}" grossPay outside [${minSalary}, ${maxSalary}]`);
      }

      const gC = this.commit(emp.grossPay);
      const tC = this.commit(emp.taxWithheld);
      const nC = this.commit(emp.netPay);

      // gross - tax - net == 0  =>  C_gross * C_tax^{-1} * C_net^{-1} = h^{rG - rT - rN}
      const invTN = modPow((tC.commitment * nC.commitment) % SAFE_PRIME_P, SAFE_PRIME_P - 2n, SAFE_PRIME_P);
      const idTarget = (gC.commitment * invTN) % SAFE_PRIME_P;
      const balanceIdentityProof = this.proveZeroOpening(
        idTarget,
        modScalar(gC.blinding - tC.blinding - nC.blinding),
        `${payrollPeriod}:${emp.employeeId}:bal`,
      );

      const minBandProof = this.proveGap(emp.grossPay - minSalary, gC.blinding, bandBits, `${payrollPeriod}:${emp.employeeId}:min`);
      const maxBandProof = this.proveGap(
        maxSalary - emp.grossPay,
        modScalar(SUBGROUP_Q - gC.blinding),
        bandBits,
        `${payrollPeriod}:${emp.employeeId}:max`,
      );

      employeeProofs.push({
        employeeId: emp.employeeId,
        grossComm: gC.commitment,
        taxComm: tC.commitment,
        netComm: nC.commitment,
        balanceIdentityProof,
        minBandProof,
        maxBandProof,
      });

      totalGross += emp.grossPay;
      totalTax += emp.taxWithheld;
      totalNet += emp.netPay;
      sumGrossR = modScalar(sumGrossR + gC.blinding);
      sumTaxR = modScalar(sumTaxR + tC.blinding);
      sumNetR = modScalar(sumNetR + nC.blinding);
      prodGrossC = (prodGrossC * gC.commitment) % SAFE_PRIME_P;
      prodTaxC = (prodTaxC * tC.commitment) % SAFE_PRIME_P;
      prodNetC = (prodNetC * nC.commitment) % SAFE_PRIME_P;
    }

    const grossTarget = (prodGrossC * modPow(BASE_G, modScalar(SUBGROUP_Q - modScalar(totalGross)), SAFE_PRIME_P)) % SAFE_PRIME_P;
    const taxTarget = (prodTaxC * modPow(BASE_G, modScalar(SUBGROUP_Q - modScalar(totalTax)), SAFE_PRIME_P)) % SAFE_PRIME_P;
    const netTarget = (prodNetC * modPow(BASE_G, modScalar(SUBGROUP_Q - modScalar(totalNet)), SAFE_PRIME_P)) % SAFE_PRIME_P;

    return {
      payrollPeriod,
      minSalary,
      maxSalary,
      totalGrossDisbursed: totalGross,
      totalTaxRemitted: totalTax,
      totalNetPaid: totalNet,
      employeeProofs,
      grossAggregateOpening: this.proveZeroOpening(grossTarget, sumGrossR, `${payrollPeriod}:agg:gross`),
      taxAggregateOpening: this.proveZeroOpening(taxTarget, sumTaxR, `${payrollPeriod}:agg:tax`),
      netAggregateOpening: this.proveZeroOpening(netTarget, sumNetR, `${payrollPeriod}:agg:net`),
    };
  }

  public verifyPayrollAudit(bundle: ConfidentialPayrollAuditBundle): boolean {
    if (bundle.employeeProofs.length === 0 || bundle.minSalary > bundle.maxSalary) return false;
    if (bundle.totalGrossDisbursed !== bundle.totalTaxRemitted + bundle.totalNetPaid) return false;

    const seen = new Set<string>();
    let prodGross = 1n;
    let prodTax = 1n;
    let prodNet = 1n;
    const gNegMin = modPow(BASE_G, modScalar(SUBGROUP_Q - modScalar(bundle.minSalary)), SAFE_PRIME_P);
    const gMax = modPow(BASE_G, modScalar(bundle.maxSalary), SAFE_PRIME_P);

    for (const ep of bundle.employeeProofs) {
      if (seen.has(ep.employeeId)) return false;
      seen.add(ep.employeeId);

      const invTN = modPow((ep.taxComm * ep.netComm) % SAFE_PRIME_P, SAFE_PRIME_P - 2n, SAFE_PRIME_P);
      const idTarget = (ep.grossComm * invTN) % SAFE_PRIME_P;
      if (!this.verifyZeroOpening(idTarget, ep.balanceIdentityProof, `${bundle.payrollPeriod}:${ep.employeeId}:bal`)) {
        return false;
      }

      const expMinGap = (ep.grossComm * gNegMin) % SAFE_PRIME_P;
      if (ep.minBandProof.commitment !== expMinGap || !this.verifyGap(ep.minBandProof, `${bundle.payrollPeriod}:${ep.employeeId}:min`)) {
        return false;
      }

      const invGross = modPow(ep.grossComm, SAFE_PRIME_P - 2n, SAFE_PRIME_P);
      const expMaxGap = (gMax * invGross) % SAFE_PRIME_P;
      if (ep.maxBandProof.commitment !== expMaxGap || !this.verifyGap(ep.maxBandProof, `${bundle.payrollPeriod}:${ep.employeeId}:max`)) {
        return false;
      }

      prodGross = (prodGross * ep.grossComm) % SAFE_PRIME_P;
      prodTax = (prodTax * ep.taxComm) % SAFE_PRIME_P;
      prodNet = (prodNet * ep.netComm) % SAFE_PRIME_P;
    }

    const grossTarget = (prodGross * modPow(BASE_G, modScalar(SUBGROUP_Q - modScalar(bundle.totalGrossDisbursed)), SAFE_PRIME_P)) % SAFE_PRIME_P;
    const taxTarget = (prodTax * modPow(BASE_G, modScalar(SUBGROUP_Q - modScalar(bundle.totalTaxRemitted)), SAFE_PRIME_P)) % SAFE_PRIME_P;
    const netTarget = (prodNet * modPow(BASE_G, modScalar(SUBGROUP_Q - modScalar(bundle.totalNetPaid)), SAFE_PRIME_P)) % SAFE_PRIME_P;

    return (
      this.verifyZeroOpening(grossTarget, bundle.grossAggregateOpening, `${bundle.payrollPeriod}:agg:gross`) &&
      this.verifyZeroOpening(taxTarget, bundle.taxAggregateOpening, `${bundle.payrollPeriod}:agg:tax`) &&
      this.verifyZeroOpening(netTarget, bundle.netAggregateOpening, `${bundle.payrollPeriod}:agg:net`)
    );
  }

  public serializeBundle(bundle: ConfidentialPayrollAuditBundle): string {
    return JSON.stringify({
      payrollPeriod: bundle.payrollPeriod,
      employeeCount: bundle.employeeProofs.length,
      totalGrossDisbursed: bundle.totalGrossDisbursed.toString(),
      totalTaxRemitted: bundle.totalTaxRemitted.toString(),
      totalNetPaid: bundle.totalNetPaid.toString(),
    });
  }
}
