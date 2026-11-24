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

    const numericCodes = [errObj.status, errObj.statusCode, errObj.code];
    if (numericCodes.some((val) => val === 429 || val === '429')) {
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

export interface EscrowAccountSnapshot {
  escrowId: string;
  status: 'funded' | 'released' | 'refunded' | 'pending';
  lamports: number;
}

export interface SolanaEscrowRpcLike {
  getAccountInfo?: (address: string) => Promise<unknown>;
  getEscrowStatus?: (escrowId: string) => Promise<EscrowAccountSnapshot>;
}

export class SolanaEscrowClient {
  private readonly rpc: SolanaEscrowRpcLike;
  private readonly retryOptions: RpcRetryOptions;

  constructor(rpc: SolanaEscrowRpcLike, retryOptions: RpcRetryOptions = {}) {
    this.rpc = rpc;
    this.retryOptions = retryOptions;
  }

  public async getEscrowStatus(escrowId: string): Promise<EscrowAccountSnapshot> {
    return withRpcRateLimitRetry(async () => {
      if (typeof this.rpc.getEscrowStatus === 'function') {
        return this.rpc.getEscrowStatus(escrowId);
      }
      if (typeof this.rpc.getAccountInfo === 'function') {
        const info = await this.rpc.getAccountInfo(escrowId);
        return {
          escrowId,
          status: info ? 'funded' : 'pending',
          lamports: 0,
        };
      }
      throw new Error('No RPC method available on escrow client');
    }, this.retryOptions);
  }
}
