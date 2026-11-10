/**
 * solanaPay.ts
 * Solana Pay protocol helper for generating SPL-Token (USDC) QR codes & payment links.
 */

import type {
  Commitment,
  Connection,
  SignatureStatus,
} from "@solana/web3.js";

export const SOLANA_USDC_MINT_MAINNET =
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export const DEFAULT_TREASURY_SOLANA_ADDRESS =
  "WorkSpHere5oLanaPayUSDC111111111111111111111";

export const DEFAULT_MAX_RELAY_FEE_LAMPORTS = 10_000;

export interface GaslessTransactionRequest {
  transaction: string;
}

/**
 * Rejects transaction fees that could unexpectedly drain the relayer wallet.
 */
export function validateRelayFeeLamports(
  feeLamports: number,
  maxFeeLamports = DEFAULT_MAX_RELAY_FEE_LAMPORTS,
): number {
  if (!Number.isInteger(feeLamports) || !Number.isSafeInteger(feeLamports) || feeLamports <= 0) {
    throw new RangeError("Relay fee must be a positive integer greater than zero");
  }
  if (!Number.isInteger(maxFeeLamports) || !Number.isSafeInteger(maxFeeLamports) || maxFeeLamports <= 0) {
    throw new RangeError("Maximum relay fee must be a positive integer greater than zero");
  }
  if (feeLamports > maxFeeLamports) {
    throw new RangeError("Transaction fee exceeds the relayer limit");
  }
  return feeLamports;
}

export interface SolanaPayParams {
  recipient: string;
  amount: number; // USDC amount
  splToken?: string; // Mint address (default USDC)
  reference?: string; // Base58 or unique reference public key / string
  label?: string;
  message?: string;
  memo?: string;
}

export const SOLANA_PAY_DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes blockhash TTL

export interface SolanaPayStatusResponse {
  reference: string;
  status: "PENDING" | "PROCESSING" | "CONFIRMED" | "FAILED" | "EXPIRED";
  signature?: string;
  slot?: number;
  timestamp?: string;
  createdAt?: number;
  message?: string;
  error?: string;
}

export const DEFAULT_SOLANA_RPC_MAX_RETRIES_PER_ENDPOINT = 2;
export const DEFAULT_SOLANA_RPC_BASE_DELAY_MS = 250;
export const DEFAULT_SOLANA_RPC_MAX_DELAY_MS = 4_000;
export const DEFAULT_SOLANA_RPC_JITTER_RATIO = 0.2;

export interface SolanaRpcPoolConfig {
  /** Ordered RPC endpoints; the first healthy endpoint becomes the active node. */
  endpoints?: string[];
  /** Retries against the same endpoint before failing over to the next one. */
  maxRetriesPerEndpoint?: number;
  /** Initial delay for exponential backoff (milliseconds). */
  baseDelayMs?: number;
  /** Upper bound for exponential backoff (milliseconds). */
  maxDelayMs?: number;
  /** Portion of randomness added to each delay to avoid thundering herds. */
  jitterRatio?: number;
  commitment?: Commitment;
}

export interface ResolvedSolanaRpcPoolConfig {
  endpoints: string[];
  maxRetriesPerEndpoint: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
  commitment: Commitment;
}

export interface SolanaRpcPoolDependencies {
  createConnection?: (
    endpoint: string,
    commitment: Commitment,
  ) => Connection | Promise<Connection>;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  isRetryable?: (error: unknown) => boolean;
}

export type SolanaRpcOperation<T> = (
  connection: Connection,
  endpoint: string,
) => Promise<T>;

export interface SolanaRpcAttemptFailure {
  endpoint: string;
  error: string;
}

export class SolanaRpcFailoverError extends Error {
  public readonly attempts: SolanaRpcAttemptFailure[];

  constructor(
    attempts: SolanaRpcAttemptFailure[],
    message = "All Solana RPC endpoints failed",
  ) {
    super(message);
    this.name = "SolanaRpcFailoverError";
    this.attempts = attempts;
  }
}

const SOLANA_RPC_URL_PATTERN = /^https?:\/\//i;

