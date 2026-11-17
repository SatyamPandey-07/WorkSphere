import {
  EscrowClauseValidator,
  EscrowContractSpec,
} from '../../core/legal/EscrowClauseValidator';

describe('EscrowClauseValidator', () => {
  let validator: EscrowClauseValidator;
  const now = 1700000000000;

  const validSpec: EscrowContractSpec = {
    escrowId: 'escrow-workspace-lease-001',
    buyerAddress: '0x1111111111111111111111111111111111111111',
    sellerAddress: '0x2222222222222222222222222222222222222222',
    arbitratorAddress: '0x3333333333333333333333333333333333333333',
    totalEscrowAmount: 10000,
    currency: 'USDC',
    withholdingTaxPercent: 10.0, // 1,000 USDC withholding
    arbitrationFeeBps: 200, // 2%
    disputeGracePeriodHours: 72,
    milestones: [
      {
        milestoneId: 'm1',
        title: 'Initial Deposit & Key Handover',
        amount: 4000,
        deadlineTimestamp: now + 3600000 * 48, // 48h
        verificationMethod: 'CLIENT_SIGN_OFF',
      },
      {
        milestoneId: 'm2',
        title: 'Facility Fit-Out & Sensor Calibration',
        amount: 5000,
        deadlineTimestamp: now + 3600000 * 120, // 120h
        verificationMethod: 'ORACLE_ATTESTATION',
        oracleIdentifier: 'oracle.chainlink.sensor.v1',
      },
    ], // Milestones sum = 9,000 + 1,000 withholding = 10,000
  };

  beforeEach(() => {
    validator = new EscrowClauseValidator({
      minDisputeGraceHours: 48,
      maxTaxWithholdingPercent: 30.0,
      minMilestoneReviewWindowHours: 24,
    });
  });

  describe('Valid Specification & Attestation', () => {
    it('approves a legally sound escrow spec with zero critical issues', () => {
      const report = validator.validateSpec(validSpec, now);

      expect(report.isValid).toBe(true);
      expect(report.issues.filter((i) => i.severity === 'CRITICAL').length).toBe(0);
      expect(report.totalAmountValidated).toBe(10000);
      expect(report.attestationHash).toBeDefined();

      const isVerified = validator.verifyAttestationHash(validSpec, report.attestationHash);
      expect(isVerified).toBe(true);
    });
  });

  describe('Payment Conservation Invariant', () => {
    it('flags CRITICAL issue when milestones + tax does not equal totalEscrowAmount', () => {
      const invalidSpec: EscrowContractSpec = {
        ...validSpec,
        totalEscrowAmount: 12000, // 12,000 != 9,000 + 1,000
      };

      const report = validator.validateSpec(invalidSpec, now);
      expect(report.isValid).toBe(false);

      const issue = report.issues.find((i) => i.clauseType === 'PAYMENT_CONSERVATION');
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe('CRITICAL');
      expect(issue?.message).toContain('Payment Conservation Invariant violated');
    });
  });

  describe('Arbitration Independence Invariant', () => {
    it('flags CRITICAL issue when arbitrator address matches buyer address', () => {
      const conflictedSpec: EscrowContractSpec = {
        ...validSpec,
        arbitratorAddress: validSpec.buyerAddress, // Collusion risk
      };

      const report = validator.validateSpec(conflictedSpec, now);
      expect(report.isValid).toBe(false);

      const issue = report.issues.find((i) => i.clauseType === 'ARBITRATION_INDEPENDENCE');
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe('CRITICAL');
      expect(issue?.message).toContain('Arbitrator Independence Invariant violated');
    });
  });

  describe('Timelock Inversion & Oracle Specification', () => {
    it('flags CRITICAL issue when milestone deadlines exhibit timelock inversion', () => {
      const invertedSpec: EscrowContractSpec = {
        ...validSpec,
        milestones: [
          {
            milestoneId: 'm1',
            title: 'Milestone 1',
            amount: 4000,
            deadlineTimestamp: now + 3600000 * 72,
            verificationMethod: 'CLIENT_SIGN_OFF',
          },
          {
            milestoneId: 'm2',
            title: 'Milestone 2',
            amount: 5000,
            deadlineTimestamp: now + 3600000 * 24, // Inverted! earlier than m1
            verificationMethod: 'CLIENT_SIGN_OFF',
          },
        ],
      };

      const report = validator.validateSpec(invertedSpec, now);
      expect(report.isValid).toBe(false);

      const issue = report.issues.find((i) => i.clauseType === 'TIMELOCK_INTEGRITY');
      expect(issue).toBeDefined();
      expect(issue?.message).toContain('Timelock Inversion');
    });

    it('flags CRITICAL issue when ORACLE_ATTESTATION lacks oracleIdentifier', () => {
      const missingOracleSpec: EscrowContractSpec = {
        ...validSpec,
        milestones: [
          validSpec.milestones[0],
          {
            ...validSpec.milestones[1],
            oracleIdentifier: undefined, // Missing!
          },
        ],
      };

      const report = validator.validateSpec(missingOracleSpec, now);
      expect(report.isValid).toBe(false);

      const issue = report.issues.find((i) => i.clauseType === 'ORACLE_SPECIFICATION');
      expect(issue).toBeDefined();
      expect(issue?.message).toContain('lacks an oracleIdentifier');
    });
  });

  describe('Dispute Grace Window Adequacy', () => {
    it('flags CRITICAL issue when dispute grace window is less than 48 hours', () => {
      const shortDisputeSpec: EscrowContractSpec = {
        ...validSpec,
        disputeGracePeriodHours: 12, // Less than minimum 48h
      };

      const report = validator.validateSpec(shortDisputeSpec, now);
      expect(report.isValid).toBe(false);

      const issue = report.issues.find((i) => i.clauseType === 'DISPUTE_ADEQUACY');
      expect(issue).toBeDefined();
      expect(issue?.message).toContain('below the statutory minimum');
    });
  });
});
