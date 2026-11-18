/**
 * Delay-Tolerant Networking (DTN) Custody Transfer Acknowledgment Router
 * Conforms to RFC 5050 / RFC 9171 Bundle Protocol Custody Transfer Architecture.
 */

export type CustodyState =
  | 'UNASSIGNED'
  | 'HELD_LOCALLY'
  | 'FORWARDED_PENDING_ACK'
  | 'CUSTODY_RELEASED'
  | 'CUSTODY_REFUSED'
  | 'EXPIRED';

export const CustodyReasonCode = {
  SUCCESS: 0x00,
  NO_ADDITIONAL_INFO: 0x01,
  DEPLETED_STORAGE: 0x02,
  DESTINATION_UNINTELLIGIBLE: 0x03,
  NO_ROUTE_TO_DESTINATION: 0x04,
  TIMEOUT_RETRANSMISSION: 0x05,
  REDUNDANT_RECEPTION: 0x06,
  CUSTODY_RELEASE_ACK: 0x07,
} as const;

export type CustodyReasonCode = (typeof CustodyReasonCode)[keyof typeof CustodyReasonCode];

export interface CustodySignal {
  signalId: string;
  bundleId: string;
  isAccepted: boolean;
  reasonCode: CustodyReasonCode;
  custodianEndpoint: string;
  signalTimestamp: number;
  acknowledgmentToken: string;
  checksum?: string;
}

export interface CustodyBundleRecord<T = unknown> {
  bundleId: string;
  sourceEndpoint: string;
  destinationEndpoint: string;
  payloadSizeBytes: number;
  payload: T;
  custodyState: CustodyState;
  creationTimestamp: number;
  lifetimeTTLMs: number;
  custodyRequested: boolean;
  currentCustodian: string;
  forwardedToCustodian?: string;
  rtoMs: number;
  retransmitAttempts: number;
  maxRetransmits: number;
  lastTransmissionTimestamp?: number;
}

export interface DTNCustodyRouterConfig {
  localNodeId: string;
  maxStorageBytes?: number;
  maxBundles?: number;
  defaultRtoMs?: number;
  backoffMultiplier?: number;
  maxRetransmits?: number;
}

export interface DTNCustodyStats {
  localNodeId: string;
  totalBundlesManaged: number;
  activeCustodyCount: number;
  pendingAckCount: number;
  releasedCount: number;
  refusedCount: number;
  expiredCount: number;
  currentStorageBytes: number;
  maxStorageBytes: number;
  retransmissionEvents: number;
}

export class DTNCustodyRouter {
  private localNodeId: string;
  private maxStorageBytes: number;
  private maxBundles: number;
  private defaultRtoMs: number;
  private backoffMultiplier: number;
  private maxRetransmits: number;

  private records: Map<string, CustodyBundleRecord> = new Map();
  private timerHandles: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private currentStorageBytes = 0;
  private retransmissionCounter = 0;

  // Lifecycle listeners
  public onCustodyAccepted?: (bundleId: string, signal: CustodySignal) => void;
  public onCustodyRefused?: (bundleId: string, signal: CustodySignal) => void;
  public onCustodyTimeout?: (bundleId: string, attempt: number) => void;
  public onBundleEvicted?: (bundleId: string, reason: string) => void;
  public onCustodyReleased?: (bundleId: string) => void;

  constructor(config: DTNCustodyRouterConfig) {
    this.localNodeId = config.localNodeId;
    this.maxStorageBytes = config.maxStorageBytes ?? 50 * 1024 * 1024; // 50MB default
    this.maxBundles = config.maxBundles ?? 1000;
    this.defaultRtoMs = config.defaultRtoMs ?? 3000; // 3 seconds initial RTO
    this.backoffMultiplier = config.backoffMultiplier ?? 1.5;
    this.maxRetransmits = config.maxRetransmits ?? 5;
  }

