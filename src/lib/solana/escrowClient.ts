import {
  EscrowTransitionError,
  isAutoRefundEligible,
  transitionEscrowRecord,
  type EscrowLifecycleState,
  type EscrowRecord,
} from '@/lib/solana/escrowStateMachine';

export interface SettlementRequest {
  escrowId: string;
  targetState: Extract<
    EscrowLifecycleState,
    'released' | 'refunded' | 'partially_refunded'
  >;
  idempotencyKey: string;
  refundBasisPoints?: number;
  nowUnixSeconds?: number;
}

export interface SettlementReceipt {
  idempotencyKey: string;
  txSignature: string;
  escrow: EscrowRecord;
  deduplicated: boolean;
}

export interface SolanaEscrowRpcLike {
  submitSettlement?: (
    record: EscrowRecord,
    idempotencyKey: string
  ) => Promise<{ txSignature: string }>;
}

export class SolanaEscrowClient {
  private readonly rpc: SolanaEscrowRpcLike;
  private readonly escrows = new Map<string, EscrowRecord>();
  private readonly settlementReceipts = new Map<string, SettlementReceipt>();
  private readonly inFlightSettlements = new Map<
    string,
    Promise<SettlementReceipt>
  >();

  constructor(
    rpc: SolanaEscrowRpcLike = {},
    initialEscrows: EscrowRecord[] = []
  ) {
    this.rpc = rpc;
    for (const item of initialEscrows) {
      this.escrows.set(item.escrowId, item);
    }
  }

  public registerEscrow(record: EscrowRecord): void {
    this.escrows.set(record.escrowId, record);
  }

  public getEscrow(escrowId: string): EscrowRecord | undefined {
    return this.escrows.get(escrowId);
  }

  public openDispute(
    escrowId: string,
    disputeReason: string,
    nowUnixSeconds?: number
  ): EscrowRecord {
    const current = this.escrows.get(escrowId);
    if (!current) {
      throw new Error(`Escrow "${escrowId}" not found`);
    }
    const updated = transitionEscrowRecord(current, 'disputed', {
      disputeReason,
      nowUnixSeconds,
    });
    this.escrows.set(escrowId, updated);
    return updated;
  }

  public async settleEscrow(
    request: SettlementRequest
  ): Promise<SettlementReceipt> {
    const existingReceipt = this.settlementReceipts.get(request.idempotencyKey);
    if (existingReceipt) {
      return { ...existingReceipt, deduplicated: true };
    }

    const inFlight = this.inFlightSettlements.get(request.idempotencyKey);
    if (inFlight) {
      const receipt = await inFlight;
      return { ...receipt, deduplicated: true };
    }

    const execution = (async (): Promise<SettlementReceipt> => {
      const current = this.escrows.get(request.escrowId);
      if (!current) {
        throw new Error(`Escrow "${request.escrowId}" not found`);
      }

      const nextRecord = transitionEscrowRecord(current, request.targetState, {
        refundBasisPoints: request.refundBasisPoints,
        nowUnixSeconds: request.nowUnixSeconds,
      });

      const txResult =
        typeof this.rpc.submitSettlement === 'function'
          ? await this.rpc.submitSettlement(nextRecord, request.idempotencyKey)
          : {
              txSignature: `sig_${request.escrowId}_${request.idempotencyKey}`,
            };

      this.escrows.set(request.escrowId, nextRecord);

      const receipt: SettlementReceipt = {
        idempotencyKey: request.idempotencyKey,
        txSignature: txResult.txSignature,
        escrow: nextRecord,
        deduplicated: false,
      };
      this.settlementReceipts.set(request.idempotencyKey, receipt);
      return receipt;
    })();

    this.inFlightSettlements.set(request.idempotencyKey, execution);
    try {
      return await execution;
    } finally {
      this.inFlightSettlements.delete(request.idempotencyKey);
    }
  }

  public async triggerGracePeriodAutoRefund(
    escrowId: string,
    idempotencyKey: string,
    nowUnixSeconds?: number
  ): Promise<SettlementReceipt> {
    const current = this.escrows.get(escrowId);
    if (!current) {
      throw new Error(`Escrow "${escrowId}" not found`);
    }

    const eligible = isAutoRefundEligible({
      state: current.state,
      fundedAtUnixSeconds: current.fundedAtUnixSeconds,
      gracePeriodSeconds: current.gracePeriodSeconds,
      hostCheckedIn: current.hostCheckedIn,
      nowUnixSeconds,
    });

    if (!eligible) {
      throw new EscrowTransitionError(
        current.state,
        'refunded',
        'Escrow is not eligible for grace-period auto-refund'
      );
    }

    return this.settleEscrow({
      escrowId,
      targetState: 'refunded',
      idempotencyKey,
      nowUnixSeconds,
    });
  }
}