function clampFiniteNumber(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

/**
 * Resolves an ordered, de-duplicated RPC endpoint list from the environment.
 * Supports a comma/whitespace separated `SOLANA_RPC_URLS` pool plus the legacy
 * `SOLANA_RPC_URL` and optional `SOLANA_RPC_FALLBACK_URLS` values.
 */
export function resolveSolanaRpcEndpoints(
  source: NodeJS.ProcessEnv = process.env,
): string[] {
  const candidates = [
    source.SOLANA_RPC_URLS,
    source.SOLANA_RPC_URL,
    source.SOLANA_RPC_FALLBACK_URLS,
  ];

  const endpoints: string[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    for (const piece of candidate.split(/[\s,]+/)) {
      const endpoint = piece.trim();
      if (
        endpoint &&
        SOLANA_RPC_URL_PATTERN.test(endpoint) &&
        !endpoints.includes(endpoint)
      ) {
        endpoints.push(endpoint);
      }
    }
  }

  return endpoints;
}

export function resolveSolanaRpcPoolConfig(
  config: SolanaRpcPoolConfig = {},
): ResolvedSolanaRpcPoolConfig {
  const configured = (config.endpoints ?? []).map((endpoint) => endpoint.trim());
  const endpoints = (
    configured.length > 0 ? configured : resolveSolanaRpcEndpoints()
  ).filter((endpoint) => SOLANA_RPC_URL_PATTERN.test(endpoint));

  const baseDelayMs = clampFiniteNumber(
    config.baseDelayMs,
    DEFAULT_SOLANA_RPC_BASE_DELAY_MS,
    0,
    60_000,
  );
  const maxDelayMs = clampFiniteNumber(
    config.maxDelayMs,
    DEFAULT_SOLANA_RPC_MAX_DELAY_MS,
    baseDelayMs,
    300_000,
  );

  return {
    endpoints: Array.from(new Set(endpoints)),
    maxRetriesPerEndpoint: Math.floor(
      clampFiniteNumber(
        config.maxRetriesPerEndpoint,
        DEFAULT_SOLANA_RPC_MAX_RETRIES_PER_ENDPOINT,
        0,
        10,
      ),
    ),
    baseDelayMs,
    maxDelayMs,
    jitterRatio: clampFiniteNumber(
      config.jitterRatio,
      DEFAULT_SOLANA_RPC_JITTER_RATIO,
      0,
      1,
    ),
    commitment: config.commitment ?? "confirmed",
  };
}

/**
 * Computes an exponential backoff delay with optional jitter.
 * attempt 0 -> baseDelayMs, attempt 1 -> 2 * baseDelayMs, capped at maxDelayMs.
 */
export function computeSolanaRpcBackoffDelay(
  attempt: number,
  baseDelayMs = DEFAULT_SOLANA_RPC_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_SOLANA_RPC_MAX_DELAY_MS,
  jitterRatio = DEFAULT_SOLANA_RPC_JITTER_RATIO,
  random: () => number = Math.random,
): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const safeBase = Math.max(0, baseDelayMs);
  const safeMax = Math.max(safeBase, maxDelayMs);
  const exponential = Math.min(safeMax, safeBase * Math.pow(2, safeAttempt));
  const jitter =
    exponential * Math.max(0, Math.min(1, jitterRatio)) * random();

  return Math.round(Math.min(safeMax, exponential + jitter));
}

const RETRYABLE_RPC_STATUS_CODES = new Set([429, 502, 503, 504]);

/**
 * Classifies RPC errors that are safe to retry/fail over. Rate limiting,
 * upstream gateway failures, and transient network errors are retryable;
 * deterministic request/validation errors are not.
 */