  /**
   * Evaluates admission criteria for receiving or creating a bundle.
   */
  public canAdmit(payloadSizeBytes: number): { canAdmit: boolean; reasonCode: CustodyReasonCode } {
    if (this.records.size >= this.maxBundles) {
      return { canAdmit: false, reasonCode: CustodyReasonCode.DEPLETED_STORAGE };
    }
    if (this.currentStorageBytes + payloadSizeBytes > this.maxStorageBytes) {
      return { canAdmit: false, reasonCode: CustodyReasonCode.DEPLETED_STORAGE };
    }
    return { canAdmit: true, reasonCode: CustodyReasonCode.SUCCESS };
  }

  /**
   * Admits a bundle into local storage and takes initial custody if requested.
   */
  public admitBundle<T = unknown>(params: {
    bundleId: string;
    sourceEndpoint: string;
    destinationEndpoint: string;
    payloadSizeBytes: number;
    payload: T;
    lifetimeTTLMs: number;
    custodyRequested: boolean;
    creationTimestamp?: number;
    maxRetransmits?: number;
  }): { admitted: boolean; signal?: CustodySignal; reason?: string } {
    const { canAdmit, reasonCode } = this.canAdmit(params.payloadSizeBytes);
    if (!canAdmit) {
      const refusalSignal = this.buildCustodySignal(params.bundleId, false, reasonCode);
      return {
        admitted: false,
        signal: refusalSignal,
        reason: `Storage limit exceeded (current: ${this.currentStorageBytes}B, max: ${this.maxStorageBytes}B)`,
      };
    }

    const now = Date.now();
    const creationTime = params.creationTimestamp ?? now;

    // Check TTL immediately
    if (now - creationTime > params.lifetimeTTLMs) {
      const refusalSignal = this.buildCustodySignal(params.bundleId, false, CustodyReasonCode.NO_ADDITIONAL_INFO);
      return {
        admitted: false,
        signal: refusalSignal,
        reason: 'Bundle lifetime TTL expired upon admission attempt',
      };
    }

    const record: CustodyBundleRecord<T> = {
      bundleId: params.bundleId,
      sourceEndpoint: params.sourceEndpoint,
      destinationEndpoint: params.destinationEndpoint,
      payloadSizeBytes: params.payloadSizeBytes,
      payload: params.payload,
      custodyState: params.custodyRequested ? 'HELD_LOCALLY' : 'UNASSIGNED',
      creationTimestamp: creationTime,
      lifetimeTTLMs: params.lifetimeTTLMs,
      custodyRequested: params.custodyRequested,
      currentCustodian: params.custodyRequested ? this.localNodeId : '',
      rtoMs: this.defaultRtoMs,
      retransmitAttempts: 0,
      maxRetransmits: params.maxRetransmits ?? this.maxRetransmits,
    };

    this.records.set(params.bundleId, record as CustodyBundleRecord);
    this.currentStorageBytes += params.payloadSizeBytes;

    let acceptanceSignal: CustodySignal | undefined;
    if (params.custodyRequested) {
      acceptanceSignal = this.buildCustodySignal(params.bundleId, true, CustodyReasonCode.SUCCESS);
    }

    return {
      admitted: true,
      signal: acceptanceSignal,
    };
  }

  /**
   * Forwards a bundle to the next-hop custodian node and starts the Custody Transfer Timer (CTT).
   */
  public forwardBundleWithCustody(
    bundleId: string,
    nextHopCustodian: string
  ): { forwarded: boolean; rtoMs: number; error?: string } {
    const record = this.records.get(bundleId);
    if (!record) {
      return { forwarded: false, rtoMs: 0, error: `Bundle ${bundleId} not found in store` };
    }

    if (!record.custodyRequested) {
      return { forwarded: false, rtoMs: 0, error: `Bundle ${bundleId} does not have custody transfer requested` };
    }

    if (record.custodyState === 'CUSTODY_RELEASED') {
      return { forwarded: false, rtoMs: 0, error: `Custody already released for bundle ${bundleId}` };
    }

    record.forwardedToCustodian = nextHopCustodian;
    record.custodyState = 'FORWARDED_PENDING_ACK';
    record.lastTransmissionTimestamp = Date.now();

    // Start Custody Transfer Timer (CTT)
    this.armCustodyTimer(bundleId, record.rtoMs);

    return {
      forwarded: true,
      rtoMs: record.rtoMs,
    };
  }

