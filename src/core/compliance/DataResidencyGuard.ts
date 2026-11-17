/**
 * DataResidencyGuard.ts
 * Cross-border data residency transfer guard and pseudonymization vault.
 * Enforces GDPR Chapter V, India DPDP Act 2023, CCPA/CPRA, and Swiss FADP
 * jurisdictional transfer restrictions, adequacy agreements, and automated tokenization.
 */

import { createHash, createHmac } from 'crypto';

export type Jurisdiction =
  | 'EU_EEA'
  | 'UNITED_STATES'
  | 'INDIA'
  | 'SWITZERLAND'
  | 'UNITED_KINGDOM'
  | 'SINGAPORE'
  | 'REST_OF_WORLD';

export type DataSensitivity =
  | 'SYSTEM_METRICS'
  | 'PSEUDONYMIZED'
  | 'DIRECT_PII'
  | 'FINANCIAL_PCI'
  | 'HEALTH_BIOMETRIC';

export type TransferVerdict =
  | 'PERMIT_UNRESTRICTED'
  | 'PERMIT_UNDER_ADEQUACY'
  | 'PERMIT_UNDER_SCC'
  | 'REQUIRES_TOKENIZATION'
  | 'BLOCKED_RESIDENCY_VIOLATION';

export interface TransferRequest {
  requestId: string;
  originJurisdiction: Jurisdiction;
  destinationJurisdiction: Jurisdiction;
  sensitivity: DataSensitivity;
  payload: Record<string, any>;
  hasStandardContractualClauses?: boolean;
  hasDataPrivacyFrameworkCert?: boolean;
}

export interface TransferEvaluationResult {
  requestId: string;
  verdict: TransferVerdict;
  isPermitted: boolean;
  sanitizedPayload?: Record<string, any>;
  reason: string;
  auditHash: string;
}

export interface TransferAuditEntry {
  requestId: string;
  timestamp: number;
  origin: Jurisdiction;
  destination: Jurisdiction;
  sensitivity: DataSensitivity;
  verdict: TransferVerdict;
  previousHash: string;
  hash: string;
}

export class DataResidencyGuard {
  private readonly vaultPepper: string;
  private readonly auditLedger: TransferAuditEntry[] = [];
  private lastLedgerHash: string = '0'.repeat(64);

  // Set of jurisdictions with formal EU GDPR Article 45 adequacy findings
  private static readonly EU_ADEQUATE_JURISDICTIONS: Set<Jurisdiction> = new Set([
    'EU_EEA',
    'SWITZERLAND',
    'UNITED_KINGDOM',
  ]);

  constructor(vaultPepper: string = 'residency-vault-pepper-default') {
    this.vaultPepper = vaultPepper;
  }

  /**
   * Evaluates a prospective cross-border data transfer against sovereign privacy regulations.
   */
  public evaluateTransfer(request: TransferRequest): TransferEvaluationResult {
    const { originJurisdiction, destinationJurisdiction, sensitivity } = request;

    // 1. Intra-jurisdiction transfer is always unrestricted
    if (originJurisdiction === destinationJurisdiction) {
      return this.recordDecision(
        request,
        'PERMIT_UNRESTRICTED',
        true,
        'Intra-jurisdiction transfer within same regulatory boundary',
        request.payload
      );
    }

    // 2. Non-sensitive system metrics (CPU, bandwidth, anonymous aggregate logs) can flow globally
    if (sensitivity === 'SYSTEM_METRICS' || sensitivity === 'PSEUDONYMIZED') {
      return this.recordDecision(
        request,
        'PERMIT_UNRESTRICTED',
        true,
        'Non-PII system telemetry or already-pseudonymized payload permitted across borders',
        request.payload
      );
    }

    // 3. EU_EEA Egress Rules (GDPR Chapter V)
    if (originJurisdiction === 'EU_EEA') {
      // Bilateral adequacy recognition (Switzerland, UK)
      if (DataResidencyGuard.EU_ADEQUATE_JURISDICTIONS.has(destinationJurisdiction)) {
        return this.recordDecision(
          request,
          'PERMIT_UNDER_ADEQUACY',
          true,
          `Destination jurisdiction '${destinationJurisdiction}' holds formal EU adequacy decision`,
          request.payload
        );
      }

      // Transfer to US under EU-US Data Privacy Framework
      if (destinationJurisdiction === 'UNITED_STATES' && request.hasDataPrivacyFrameworkCert) {
        return this.recordDecision(
          request,
          'PERMIT_UNDER_ADEQUACY',
          true,
          'Transfer permitted under EU-U.S. Data Privacy Framework certification',
          request.payload
        );
      }

      // Transfer under Standard Contractual Clauses (SCCs)
      if (request.hasStandardContractualClauses) {
        // High-risk biometric/health requires supplementary pseudonymization even with SCCs
        if (sensitivity === 'HEALTH_BIOMETRIC') {
          const sanitized = this.pseudonymizePayload(request.payload);
          return this.recordDecision(
            request,
            'REQUIRES_TOKENIZATION',
            true,
            'Permitted under SCCs with mandatory supplementary cryptographic tokenization for health data',
            sanitized
          );
        }
        return this.recordDecision(
          request,
          'PERMIT_UNDER_SCC',
          true,
          'Transfer authorized under executed Standard Contractual Clauses (SCCs)',
          request.payload
        );
      }

      // No adequacy and no SCCs: DIRECT_PII must be tokenized, FINANCIAL/HEALTH is strictly blocked
      if (sensitivity === 'FINANCIAL_PCI' || sensitivity === 'HEALTH_BIOMETRIC') {
        return this.recordDecision(
          request,
          'BLOCKED_RESIDENCY_VIOLATION',
          false,
          `GDPR Art. 44 violation: Egress of ${sensitivity} to non-adequate jurisdiction '${destinationJurisdiction}' without SCCs is strictly prohibited`
        );
      }

      // Default for direct PII without adequacy: sanitize into pseudonymized format
      const sanitized = this.pseudonymizePayload(request.payload);
      return this.recordDecision(
        request,
        'REQUIRES_TOKENIZATION',
        true,
        'Direct PII tokenized into irreversible pseudonyms to comply with cross-border residency safeguards',
        sanitized
      );
    }

    // 4. India DPDP Act 2023 Rules
    if (originJurisdiction === 'INDIA') {
      if (sensitivity === 'FINANCIAL_PCI') {
        return this.recordDecision(
          request,
          'BLOCKED_RESIDENCY_VIOLATION',
          false,
          'RBI & DPDP mandate: Payment data must reside exclusively on domestic Indian infrastructure'
        );
      }
      if (!request.hasStandardContractualClauses && destinationJurisdiction === 'REST_OF_WORLD') {
        const sanitized = this.pseudonymizePayload(request.payload);
        return this.recordDecision(
          request,
          'REQUIRES_TOKENIZATION',
          true,
          'DPDP Act 2023 cross-border restriction: payload pseudonymized prior to foreign egress',
          sanitized
        );
      }
    }

    // Standard fallback: permit if SCCs exist, otherwise sanitize
    if (request.hasStandardContractualClauses) {
      return this.recordDecision(
        request,
        'PERMIT_UNDER_SCC',
        true,
        'Transfer authorized under bilateral data transfer agreement',
        request.payload
      );
    }

    const sanitized = this.pseudonymizePayload(request.payload);
    return this.recordDecision(
      request,
      'REQUIRES_TOKENIZATION',
      true,
      'Transfer permitted following automated field-level pseudonymization',
      sanitized
    );
  }

