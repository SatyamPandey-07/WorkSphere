/**
 * EscrowClauseValidator.ts
 * Automated Smart Contract Escrow Clause Validator & Invariant Verifier.
 * Deterministically checks multi-party escrow parameters against formal legal/mathematical invariants:
 * Payment conservation, independent arbitration, timelock progression, dispute grace adequacy,
 * and generates tamper-evident SHA-256 clause attestation certificates.
 */

import { createHash } from 'crypto';

export type EscrowCurrency = 'USDC' | 'SOL' | 'ETH' | 'FIAT_USD';

export type MilestoneVerificationMethod =
  | 'CLIENT_SIGN_OFF'
  | 'ORACLE_ATTESTATION'
  | 'MULTI_SIG';

export interface EscrowMilestone {
  milestoneId: string;
  title: string;
  amount: number;
  deadlineTimestamp: number;
  verificationMethod: MilestoneVerificationMethod;
  oracleIdentifier?: string;
}

export interface EscrowContractSpec {
  escrowId: string;
  buyerAddress: string;
  sellerAddress: string;
  arbitratorAddress: string;
  totalEscrowAmount: number;
  currency: EscrowCurrency;
  milestones: EscrowMilestone[];
  disputeGracePeriodHours: number;
  withholdingTaxPercent: number;
  arbitrationFeeBps: number; // Basis points (e.g. 250 = 2.5%)
}

export type ClauseSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export type ClauseType =
  | 'PAYMENT_CONSERVATION'
  | 'ARBITRATION_INDEPENDENCE'
  | 'TIMELOCK_INTEGRITY'
  | 'DISPUTE_ADEQUACY'
  | 'TAX_COMPLIANCE'
  | 'ORACLE_SPECIFICATION';

export interface ClauseValidationIssue {
  severity: ClauseSeverity;
  clauseType: ClauseType;
  message: string;
  remediation: string;
}

export interface ValidationReport {
  isValid: boolean;
  escrowId: string;
  totalAmountValidated: number;
  issues: ClauseValidationIssue[];
  attestationHash: string;
  certifiedAt: number;
}

export class EscrowClauseValidator {
  private minDisputeGraceHours: number;
  private maxTaxWithholdingPercent: number;
  private minMilestoneReviewWindowMs: number;

  constructor(options?: {
    minDisputeGraceHours?: number;
    maxTaxWithholdingPercent?: number;
    minMilestoneReviewWindowHours?: number;
  }) {
    this.minDisputeGraceHours = options?.minDisputeGraceHours ?? 48; // 48 hours minimum dispute window
    this.maxTaxWithholdingPercent = options?.maxTaxWithholdingPercent ?? 30.0; // Statutory 30% cap
    this.minMilestoneReviewWindowMs =
      (options?.minMilestoneReviewWindowHours ?? 24) * 3600 * 1000; // 24 hours between milestones
  }

  /**
   * Computes deterministic canonical SHA-256 attestation digest for on-chain binding
   */
  public computeCanonicalAttestationHash(spec: EscrowContractSpec): string {
    const canonicalObj = {
      escrowId: spec.escrowId,
      buyer: spec.buyerAddress.toLowerCase(),
      seller: spec.sellerAddress.toLowerCase(),
      arbitrator: spec.arbitratorAddress.toLowerCase(),
      totalAmount: spec.totalEscrowAmount,
      currency: spec.currency,
      disputeGraceHours: spec.disputeGracePeriodHours,
      withholdingTax: spec.withholdingTaxPercent,
      arbitrationFeeBps: spec.arbitrationFeeBps,
      milestones: spec.milestones.map((m) => ({
        id: m.milestoneId,
        amt: m.amount,
        deadline: m.deadlineTimestamp,
        method: m.verificationMethod,
        oracle: m.oracleIdentifier ?? null,
      })),
    };

    return createHash('sha256').update(JSON.stringify(canonicalObj)).digest('hex');
  }