  /**
   * Processes an incoming Custody Signal (ACK or NACK) from a downstream custodian.
   */
  public processCustodySignal(signal: CustodySignal): {
    success: boolean;
    newState: CustodyState;
    reason?: string;
  } {
    const record = this.records.get(signal.bundleId);
    if (!record) {
      return {
        success: false,
        newState: 'UNASSIGNED',
        reason: `Unknown bundleId ${signal.bundleId} in custody signal`,
      };
    }

    // Verify token validity
    const expectedToken = this.computeAcknowledgmentToken(signal.bundleId, signal.custodianEndpoint);
    if (signal.acknowledgmentToken && signal.acknowledgmentToken !== expectedToken) {
      return {
        success: false,
        newState: record.custodyState,
        reason: 'Invalid custody acknowledgment token or signature',
      };
    }

    this.clearCustodyTimer(signal.bundleId);

    if (signal.isAccepted) {
      record.custodyState = 'CUSTODY_RELEASED';
      record.currentCustodian = signal.custodianEndpoint;

      // Free local storage once custody is transferred downstream
      this.currentStorageBytes = Math.max(0, this.currentStorageBytes - record.payloadSizeBytes);

      if (this.onCustodyAccepted) {
        this.onCustodyAccepted(signal.bundleId, signal);
      }
      if (this.onCustodyReleased) {
        this.onCustodyReleased(signal.bundleId);
      }

      return {
        success: true,
        newState: 'CUSTODY_RELEASED',
      };
    } else {
      record.custodyState = 'CUSTODY_REFUSED';
      if (this.onCustodyRefused) {
        this.onCustodyRefused(signal.bundleId, signal);
      }

      return {
        success: true,
        newState: 'CUSTODY_REFUSED',
        reason: `Downstream custodian rejected custody with reason code ${signal.reasonCode}`,
      };
    }
  }

  /**
   * Generates an RFC-compliant Custody Signal for an incoming bundle.
   */
  public generateCustodySignal(
    bundleId: string,
    isAccepted: boolean,
    reasonCode: CustodyReasonCode
  ): CustodySignal {
    return this.buildCustodySignal(bundleId, isAccepted, reasonCode);
  }

  /**
   * Handles timeout of the Custody Transfer Timer (CTT).
   */
  public handleTimerExpiration(bundleId: string): {
    retransmitted: boolean;
    dropped: boolean;
    newRtoMs?: number;
    error?: string;
  } {
    const record = this.records.get(bundleId);
    if (!record) {
      return { retransmitted: false, dropped: true, error: 'Bundle not found' };
    }

    if (record.custodyState !== 'FORWARDED_PENDING_ACK') {
      return { retransmitted: false, dropped: false, error: 'Bundle is not pending acknowledgment' };
    }

    record.retransmitAttempts += 1;
    this.retransmissionCounter += 1;

    if (this.onCustodyTimeout) {
      this.onCustodyTimeout(bundleId, record.retransmitAttempts);
    }

    if (record.retransmitAttempts > record.maxRetransmits) {
      record.custodyState = 'EXPIRED';
      this.clearCustodyTimer(bundleId);
      if (this.onBundleEvicted) {
        this.onBundleEvicted(bundleId, 'Max custody retransmits exceeded');
      }
      return { retransmitted: false, dropped: true };
    }

    // Apply exponential backoff to RTO
    record.rtoMs = Math.round(record.rtoMs * this.backoffMultiplier);
    record.lastTransmissionTimestamp = Date.now();

    // Re-arm timer for next attempt
    this.armCustodyTimer(bundleId, record.rtoMs);

    return {
      retransmitted: true,
      dropped: false,
      newRtoMs: record.rtoMs,
    };
  }

