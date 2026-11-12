import {
  Connection,
  SimulatedTransactionResponse,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

export const DEFAULT_SIMULATION_TIMEOUT_MS = 8000;
export const RETRY_BASE_DELAYS_MS = [500, 1500, 3000] as const;

export type SimulationSuccessResult = {
  success: true;
  simulation: SimulatedTransactionResponse;
  rpcEndpoint: string;
  attempts: number;
};

export type SimulationFailureResult = {
  success: false;
  error: "RPC_SIMULATION_TIMEOUT" | "RPC_SIMULATION_FAILED";
  message: string;
  retryable: boolean;
  attempts: number;
};

export type EscrowSimulationResult =
  SimulationSuccessResult | SimulationFailureResult;

export interface SimulateEscrowOptions {
  timeoutMs?: number;
  maxRetries?: number;
  baseDelaysMs?: readonly number[];
  primaryRpcUrl?: string;
  fallbackRpcUrl?: string;
  connectionFactory?: (endpoint: string) => Connection;
  sleepFn?: (ms: number) => Promise<void>;
}

class RpcTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Solana RPC simulation timed out after ${timeoutMs}ms`);
    this.name = "RpcTimeoutError";
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeBackoffWithJitter(baseDelayMs: number): number {
  // Add up to 20% positive jitter to prevent thundering herd retries
  const jitter = Math.floor(
    Math.random() * Math.max(1, Math.round(baseDelayMs * 0.2)),
  );
  return baseDelayMs + jitter;
}

export function isTransientRpcError(err: unknown): boolean {
  if (err instanceof RpcTimeoutError) return true;
  if (!(err instanceof Error)) return false;

  const message = `${err.name} ${err.message}`.toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("fetcherror") ||
    message.includes("429") ||
    message.includes("503") ||
    message.includes("too many requests") ||
    message.includes("service unavailable") ||
    message.includes("econnreset") ||
    message.includes("socket hang up")
  );
}

async function simulateWithTimeout(
  connection: Connection,
  transaction: Transaction | VersionedTransaction,
  timeoutMs: number,
): Promise<SimulatedTransactionResponse> {
  let timerId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      reject(new RpcTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  const simulationPromise = (async () => {
    const response =
      transaction instanceof VersionedTransaction
        ? await connection.simulateTransaction(transaction)
        : await connection.simulateTransaction(transaction);
    return response.value;
  })();

  try {
    return await Promise.race([simulationPromise, timeoutPromise]);
  } finally {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
  }
}

export async function simulateEscrowTransaction(
  transaction: Transaction | VersionedTransaction,
  options: SimulateEscrowOptions = {},
): Promise<EscrowSimulationResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SIMULATION_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? 3;
  const baseDelays = options.baseDelaysMs ?? RETRY_BASE_DELAYS_MS;
  const sleep = options.sleepFn ?? defaultSleep;

  const primaryUrl =
    options.primaryRpcUrl ??
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
    "https://api.devnet.solana.com";
  const fallbackUrl =
    options.fallbackRpcUrl ??
    process.env.NEXT_PUBLIC_SOLANA_RPC_FALLBACK_URL?.trim();

  const createConnection =
    options.connectionFactory ??
    ((endpoint: string) => new Connection(endpoint, "confirmed"));

  const endpoints =
    fallbackUrl && fallbackUrl !== primaryUrl
      ? [primaryUrl, fallbackUrl]
      : [primaryUrl];

  let totalAttempts = 0;
  let lastError: unknown = null;

  for (const endpoint of endpoints) {
    const connection = createConnection(endpoint);

    for (let retryIndex = 0; retryIndex <= maxRetries; retryIndex += 1) {
      totalAttempts += 1;
      try {
        const simulation = await simulateWithTimeout(
          connection,
          transaction,
          timeoutMs,
        );

        if (simulation.err) {
          return {
            success: false,
            error: "RPC_SIMULATION_FAILED",
            message: `Transaction simulation rejected: ${JSON.stringify(simulation.err)}`,
            retryable: false,
            attempts: totalAttempts,
          };
        }

        return {
          success: true,
          simulation,
          rpcEndpoint: endpoint,
          attempts: totalAttempts,
        };
      } catch (err: unknown) {
        lastError = err;

        if (!isTransientRpcError(err)) {
          return {
            success: false,
            error: "RPC_SIMULATION_FAILED",
            message:
              err instanceof Error ? err.message : "Solana simulation error",
            retryable: false,
            attempts: totalAttempts,
          };
        }

        if (retryIndex < maxRetries) {
          const baseDelay =
            baseDelays[Math.min(retryIndex, baseDelays.length - 1)];
          await sleep(computeBackoffWithJitter(baseDelay));
        }
      }
    }
  }

  const timedOut = isTransientRpcError(lastError);
  return {
    success: false,
    error: timedOut ? "RPC_SIMULATION_TIMEOUT" : "RPC_SIMULATION_FAILED",
    message:
      lastError instanceof Error
        ? lastError.message
        : "Solana RPC simulation timed out across available nodes",
    retryable: timedOut,
    attempts: totalAttempts,
  };
}