  /**
   * Evaluates all legal and financial invariants across the escrow contract specification
   */
  public validateSpec(
    spec: EscrowContractSpec,
    currentTime: number = Date.now()
  ): ValidationReport {
    const issues: ClauseValidationIssue[] = [];

    // 1. Payment Conservation Invariant
    const sumMilestones = spec.milestones.reduce((acc, m) => acc + m.amount, 0);
    const taxWithholdingAmount = (spec.totalEscrowAmount * spec.withholdingTaxPercent) / 100.0;
    const computedTotal = sumMilestones + taxWithholdingAmount;

    const delta = Math.abs(spec.totalEscrowAmount - computedTotal);
    if (delta > 0.01) {
      issues.push({
        severity: 'CRITICAL',
        clauseType: 'PAYMENT_CONSERVATION',
        message: `Payment Conservation Invariant violated: Total escrow (${spec.totalEscrowAmount} ${spec.currency}) does not match milestones sum (${sumMilestones}) + tax withholding (${taxWithholdingAmount}). Discrepancy: ${delta.toFixed(2)}.`,
        remediation:
          'Adjust milestone tranches or tax withholding rate so their sum strictly equals totalEscrowAmount.',
      });
    }

    // 2. Arbitrator Independence Invariant
    const buyerLower = spec.buyerAddress.trim().toLowerCase();
    const sellerLower = spec.sellerAddress.trim().toLowerCase();
    const arbLower = spec.arbitratorAddress.trim().toLowerCase();

    if (arbLower === buyerLower || arbLower === sellerLower) {
      issues.push({
        severity: 'CRITICAL',
        clauseType: 'ARBITRATION_INDEPENDENCE',
        message:
          'Arbitrator Independence Invariant violated: Arbitrator address must not match buyer or seller address (collusion risk).',
        remediation:
          'Assign an independent decentralized mediation protocol or certified third-party escrow arbitrator.',
      });
    }

    // 3. Timelock Progression & Review Window
    let previousDeadline = currentTime;
    for (let i = 0; i < spec.milestones.length; i++) {
      const m = spec.milestones[i];

      if (m.deadlineTimestamp <= currentTime) {
        issues.push({
          severity: 'CRITICAL',
          clauseType: 'TIMELOCK_INTEGRITY',
          message: `Milestone ${m.milestoneId} deadline is set in the past (${new Date(m.deadlineTimestamp).toISOString()}).`,
          remediation: 'Update milestone deadline to a future execution timestamp.',
        });
      }

      if (i > 0 && m.deadlineTimestamp <= previousDeadline) {
        issues.push({
          severity: 'CRITICAL',
          clauseType: 'TIMELOCK_INTEGRITY',
          message: `Timelock Inversion: Milestone ${m.milestoneId} deadline is earlier than or equal to preceding milestone deadline.`,
          remediation: 'Ensure milestones strictly follow chronological sequential progression.',
        });
      } else if (i > 0 && m.deadlineTimestamp - previousDeadline < this.minMilestoneReviewWindowMs) {
        issues.push({
          severity: 'WARNING',
          clauseType: 'TIMELOCK_INTEGRITY',
          message: `Review window between preceding milestone and milestone ${m.milestoneId} is less than ${this.minMilestoneReviewWindowMs / 3600000} hours.`,
          remediation: 'Provide adequate review duration for milestone verification.',
        });
      }

      previousDeadline = m.deadlineTimestamp;

      // 4. Oracle Attestation Specification
      if (m.verificationMethod === 'ORACLE_ATTESTATION' && !m.oracleIdentifier) {
        issues.push({
          severity: 'CRITICAL',
          clauseType: 'ORACLE_SPECIFICATION',
          message: `Milestone ${m.milestoneId} requires ORACLE_ATTESTATION but lacks an oracleIdentifier.`,
          remediation: 'Specify verifiable oracle feed address or decentralized oracle network ID.',
        });
      }
    }

    // 5. Dispute Grace Period Adequacy
    if (spec.disputeGracePeriodHours < this.minDisputeGraceHours) {
      issues.push({
        severity: 'CRITICAL',
        clauseType: 'DISPUTE_ADEQUACY',
        message: `Dispute grace period (${spec.disputeGracePeriodHours}h) is below the statutory minimum of ${this.minDisputeGraceHours} hours.`,
        remediation: `Increase dispute grace window to at least ${this.minDisputeGraceHours} hours to safeguard against unilateral liquidation.`,
      });
    }

    // 6. Tax Withholding Statutory Bounds
    if (spec.withholdingTaxPercent < 0 || spec.withholdingTaxPercent > this.maxTaxWithholdingPercent) {
      issues.push({
        severity: 'CRITICAL',
        clauseType: 'TAX_COMPLIANCE',
        message: `Withholding tax rate (${spec.withholdingTaxPercent}%) exceeds legal limits (0% - ${this.maxTaxWithholdingPercent}%).`,
        remediation: `Configure tax withholding rate within statutory bounds (0% to ${this.maxTaxWithholdingPercent}%).`,
      });
    }

    const hasCriticalIssues = issues.some((i) => i.severity === 'CRITICAL');
    const attestationHash = this.computeCanonicalAttestationHash(spec);

    return {
      isValid: !hasCriticalIssues,
      escrowId: spec.escrowId,
      totalAmountValidated: spec.totalEscrowAmount,
      issues,
      attestationHash,
      certifiedAt: currentTime,
    };
  }

  /**
   * Verifies that a given attestation hash matches the specification
   */
  public verifyAttestationHash(spec: EscrowContractSpec, expectedHash: string): boolean {
    const computed = this.computeCanonicalAttestationHash(spec);
    return computed.toLowerCase() === expectedHash.toLowerCase();
  }
}