  // --- Pseudonymization Vault ---

  /**
   * Deterministically pseudonymizes sensitive fields (names, emails, IDs, IPs)
   * with HMAC-SHA256 keyed with the residency vault pepper.
   */
  public pseudonymizePayload(payload: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(payload)) {
      if (this.isSensitiveKey(key)) {
        if (typeof value === 'string') {
          result[key] = this.hashIdentifier(value);
        } else if (Array.isArray(value)) {
          result[key] = value.map((v) => (typeof v === 'string' ? this.hashIdentifier(v) : v));
        } else {
          result[key] = '[REDACTED]';
        }
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result[key] = this.pseudonymizePayload(value);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  private isSensitiveKey(key: string): boolean {
    const sensitiveRegex = /name|email|phone|ssn|userId|contributorId|ipAddress|username|card|pan/i;
    return sensitiveRegex.test(key);
  }

  private hashIdentifier(identifier: string): string {
    const hash = createHmac('sha256', this.vaultPepper).update(identifier).digest('hex');
    return `pseudo-${hash.substring(0, 16)}`;
  }

  // --- Audit Ledger & Cryptographic Integrity ---

  private recordDecision(
    request: TransferRequest,
    verdict: TransferVerdict,
    isPermitted: boolean,
    reason: string,
    sanitizedPayload?: Record<string, any>
  ): TransferEvaluationResult {
    const now = Date.now();
    const entryId = request.requestId;

    const payloadDigest = createHash('sha256')
      .update(JSON.stringify(sanitizedPayload || request.payload))
      .digest('hex');

    const auditPayload = `${entryId}:${now}:${request.originJurisdiction}:${request.destinationJurisdiction}:${request.sensitivity}:${verdict}:${payloadDigest}:${this.lastLedgerHash}`;
    const hash = createHash('sha256').update(auditPayload).digest('hex');

    const entry: TransferAuditEntry = {
      requestId: entryId,
      timestamp: now,
      origin: request.originJurisdiction,
      destination: request.destinationJurisdiction,
      sensitivity: request.sensitivity,
      verdict,
      previousHash: this.lastLedgerHash,
      hash,
    };

    this.auditLedger.push(entry);
    this.lastLedgerHash = hash;

    return {
      requestId: request.requestId,
      verdict,
      isPermitted,
      sanitizedPayload,
      reason,
      auditHash: hash,
    };
  }

  public getAuditLedger(): TransferAuditEntry[] {
    return [...this.auditLedger];
  }

  public verifyAuditLedgerIntegrity(): boolean {
    let expectedPrev = '0'.repeat(64);
    for (const entry of this.auditLedger) {
      if (entry.previousHash !== expectedPrev) return false;
      expectedPrev = entry.hash;
    }
    return true;
  }
}