export function isRetryableSolanaRpcError(error: unknown): boolean {
  if (!error) return false;

  const candidate = error as {
    message?: unknown;
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };

  for (const code of [candidate.status, candidate.statusCode, candidate.code]) {
    if (typeof code === "number" && RETRYABLE_RPC_STATUS_CODES.has(code)) {
      return true;
    }
  }

  const message =
    typeof error === "string"
      ? error
      : typeof candidate.message === "string"
        ? candidate.message
        : "";

  if (!message) return false;

  const normalized = message.toLowerCase();
  return [
    "rate limit",
    "too many requests",
    "429",
    "502",
    "503",
    "504",
    "service unavailable",
    "bad gateway",
    "gateway timeout",
    "timeout",
    "timed out",
    "etimedout",
    "econnreset",
    "econnrefused",
    "enotfound",
    "eai_again",
    "socket hang up",
    "fetch failed",
    "network error",
    "temporarily unavailable",
    "node is unhealthy",
  ].some((token) => normalized.includes(token));
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Connection pool that rotates across configured Solana RPC endpoints.
 * Each endpoint is retried with exponential backoff for transient failures
 * before the pool fails over to the next node. Only after every endpoint has
 * been exhausted does `execute` throw a `SolanaRpcFailoverError`.
 */
export class SolanaRpcConnectionPool {
  private readonly config: ResolvedSolanaRpcPoolConfig;
  private readonly connections = new Map<string, Connection>();
  private readonly createConnection?: SolanaRpcPoolDependencies["createConnection"];
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly isRetryable: (error: unknown) => boolean;
  private activeIndex = 0;

  constructor(
    config: SolanaRpcPoolConfig = {},
    dependencies: SolanaRpcPoolDependencies = {},
  ) {
    this.config = resolveSolanaRpcPoolConfig(config);
    this.createConnection = dependencies.createConnection;
    this.sleep =
      dependencies.sleep ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.random = dependencies.random ?? Math.random;
    this.isRetryable = dependencies.isRetryable ?? isRetryableSolanaRpcError;
  }

  public getConfig(): ResolvedSolanaRpcPoolConfig {
    return { ...this.config, endpoints: [...this.config.endpoints] };
  }

  public getEndpoints(): string[] {
    return [...this.config.endpoints];
  }

  public getActiveEndpoint(): string | null {
    return this.config.endpoints[this.activeIndex] ?? null;
  }

  private async getConnection(endpoint: string): Promise<Connection> {
    const existing = this.connections.get(endpoint);
    if (existing) return existing;

    let connection: Connection;
    if (this.createConnection) {
      connection = await this.createConnection(endpoint, this.config.commitment);
    } else {
      const { Connection: SolanaConnection } = await import("@solana/web3.js");
      connection = new SolanaConnection(endpoint, this.config.commitment);
    }

    this.connections.set(endpoint, connection);
    return connection;
  }

  public async execute<T>(
    operation: SolanaRpcOperation<T>,
    overrides: {
      maxRetriesPerEndpoint?: number;
      baseDelayMs?: number;
      maxDelayMs?: number;
      jitterRatio?: number;
    } = {},
  ): Promise<T> {
    const { endpoints } = this.config;
    if (endpoints.length === 0) {
      throw new SolanaRpcFailoverError(
        [],
        "No Solana RPC endpoints are configured",
      );
    }

    const maxRetries = Math.floor(
      clampFiniteNumber(
        overrides.maxRetriesPerEndpoint,
        this.config.maxRetriesPerEndpoint,
        0,
        10,
      ),
    );
    const baseDelayMs = clampFiniteNumber(
      overrides.baseDelayMs,
      this.config.baseDelayMs,
      0,
      60_000,
    );
    const maxDelayMs = clampFiniteNumber(
      overrides.maxDelayMs,
      this.config.maxDelayMs,
      baseDelayMs,
      300_000,
    );
    const jitterRatio = clampFiniteNumber(
      overrides.jitterRatio,
      this.config.jitterRatio,
      0,
      1,
    );

    const failures: SolanaRpcAttemptFailure[] = [];
    const startIndex = this.activeIndex % endpoints.length;

    for (let offset = 0; offset < endpoints.length; offset += 1) {
      const index = (startIndex + offset) % endpoints.length;
      const endpoint = endpoints[index];
      const connection = await this.getConnection(endpoint);

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
          const result = await operation(connection, endpoint);
          this.activeIndex = index;
          return result;
        } catch (error) {
          failures.push({ endpoint, error: toErrorMessage(error) });

          if (attempt >= maxRetries || !this.isRetryable(error)) {
            break;
          }

          await this.sleep(
            computeSolanaRpcBackoffDelay(
              attempt,
              baseDelayMs,
              maxDelayMs,
              jitterRatio,
              this.random,
            ),
          );
        }
      }
    }

    this.activeIndex = (startIndex + 1) % endpoints.length;
    throw new SolanaRpcFailoverError(failures);
  }
}

export type SolanaPaymentVerificationStatus =
  | "CONFIRMED"
  | "PENDING"
  | "FAILED";

export interface SolanaPaymentVerification {
  status: SolanaPaymentVerificationStatus;
  signature: string;
  slot?: number;
  confirmationStatus?: string;
  error?: string;
  endpoint?: string;
}

export interface VerifySolanaPaymentOptions {
  pool?: SolanaRpcConnectionPool;
}

const BASE58_SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

let defaultSolanaRpcPool: SolanaRpcConnectionPool | null = null;

export function getSolanaRpcPool(
  config?: SolanaRpcPoolConfig,
): SolanaRpcConnectionPool {
  if (!defaultSolanaRpcPool) {
    defaultSolanaRpcPool = new SolanaRpcConnectionPool(config);
  }
  return defaultSolanaRpcPool;
}

export function resetSolanaRpcPool(): void {
  defaultSolanaRpcPool = null;
}

/**
 * Verifies a transaction signature across the configured RPC pool.
 *
 * Transient failures (429/5xx/network) are retried with exponential backoff
 * and then failed over to the next endpoint. If every endpoint is exhausted,
 * this throws `SolanaRpcFailoverError` so callers can keep the payment in a
 * pending state instead of incorrectly marking it unpaid.
 */
