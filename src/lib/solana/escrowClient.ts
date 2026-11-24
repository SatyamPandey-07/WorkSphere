import {
  EscrowTransitionError,
  isAutoRefundEligible,
  transitionEscrowRecord,
  type EscrowLifecycleState,
  type EscrowRecord,
} from '@/lib/solana/escrowStateMachine';

export const RPC_RETRY_INITIAL_DELAY_MS = 500;
export const RPC_RETRY_MULTIPLIER = 2;
export const RPC_MAX_RETRIES = 3;
export const RPC_JITTER_RANGE_MS = 200;
export const RPC_BUSY_USER_MESSAGE = 'Solana RPC busy. Please retry shortly.';

export interface RpcRetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  multiplier?: number;
  jitterRangeMs?: number;
  randomFn?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'string') {
    return /\b429\b|too many requests/i.test(error);
  }
  if (typeof error === 'object') {
    const errObj = error as {
      status?: unknown;
      statusCode?: unknown;
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (
      [errObj.status, errObj.statusCode, errObj.code].some(
        (v) => v === 429 || v === '429'
      )
    ) {
      return true;
    }
    if (typeof errObj.message === 'string' && isRateLimitError(errObj.message)) {
      return true;
    }
    if (errObj.cause && isRateLimitError(errObj.cause)) {
      return true;
    }
  }
  return false;
}

export function computeBackoffDelayMs(
  retryIndex: number,
  options: Pick<
    RpcRetryOptions,
    'initialDelayMs' | 'multiplier' | 'jitterRangeMs' | 'randomFn'
  > = {}
): number {
  const initialDelayMs = options.initialDelayMs ?? RPC_RETRY_INITIAL_DELAY_MS;
  const multiplier = options.multiplier ?? RPC_RETRY_MULTIPLIER;
  const jitterRangeMs = options.jitterRangeMs ?? RPC_JITTER_RANGE_MS;
  const randomFn = options.randomFn ?? Math.random;

  const exponentialDelay =
    initialDelayMs * Math.pow(multiplier, Math.max(0, retryIndex));
  const jitter = (randomFn() * 2 - 1) * jitterRangeMs;
  return Math.max(0, Math.round(exponentialDelay + jitter));
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRpcRateLimitRetry<T>(
  operation: () => Promise<T>,
  options: RpcRetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? RPC_MAX_RETRIES;
  const sleepFn = options.sleepFn ?? defaultSleep;

  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (!isRateLimitError(error)) {
        throw error;
      }
      if (attempt >= maxRetries) {
        const busyError = new Error(RPC_BUSY_USER_MESSAGE);
        (busyError as Error & { cause?: unknown }).cause = error;
        throw busyError;
      }
      const delayMs = computeBackoffDelayMs(attempt, options);
      attempt += 1;
      await sleepFn(delayMs);
    }
  }
}

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
  private readonly retryOptions: RpcRetryOptions;
  private readonly escrows = new Map<string, EscrowRecord>();
  private readonly settlementReceipts = new Map<string, SettlementReceipt>();
  private readonly inFlightSettlements = new Map<
    string,
    Promise<SettlementReceipt>
  >();

  constructor(
    rpc: SolanaEscrowRpcLike = {},
    retryOptions: RpcRetryOptions = {},
    initialEscrows: EscrowRecord[] = []
  ) {
    this.rpc = rpc;
    this.retryOptions = retryOptions;
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

      const txResult = await withRpcRateLimitRetry(async () => {
        if (typeof this.rpc.submitSettlement === 'function') {
          return this.rpc.submitSettlement(nextRecord, request.idempotencyKey);
        }
        return {
          txSignature: `sig_${request.escrowId}_${request.idempotencyKey}`,
        };
      }, this.retryOptions);

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
