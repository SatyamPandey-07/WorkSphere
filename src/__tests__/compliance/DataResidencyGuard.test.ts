import {
  DataResidencyGuard,
  TransferRequest,
} from '../../core/compliance/DataResidencyGuard';

describe('DataResidencyGuard', () => {
  let guard: DataResidencyGuard;

  beforeEach(() => {
    guard = new DataResidencyGuard('test-vault-pepper');
  });

  describe('Intra-Jurisdiction & Telemetry Transfers', () => {
    it('permits intra-jurisdiction transfer unrestricted', () => {
      const request: TransferRequest = {
        requestId: 'req-intra-1',
        originJurisdiction: 'EU_EEA',
        destinationJurisdiction: 'EU_EEA',
        sensitivity: 'DIRECT_PII',
        payload: { username: 'alice', email: 'alice@example.de' },
      };

      const result = guard.evaluateTransfer(request);
      expect(result.isPermitted).toBe(true);
      expect(result.verdict).toBe('PERMIT_UNRESTRICTED');
      expect(result.sanitizedPayload).toEqual(request.payload);
    });

    it('permits non-PII system metrics globally without restriction', () => {
      const request: TransferRequest = {
        requestId: 'req-metrics-1',
        originJurisdiction: 'EU_EEA',
        destinationJurisdiction: 'REST_OF_WORLD',
        sensitivity: 'SYSTEM_METRICS',
        payload: { cpuPercent: 42, memoryMb: 1024 },
      };

      const result = guard.evaluateTransfer(request);
      expect(result.isPermitted).toBe(true);
      expect(result.verdict).toBe('PERMIT_UNRESTRICTED');
    });
  });

  describe('EU GDPR Cross-Border Adequacy Decisions', () => {
    it('permits transfer from EU to Switzerland under adequacy recognition', () => {
      const request: TransferRequest = {
        requestId: 'req-adeq-1',
        originJurisdiction: 'EU_EEA',
        destinationJurisdiction: 'SWITZERLAND',
        sensitivity: 'DIRECT_PII',
        payload: { username: 'johann', email: 'johann@zurich.ch' },
      };

      const result = guard.evaluateTransfer(request);
      expect(result.isPermitted).toBe(true);
      expect(result.verdict).toBe('PERMIT_UNDER_ADEQUACY');
    });

    it('permits transfer from EU to US under Data Privacy Framework certification', () => {
      const request: TransferRequest = {
        requestId: 'req-dpf-1',
        originJurisdiction: 'EU_EEA',
        destinationJurisdiction: 'UNITED_STATES',
        sensitivity: 'DIRECT_PII',
        payload: { username: 'mark', email: 'mark@corp.us' },
        hasDataPrivacyFrameworkCert: true,
      };

      const result = guard.evaluateTransfer(request);
      expect(result.isPermitted).toBe(true);
      expect(result.verdict).toBe('PERMIT_UNDER_ADEQUACY');
    });

    it('permits transfer from EU under Standard Contractual Clauses (SCCs)', () => {
      const request: TransferRequest = {
        requestId: 'req-scc-1',
        originJurisdiction: 'EU_EEA',
        destinationJurisdiction: 'SINGAPORE',
        sensitivity: 'DIRECT_PII',
        payload: { username: 'lee', email: 'lee@tech.sg' },
        hasStandardContractualClauses: true,
      };

      const result = guard.evaluateTransfer(request);
      expect(result.isPermitted).toBe(true);
      expect(result.verdict).toBe('PERMIT_UNDER_SCC');
    });

    it('blocks financial and biometric egress to non-adequate jurisdictions without SCCs', () => {
      const request: TransferRequest = {
        requestId: 'req-block-1',
        originJurisdiction: 'EU_EEA',
        destinationJurisdiction: 'REST_OF_WORLD',
        sensitivity: 'FINANCIAL_PCI',
        payload: { cardNumber: '4111-1111-1111-1111' },
      };

      const result = guard.evaluateTransfer(request);
      expect(result.isPermitted).toBe(false);
      expect(result.verdict).toBe('BLOCKED_RESIDENCY_VIOLATION');
    });
  });

  describe('India DPDP Act 2023 & RBI Financial Rules', () => {
    it('strictly blocks egress of Indian payment financial data', () => {
      const request: TransferRequest = {
        requestId: 'req-in-pay',
        originJurisdiction: 'INDIA',
        destinationJurisdiction: 'UNITED_STATES',
        sensitivity: 'FINANCIAL_PCI',
        payload: { upiId: 'user@okhdfcbank' },
      };

      const result = guard.evaluateTransfer(request);
      expect(result.isPermitted).toBe(false);
      expect(result.verdict).toBe('BLOCKED_RESIDENCY_VIOLATION');
      expect(result.reason).toContain('RBI & DPDP mandate');
    });
  });

  describe('Automated Pseudonymization Vault', () => {
    it('pseudonymizes sensitive PII fields deterministically', () => {
      const payload = {
        username: 'alice_smith',
        email: 'alice@example.com',
        teamId: 'engineering-101',
      };

      const sanitized = guard.pseudonymizePayload(payload);
      expect(sanitized.username).not.toBe('alice_smith');
      expect(sanitized.username).toMatch(/^pseudo-[a-f0-9]{16}$/);
      expect(sanitized.email).toMatch(/^pseudo-[a-f0-9]{16}$/);
      // Non-sensitive key remains intact
      expect(sanitized.teamId).toBe('engineering-101');
    });
  });

  describe('Cryptographic Audit Ledger', () => {
    it('maintains hash-chained audit ledger of all transfer evaluations', () => {
      guard.evaluateTransfer({
        requestId: 'req-1',
        originJurisdiction: 'EU_EEA',
        destinationJurisdiction: 'EU_EEA',
        sensitivity: 'DIRECT_PII',
        payload: { name: 'A' },
      });

      guard.evaluateTransfer({
        requestId: 'req-2',
        originJurisdiction: 'EU_EEA',
        destinationJurisdiction: 'SWITZERLAND',
        sensitivity: 'DIRECT_PII',
        payload: { name: 'B' },
      });

      const ledger = guard.getAuditLedger();
      expect(ledger.length).toBe(2);
      expect(ledger[1].previousHash).toBe(ledger[0].hash);
      expect(guard.verifyAuditLedgerIntegrity()).toBe(true);
    });
  });
});