export async function verifySolanaPayment(
  signature: string,
  options: VerifySolanaPaymentOptions = {},
): Promise<SolanaPaymentVerification> {
  if (typeof signature !== "string" || signature.trim().length === 0) {
    return {
      status: "FAILED",
      signature,
      error: "Missing transaction signature",
    };
  }

  const trimmed = signature.trim();
  if (!BASE58_SIGNATURE_PATTERN.test(trimmed)) {
    return {
      status: "FAILED",
      signature: trimmed,
      error: "Invalid transaction signature",
    };
  }

  const pool = options.pool ?? getSolanaRpcPool();
  let endpoint: string | undefined;

  const response = await pool.execute(async (connection, activeEndpoint) => {
    endpoint = activeEndpoint;
    return connection.getSignatureStatuses([trimmed], {
      searchTransactionHistory: true,
    });
  });

  const status: SignatureStatus | null = response.value?.[0] ?? null;
  if (!status) {
    return { status: "PENDING", signature: trimmed, endpoint };
  }

  if (status.err) {
    return {
      status: "FAILED",
      signature: trimmed,
      slot: status.slot,
      error: toErrorMessage(status.err),
      endpoint,
    };
  }

  const confirmationStatus = status.confirmationStatus;
  const confirmed =
    confirmationStatus === "confirmed" ||
    confirmationStatus === "finalized" ||
    status.confirmations === null;

  return {
    status: confirmed ? "CONFIRMED" : "PENDING",
    signature: trimmed,
    slot: status.slot,
    confirmationStatus,
    endpoint,
  };
}

/**
 * Builds a standardized Solana Pay protocol URI string.
 * Format: solana:<recipient>?amount=<amount>&spl-token=<usdc_mint>&reference=<ref>&label=<label>&message=<message>&memo=<memo>
 */
export function createSolanaPayUrl(params: SolanaPayParams): string {
  const recipient = params.recipient || DEFAULT_TREASURY_SOLANA_ADDRESS;
  const amountStr = params.amount.toFixed(2);
  const splToken = params.splToken || SOLANA_USDC_MINT_MAINNET;

  const searchParams = new URLSearchParams();
  searchParams.set("amount", amountStr);
  searchParams.set("spl-token", splToken);

  if (params.reference) {
    searchParams.set("reference", params.reference);
  }
  if (params.label) {
    searchParams.set("label", params.label);
  }
  if (params.message) {
    searchParams.set("message", params.message);
  }
  if (params.memo) {
    searchParams.set("memo", params.memo);
  }

  return `solana:${recipient}?${searchParams.toString()}`;
}

/**
 * Generates a unique transaction reference ID for payment tracking.
 */
export function generateSolanaPaymentReference(): string {
  return `tx_sol_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Builds a link to view a confirmed transaction on Solana Explorer.
 */
export function getSolanaExplorerUrl(signature: string, cluster?: string): string {
  const clusterParam = cluster ? `?cluster=${encodeURIComponent(cluster)}` : "";
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${clusterParam}`;
}

/**
 * Checks if a Solana Pay transaction reference has exceeded its timeout TTL.
 */
export function isSolanaPaymentExpired(
  createdAt: number,
  timeoutMs = SOLANA_PAY_DEFAULT_TIMEOUT_MS,
  now = Date.now()
): boolean {
  return now - createdAt >= timeoutMs;
}

/**
 * Polls payment status from the status API, cleanly returning an EXPIRED status
 * when the transaction timeout / blockhash TTL is exceeded or when simulation errors occur.
 */
export async function pollPaymentStatus(
  reference: string,
  options: {
    statusApiUrl?: string;
    timeoutMs?: number;
    startTime?: number;
    signature?: string;
  } = {}
): Promise<SolanaPayStatusResponse> {
  const startTime = options.startTime ?? Date.now();
  const timeoutMs = options.timeoutMs ?? SOLANA_PAY_DEFAULT_TIMEOUT_MS;
  const baseUrl = options.statusApiUrl ?? "/api/payments/solana/status";

  // Check client-side expiration upfront
  if (Date.now() - startTime >= timeoutMs) {
    return {
      reference,
      status: "EXPIRED",
      message: "Transaction expired. Please generate a new QR code.",
      timestamp: new Date().toISOString(),
    };
  }

  try {
    const query = new URLSearchParams({ reference });
    if (options.signature) {
      query.set("signature", options.signature);
    }
    const res = await fetch(`${baseUrl}?${query.toString()}`);
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      return {
        reference,
        status: "FAILED",
        error: errBody.error || `HTTP error ${res.status}`,
        timestamp: new Date().toISOString(),
      };
    }
    const data: SolanaPayStatusResponse = await res.json();
    return data;
  } catch (err: any) {
    const errorMessage = err?.message || String(err);
    if (
      errorMessage.toLowerCase().includes("timeout") ||
      errorMessage.toLowerCase().includes("simulation failed") ||
      Date.now() - startTime >= timeoutMs
    ) {
      return {
        reference,
        status: "EXPIRED",
        message: "Transaction expired. Please generate a new QR code.",
        timestamp: new Date().toISOString(),
      };
    }
    return {
      reference,
      status: "FAILED",
      error: errorMessage,
      timestamp: new Date().toISOString(),
    };
  }
}