  /**
   * Manually release custody and evict bundle from memory buffer.
   */
  public releaseCustody(bundleId: string): boolean {
    const record = this.records.get(bundleId);
    if (!record) return false;

    this.clearCustodyTimer(bundleId);
    if (record.custodyState !== 'CUSTODY_RELEASED') {
      this.currentStorageBytes = Math.max(0, this.currentStorageBytes - record.payloadSizeBytes);
    }
    record.custodyState = 'CUSTODY_RELEASED';

    if (this.onCustodyReleased) {
      this.onCustodyReleased(bundleId);
    }
    return true;
  }

  /**
   * Scans and evicts all bundles exceeding their TTL.
   */
  public cleanupExpiredBundles(now: number = Date.now()): number {
    let purged = 0;
    for (const [bundleId, record] of this.records.entries()) {
      if (now - record.creationTimestamp > record.lifetimeTTLMs) {
        this.clearCustodyTimer(bundleId);
        if (record.custodyState !== 'CUSTODY_RELEASED') {
          this.currentStorageBytes = Math.max(0, this.currentStorageBytes - record.payloadSizeBytes);
        }
        record.custodyState = 'EXPIRED';
        if (this.onBundleEvicted) {
          this.onBundleEvicted(bundleId, 'TTL expired');
        }
        this.records.delete(bundleId);
        purged += 1;
      }
    }
    return purged;
  }

  /**
   * Returns complete telemetry and buffer utilization statistics.
   */
  public getStats(): DTNCustodyStats {
    let activeCustodyCount = 0;
    let pendingAckCount = 0;
    let releasedCount = 0;
    let refusedCount = 0;
    let expiredCount = 0;

    for (const record of this.records.values()) {
      switch (record.custodyState) {
        case 'HELD_LOCALLY':
          activeCustodyCount++;
          break;
        case 'FORWARDED_PENDING_ACK':
          pendingAckCount++;
          break;
        case 'CUSTODY_RELEASED':
          releasedCount++;
          break;
        case 'CUSTODY_REFUSED':
          refusedCount++;
          break;
        case 'EXPIRED':
          expiredCount++;
          break;
      }
    }

    return {
      localNodeId: this.localNodeId,
      totalBundlesManaged: this.records.size,
      activeCustodyCount,
      pendingAckCount,
      releasedCount,
      refusedCount,
      expiredCount,
      currentStorageBytes: this.currentStorageBytes,
      maxStorageBytes: this.maxStorageBytes,
      retransmissionEvents: this.retransmissionCounter,
    };
  }

  /**
   * Inspects a specific bundle custody record.
   */
  public getBundleRecord(bundleId: string): CustodyBundleRecord | undefined {
    return this.records.get(bundleId);
  }

  /**
   * Shuts down all active timers and clears store.
   */
  public destroy(): void {
    for (const handle of this.timerHandles.values()) {
      clearTimeout(handle);
    }
    this.timerHandles.clear();
    this.records.clear();
    this.currentStorageBytes = 0;
  }

  // --- Internal Helpers ---

  private armCustodyTimer(bundleId: string, durationMs: number): void {
    this.clearCustodyTimer(bundleId);
    const handle = setTimeout(() => {
      this.handleTimerExpiration(bundleId);
    }, durationMs);
    this.timerHandles.set(bundleId, handle);
  }

  private clearCustodyTimer(bundleId: string): void {
    const handle = this.timerHandles.get(bundleId);
    if (handle) {
      clearTimeout(handle);
      this.timerHandles.delete(bundleId);
    }
  }

  private buildCustodySignal(
    bundleId: string,
    isAccepted: boolean,
    reasonCode: CustodyReasonCode
  ): CustodySignal {
    const token = this.computeAcknowledgmentToken(bundleId, this.localNodeId);
    return {
      signalId: `sig-${bundleId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      bundleId,
      isAccepted,
      reasonCode,
      custodianEndpoint: this.localNodeId,
      signalTimestamp: Date.now(),
      acknowledgmentToken: token,
    };
  }

  public computeAcknowledgmentToken(bundleId: string, custodian: string): string {
    let hash = 0x811c9dc5;
    const input = `${bundleId}:${custodian}:custody-ack`;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }
}
