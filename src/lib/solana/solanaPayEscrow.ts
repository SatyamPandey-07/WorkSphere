/**
 * solanaPayEscrow.ts
 *
 * Implements optimistic UI updates and confirmation listeners for Solana Pay seat bookings.
 * Enhances seat reservation payments so transactions update the UI optimistically while tracking
 * Solana RPC commitment progress (confirmed -> finalized).
 *
 * Features:
 * 1. Transition seat state to provisionally_reserved immediately upon wallet signature approval.
 * 2. Subscribe to RPC onSignatureWithOptions WebSocket for transaction confirmation.
 * 3. Fall back to background status polling (confirmed -> finalized) when WebSocket
 *    subscriptions cannot be registered (e.g. rate-limited RPC endpoints) or when the
 *    caller explicitly requests polling mode with an injectable, failover-aware poller.
 * 4. Roll back to available with user-friendly error message if the transaction fails or drops from mempool after 60 seconds.
 * 5. Anti-spam Proof-of-Work validation support using ProofOfWorkValidator.
 */

import type { Connection, SignatureStatus } from "@solana/web3.js";
import {
  ProofOfWorkValidator,
  type PoWSubmission,
} from "@/core/ledger/ProofOfWorkValidator";

export const DEFAULT_CONFIRMATION_TIMEOUT_MS = 60_000; // 60 seconds
export const DEFAULT_POLL_INTERVAL_MS = 2_000; // 2 seconds

export const DEFAULT_ESCROW_COMPUTE_UNIT_LIMIT = 250_000;
export const DEFAULT_ESCROW_MAX_RETRIES = 3;
export const DEFAULT_ESCROW_BASE_BACKOFF_MS = 1_000;
export const DEFAULT_ESCROW_MAX_BACKOFF_MS = 8_000;
export const DEFAULT_ESCROW_FEE_BUMP_MULTIPLIER = 1.5;

export const DEFAULT_RPC_POLL_TIMEOUT_MS = 5_000; // 5 seconds strict abort timeout (#9448)
export const STATUS_TIMEOUT = "timeout" as const;

export class SolanaRpcPollTimeoutError extends Error {
  constructor(message = "Solana RPC status poll timed out after 5000ms") {
    super(message);
    this.name = "SolanaRpcPollTimeoutError";
  }
}

// Exponential backoff with full jitter defaults for RPC HTTP 429 (#9510)
export const DEFAULT_RPC_429_MAX_RETRIES = 5;
export const DEFAULT_RPC_429_BASE_DELAY_MS = 500;
export const DEFAULT_RPC_429_MAX_DELAY_MS = 8_000;

export interface Rpc429RetryOptions {
  /** Maximum consecutive 429 retry attempts before failing (default: 5). */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default: 500). */
  baseDelayMs?: number;
  /** Maximum delay cap in ms for exponential backoff (default: 8,000). */
  maxDelayMs?: number;
  /** Custom random function for deterministic testing (returns in [0, 1)). */
  randomFn?: () => number;
}

/**
 * Detects whether an error represents an HTTP 429 (Too Many Requests) or rate limit.
 * Supports standard HTTP status codes, Fetch/Axios error shapes, Solana RPC errors,
 * and rate-limit error messages, without confusing unrelated failures as 429.
 */
export function isSolanaRpcRateLimitError(error: unknown): boolean {
  if (!error) return false;

  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    name?: unknown;
    message?: unknown;
    response?: { status?: unknown; statusCode?: unknown };
  };

  for (const code of [
    candidate.status,
    candidate.statusCode,
    candidate.code,
    candidate.response?.status,
    candidate.response?.statusCode,
  ]) {
    if (code === 429 || code === "429") {
      return true;
    }
  }

  const name = typeof candidate.name === "string" ? candidate.name : "";
  if (name === "RateLimitError" || name === "TooManyRequestsError") {
    return true;
  }

  const message =
    typeof error === "string"
      ? error
      : typeof candidate.message === "string"
        ? candidate.message
        : "";

  if (!message) return false;

  const normalized = message.toLowerCase();
  return (
    normalized.includes("429") ||
    normalized.includes("too many requests") ||
    normalized.includes("rate limit") ||
    normalized.includes("ratelimit") ||
    normalized.includes("resource exhausted") ||
    normalized.includes("exceeded rate limit")
  );
}

/**
 * Reads a header from various header containers (Headers instance, plain Record, or nested in error.response).
 */
function readHeaderValue(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;

  const getter = (headers as { get?: unknown }).get;
  if (typeof getter === "function") {
    const val = (getter as (header: string) => unknown).call(headers, name);
    if (typeof val === "string") return val;
  }

  const record = headers as Record<string, unknown>;
  const lowerName = name.toLowerCase();
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === lowerName) {
      const val = record[key];
      return typeof val === "string" ? val : typeof val === "number" ? String(val) : undefined;
    }
  }

  return undefined;
}

/**
 * Extracts and parses a Retry-After header from an RPC error, returning delay in milliseconds.
 * Supports integer delta-seconds, floating seconds, and HTTP-date formats.
 * Returns undefined if header is absent, invalid, or negative.
 */
export function parseRetryAfterMs(error: unknown, now: number = Date.now()): number | undefined {
  if (!error || typeof error !== "object") return undefined;

  const candidate = error as {
    headers?: unknown;
    response?: { headers?: unknown };
    retryAfter?: unknown;
  };

  // If error has a direct retryAfter property (numeric seconds or ms)
  if (typeof candidate.retryAfter === "number" && Number.isFinite(candidate.retryAfter) && candidate.retryAfter > 0) {
    // If > 1000, likely already in ms, otherwise seconds
    return candidate.retryAfter > 1000 ? Math.round(candidate.retryAfter) : Math.round(candidate.retryAfter * 1000);
  }

  const rawHeader =
    readHeaderValue(candidate.headers, "retry-after") ??
    readHeaderValue(candidate.response?.headers, "retry-after");

  if (!rawHeader) return undefined;
  const trimmed = rawHeader.trim();
  if (!trimmed) return undefined;

  // 1. Delta-seconds format (e.g. "3", "2.5")
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const sec = parseFloat(trimmed);
    return Number.isFinite(sec) && sec >= 0 ? Math.round(sec * 1000) : undefined;
  }

  // 2. HTTP-date format (e.g. "Wed, 21 Oct 2026 07:28:00 GMT")
  const parsedDate = Date.parse(trimmed);
  if (!Number.isNaN(parsedDate)) {
    return Math.max(0, parsedDate - now);
  }

  return undefined;
}

/**
 * Computes exponential backoff with full jitter for attempt number (0-indexed).
 * Full jitter: delay = random * min(maxDelay, baseDelay * 2 ** attempt)
 */
export function computeRpc429Delay(
  attempt: number,
  options: Rpc429RetryOptions = {},
): number {
  const baseDelay = options.baseDelayMs ?? DEFAULT_RPC_429_BASE_DELAY_MS;
  const maxDelay = options.maxDelayMs ?? DEFAULT_RPC_429_MAX_DELAY_MS;
  const randomFn = options.randomFn ?? Math.random;

  const expDelay = Math.min(maxDelay, baseDelay * Math.pow(2, Math.max(0, attempt)));
  const rand = randomFn();
  const validRand = typeof rand === "number" && Number.isFinite(rand) && rand >= 0 && rand <= 1 ? rand : 0.5;
  return Math.round(validRand * expDelay);
}


export type SeatConfirmationMode = "websocket" | "polling";

export type SeatState =
  "available" | "provisionally_reserved" | "confirmed" | "finalized";

export type PaymentConfirmationStage =
  "pending" | "confirmed" | "finalized" | "failed" | "timeout";

export interface SolanaPayEscrowRetryConfig {
  /** Maximum number of retry attempts before rolling back (default: 3). */
  maxRetries?: number;
  /** Base backoff delay in ms between retries (default: 1,000ms). */
  baseBackoffMs?: number;
  /** Maximum backoff delay in ms (default: 8,000ms). */
  maxBackoffMs?: number;
  /** Multiplier for priority fee on retry attempts (default: 1.5). */
  feeBumpMultiplier?: number;
  /** Dedicated compute unit limit for the transaction (default: 250,000). */
  computeUnitLimit?: number;
  /** Base priority fee in micro-lamports (default: 5,000). */
  priorityFeeMicroLamports?: number;
}

export type EscrowReservationRetryConfig = SolanaPayEscrowRetryConfig;

export interface SeatReservationState {
  seatId: string;
  venueId: string;
  state: SeatState;
  paymentStatus: PaymentConfirmationStage;
  signature?: string;
  payerWallet?: string;
  amount?: number;
  currency?: "SOL" | "USDC";
  error?: string | null;
  slot?: number;
  updatedAt: number;
  retryAttempt?: number;
  lastValidBlockHeight?: number;
  recentBlockhash?: string;
}

export interface SeatReservationCallbacks {
  onStateChange?: (state: SeatReservationState) => void;
  onProvisionallyReserved?: (state: SeatReservationState) => void;
  onConfirmed?: (state: SeatReservationState) => void;
  onFinalized?: (state: SeatReservationState) => void;
  onError?: (error: Error, state: SeatReservationState) => void;
  onRollback?: (reason: string, state: SeatReservationState) => void;
  onRetry?: (
    attempt: number,
    reason: string,
    state: SeatReservationState,
  ) => void;
}

export interface ReserveSeatOptions {
  connection: Connection;
  seatId: string;
  venueId: string;
  signature: string;
  payerWallet: string;
  amount: number;
  currency?: "SOL" | "USDC";
  timeoutMs?: number;
  powSubmission?: PoWSubmission;
  callbacks?: SeatReservationCallbacks;
  /**
   * How the (confirmed -> finalized) commitment progress is tracked.
   * - "websocket" (default): subscribes via onSignatureWithOptions notifications.
   * - "polling": background RPC status polling until finality.
   */
  confirmationMode?: SeatConfirmationMode;
  /**
   * Optional failover-aware signature status poller used in polling mode.
   * Defaults to polling the provided connection's getSignatureStatuses.
   */
  pollSignatureStatus?: (
    signature: string,
    options?: { signal?: AbortSignal },
  ) => Promise<SignatureStatus | null>;
  /** Interval between background status polls (polling mode only). */
  pollIntervalMs?: number;

  /** Recent blockhash of the submitted transaction for expiration tracking. */
  recentBlockhash?: string;
  /** Block height after which the transaction's blockhash expires. */
  lastValidBlockHeight?: number;
  /** Retry and backoff configuration under congestion/slot expiration. */
  retryConfig?: SolanaPayEscrowRetryConfig;
  /**
   * Optional resubmission handler invoked when blockhash expires.
   * Re-queries latest blockhash, re-signs/updates payload, and broadcasts new transaction.
   */
  resubmitTransaction?: (
    freshBlockhash: string,
    lastValidBlockHeight: number,
    suggestedPriorityFeeMicroLamports?: number,
  ) => Promise<string>;
  /** Optional callback fired when a retry attempt is initiated. */
  onRetryAttempt?: (attempt: number, error: Error, nextDelayMs: number) => void;

  /** Optional RPC HTTP 429 retry options (polling mode). */
  rpc429RetryOptions?: Rpc429RetryOptions;
  /**
   * Secondary fallback RPC connection used when primary RPC polls time out (#9448).
   */
  fallbackConnection?: Connection;
  /** Alias for fallbackConnection (#9448). */
  secondaryConnection?: Connection;
  /**
   * Secondary fallback signature status poller called when primary poll times out (#9448).
   */
  fallbackPollSignatureStatus?: (
    signature: string,
    options?: { signal?: AbortSignal },
  ) => Promise<SignatureStatus | null>;
  /**
   * Timeout in ms for each individual RPC status poll attempt (default: 5,000ms) (#9448).
   */
  pollTimeoutMs?: number;
  /**
   * Optional AbortSignal to cleanly cancel the reservation and clean up active polling and timers (#9448).
   */
  signal?: AbortSignal;

}

interface ActiveSubscription {
  seatId: string;
  signature: string;
  confirmedSubId?: number;
  finalizedSubId?: number;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  pollTimer?: ReturnType<typeof setTimeout>;
  pollAborted?: boolean;
  connection: Connection;
  fallbackConnection?: Connection;
  pollSignatureStatus?: (
    signature: string,
    options?: { signal?: AbortSignal },
  ) => Promise<SignatureStatus | null>;
  fallbackPollSignatureStatus?: (
    signature: string,
    options?: { signal?: AbortSignal },
  ) => Promise<SignatureStatus | null>;
  pollTimeoutMs?: number;
  activeAbortController?: AbortController;
  parentSignal?: AbortSignal;
  parentAbortHandler?: () => void;
  callbacks?: SeatReservationCallbacks;
  stateRemovers?: Array<() => void>;

  recentBlockhash?: string;
  lastValidBlockHeight?: number;
  retryConfig?: SolanaPayEscrowRetryConfig;
  resubmitTransaction?: (
    freshBlockhash: string,
    lastValidBlockHeight: number,
    suggestedPriorityFeeMicroLamports?: number,
  ) => Promise<string>;
  onRetryAttempt?: (attempt: number, error: Error, nextDelayMs: number) => void;
  attempt: number;
  timeoutMs: number;
  pollIntervalMs: number;
  pollSignatureStatus?: (signature: string) => Promise<SignatureStatus | null>;
  confirmationMode: SeatConfirmationMode;
  isRetrying?: boolean;
}

/**
 * Checks if an error corresponds to Solana blockhash/slot expiration.
 */
export function isBlockhashExpiredError(error: unknown): boolean {
  if (!error) return false;
  const msg =
    typeof error === "string"
      ? error
      : ((error as any)?.message ?? JSON.stringify(error));
  return (
    msg.includes("Blockhash not found") ||
    msg.includes("TransactionExpiredBlockheightExceededError") ||
    msg.includes("blockhash has expired") ||
    msg.includes("BlockheightExceeded") ||
    msg.includes("BlockhashNotFound") ||
    msg.includes("has expired") ||
    msg.includes("slot expiration")
  );
}

/**
 * Calculates stepped micro-lamport priority fee with multiplier bound for retry attempts.
 */
export function calculatePriorityFeeForAttempt(
  baseMicroLamports: number,
  attempt: number,
  multiplier = DEFAULT_ESCROW_FEE_BUMP_MULTIPLIER,
  maxMicroLamports = 1_000_000,
): number {
  if (attempt <= 0) return Math.min(baseMicroLamports, maxMicroLamports);
  const bumped = Math.round(baseMicroLamports * Math.pow(multiplier, attempt));
  return Math.min(bumped, maxMicroLamports);
}

/**
 * Verifies whether the block height on-chain has surpassed lastValidBlockHeight.
 */
export async function verifyBlockheightExpiration(
  connection: Connection,
  lastValidBlockHeight?: number,
): Promise<{
  expired: boolean;
  currentBlockHeight?: number;
  lastValidBlockHeight?: number;
}> {
  if (typeof lastValidBlockHeight !== "number" || lastValidBlockHeight <= 0) {
    return { expired: false, lastValidBlockHeight };
  }
  try {
    const currentBlockHeight = await connection.getBlockHeight("confirmed");
    return {
      expired: currentBlockHeight > lastValidBlockHeight,
      currentBlockHeight,
      lastValidBlockHeight,
    };
  } catch (err) {
    console.warn(
      "[SolanaPayEscrow] Failed to query current block height:",
      err,
    );
    return { expired: false, lastValidBlockHeight };
  }
}

/**
 * Queries the latest blockhash with exponential backoff on transient RPC errors.
 */
export async function fetchLatestBlockhashWithBackoff(
  connection: Connection,
  maxRetries = DEFAULT_ESCROW_MAX_RETRIES,
  baseBackoffMs = 500,
): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await connection.getLatestBlockhash("confirmed");
    } catch (err) {
      lastErr = err;
      if (attempt + 1 < maxRetries) {
        const delay = baseBackoffMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastErr;

  rpc429ConsecutiveCount?: number;
  timeoutEndMs?: number;
  rpc429RetryOptions?: Rpc429RetryOptions;
  activeConnectionIsFallback?: boolean;

}

/**
 * Default signature status poller that queries the provided connection directly.
 * Used as the fallback poller when no failover-aware poller is injected.
 */
async function fetchSignatureStatusViaConnection(
  connection: Connection,
  signature: string,
  options?: { signal?: AbortSignal },
): Promise<SignatureStatus | null> {
  const signal = options?.signal;
  if (signal?.aborted) {
    throw signal.reason || new Error("Aborted");
  }

  const fetchPromise = Promise.resolve().then(() =>
    connection.getSignatureStatuses?.([signature], {
      searchTransactionHistory: true,
    }),
  );

  if (!signal) {
    const response = await fetchPromise;
    return response?.value?.[0] ?? null;
  }

  let abortHandler: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    abortHandler = () => {
      reject(signal.reason || new Error("Aborted"));
    };
    signal.addEventListener("abort", abortHandler, { once: true });
  });

  try {
    const response = await Promise.race([fetchPromise, abortPromise]);
    return response?.value?.[0] ?? null;
  } finally {
    if (abortHandler) {
      signal.removeEventListener("abort", abortHandler);
    }
  }
}

export class SolanaPayEscrowManager {
  private reservations: Map<string, SeatReservationState> = new Map();
  private activeSubscriptions: Map<string, ActiveSubscription> = new Map();
  private powValidator: ProofOfWorkValidator;

  constructor(powValidator?: ProofOfWorkValidator) {
    this.powValidator = powValidator || new ProofOfWorkValidator();
  }

  /**
   * Validates optional Proof-of-Work submission to protect seat reservations against spam/bots.
   */
  public validatePoW(submission: PoWSubmission): boolean {
    return this.powValidator.validate(submission);
  }

  /**
   * Gets current state of a seat reservation.
   */
  public getSeatState(seatId: string): SeatReservationState | null {
    return this.reservations.get(seatId) ?? null;
  }

  /**
   * Gets all active reservations.
   */
  public getAllReservations(): Map<string, SeatReservationState> {
    return new Map(this.reservations);
  }

  /**
   * Resets all internal state and clears all active WebSocket listeners and timers.
   */
  public reset(): void {
    for (const [seatId] of this.activeSubscriptions) {
      this.cleanupSubscription(seatId);
    }
    this.activeSubscriptions.clear();
    this.reservations.clear();
  }

  /**
   * Optimistically reserves a seat and initiates confirmation tracking.
   */
  public async reserveSeatOptimistically(
    options: ReserveSeatOptions,
  ): Promise<SeatReservationState> {
    const {
      connection,
      seatId,
      venueId,
      signature,
      payerWallet,
      amount,
      currency = "SOL",
      timeoutMs = DEFAULT_CONFIRMATION_TIMEOUT_MS,
      powSubmission,
      callbacks,
      confirmationMode = "websocket",
      pollSignatureStatus,
      pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
      rpc429RetryOptions,
      fallbackConnection,
      secondaryConnection,
      fallbackPollSignatureStatus,
      pollTimeoutMs = DEFAULT_RPC_POLL_TIMEOUT_MS,
      signal,
    } = options;

    if (!seatId || typeof seatId !== "string" || !seatId.trim()) {
      throw new Error("seatId is required");
    }
    if (!venueId || typeof venueId !== "string" || !venueId.trim()) {
      throw new Error("venueId is required");
    }
    if (!signature || typeof signature !== "string" || !signature.trim()) {
      throw new Error("Transaction signature is required");
    }
    if (
      !payerWallet ||
      typeof payerWallet !== "string" ||
      !payerWallet.trim()
    ) {
      throw new Error("payerWallet address is required");
    }

    // Anti-spam PoW check if provided
    if (powSubmission) {
      const isValid = this.validatePoW(powSubmission);
      if (!isValid) {
        throw new Error(
          "Invalid Proof-of-Work: anti-spam challenge validation failed",
        );
      }
    }

    // Check if already reserved
    const existing = this.reservations.get(seatId);
    if (
      existing &&
      (existing.state === "provisionally_reserved" ||
        existing.state === "confirmed" ||
        existing.state === "finalized")
    ) {
      if (existing.signature !== signature) {
        throw new Error(
          `Seat ${seatId} is already ${existing.state}. Cannot override with new reservation.`,
        );
      }
    }

    // 1. Transition state to provisionally_reserved immediately upon signature approval
    const initialState: SeatReservationState = {
      seatId,
      venueId,
      state: "provisionally_reserved",
      paymentStatus: "pending",
      signature,
      payerWallet,
      amount,
      currency,
      error: null,
      updatedAt: Date.now(),
      retryAttempt: 0,
      lastValidBlockHeight: options.lastValidBlockHeight,
      recentBlockhash: options.recentBlockhash,
    };

    this.reservations.set(seatId, initialState);

    // Notify UI immediately so reservation feels instantaneous
    try {
      callbacks?.onStateChange?.(initialState);
      callbacks?.onProvisionallyReserved?.(initialState);
    } catch (err) {
      console.error("[SolanaPayEscrow] Error in optimistic callback:", err);
    }

    // Clean up any stale subscription for this seat before starting a new one
    this.cleanupSubscription(seatId);

    const effectiveFallbackConn = fallbackConnection ?? secondaryConnection;

    // Handle early abortion signal
    if (signal?.aborted) {
      const rolledBack = this.rollback(
        seatId,
        "Reservation aborted by client",
        "failed",
      );
      return (
        rolledBack ?? {
          ...initialState,
          state: "available",
          paymentStatus: "failed",
          error: "Reservation aborted by client",
          updatedAt: Date.now(),
        }
      );
    }

    // 2. Track confirmation (WebSocket notifications or background status polling) & start timeout
    if (confirmationMode === "polling") {
      this.startPollingConfirmation(
        connection,
        seatId,
        signature,
        timeoutMs,
        pollIntervalMs,
        pollSignatureStatus,
        callbacks,

        options.lastValidBlockHeight,
        options.recentBlockhash,
        options.retryConfig,
        options.resubmitTransaction,
        options.onRetryAttempt,

        rpc429RetryOptions,
        effectiveFallbackConn,
        fallbackPollSignatureStatus,
        pollTimeoutMs,
        signal,

      );
    } else {
      this.subscribeToSignatureUpdates(
        connection,
        seatId,
        signature,
        timeoutMs,
        callbacks,
        pollIntervalMs,
        pollSignatureStatus,

        options.lastValidBlockHeight,
        options.recentBlockhash,
        options.retryConfig,
        options.resubmitTransaction,
        options.onRetryAttempt,

        rpc429RetryOptions,
        effectiveFallbackConn,
        fallbackPollSignatureStatus,
        pollTimeoutMs,
        signal,

      );
    }

    return initialState;
  }

  /**
   * Subscribes to Solana RPC WebSocket commitment notifications (confirmed -> finalized).
   * If both subscriptions cannot be registered (e.g. the RPC endpoint rejects them),
   * falls back to background status polling so the reservation never gets stuck.
   */
  private subscribeToSignatureUpdates(
    connection: Connection,
    seatId: string,
    signature: string,
    timeoutMs: number,
    callbacks?: SeatReservationCallbacks,
    pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
    pollSignatureStatus?: (
      signature: string,
      options?: { signal?: AbortSignal },
    ) => Promise<SignatureStatus | null>,

    lastValidBlockHeight?: number,
    recentBlockhash?: string,
    retryConfig?: SolanaPayEscrowRetryConfig,
    resubmitTransaction?: (
      freshBlockhash: string,
      lastValidBlockHeight: number,
      suggestedPriorityFeeMicroLamports?: number,
    ) => Promise<string>,
    onRetryAttempt?: (
      attempt: number,
      error: Error,
      nextDelayMs: number,
    ) => void,

    rpc429RetryOptions?: Rpc429RetryOptions,
    fallbackConnection?: Connection,
    fallbackPollSignatureStatus?: (
      signature: string,
      options?: { signal?: AbortSignal },
    ) => Promise<SignatureStatus | null>,
    pollTimeoutMs: number = DEFAULT_RPC_POLL_TIMEOUT_MS,
    signal?: AbortSignal,

  ): void {
    const subRecord: ActiveSubscription = {
      seatId,
      signature,
      connection,
      fallbackConnection,
      pollSignatureStatus,
      fallbackPollSignatureStatus,
      pollTimeoutMs,
      callbacks,

      lastValidBlockHeight,
      recentBlockhash,
      retryConfig,
      resubmitTransaction,
      onRetryAttempt,
      attempt: 0,
      timeoutMs,
      pollIntervalMs,
      pollSignatureStatus,
      confirmationMode: "websocket",
    };

    // 3. Confirmation timeout & slot expiration verification

      timeoutEndMs: Date.now() + timeoutMs,
      rpc429ConsecutiveCount: 0,
      rpc429RetryOptions,
    };

    if (signal) {
      const parentAbortHandler = () => {
        this.rollback(seatId, "Reservation aborted by client", "failed");
      };
      signal.addEventListener("abort", parentAbortHandler, { once: true });
      subRecord.parentSignal = signal;
      subRecord.parentAbortHandler = parentAbortHandler;
    }

    // 3. 60-Second timeout: rollback to available if transaction drops from mempool

    subRecord.timeoutTimer = setTimeout(() => {
      void this.handleTimeoutOrExpiration(seatId);
    }, timeoutMs);
    subRecord.timeoutTimer.unref?.();

    // Fallback trigger helper to initiate background polling if WebSocket disconnects
    let fallbackInitiated = false;
    const triggerFallbackPolling = (reason: string) => {
      if (fallbackInitiated || subRecord.pollTimer || subRecord.pollAborted)
        return;
      fallbackInitiated = true;
      console.warn(
        `[SolanaPayEscrow] WebSocket subscription degraded (${reason}); activating background status polling fallback.`,
      );
      this.scheduleNextPoll(
        subRecord,
        signature,
        pollIntervalMs,
        pollSignatureStatus,
      );
    };

    const attachDisconnectListener = (subId: number) => {
      let wasSubscribed = false;
      const connAny = connection as any;
      if (typeof connAny._onSubscriptionStateChange === "function") {
        try {
          const remove = connAny._onSubscriptionStateChange(
            subId,
            (state: string) => {
              if (state === "subscribed") {
                wasSubscribed = true;
              } else if (state === "error") {
                triggerFallbackPolling("subscription error");
              } else if (state === "pending" && wasSubscribed) {
                triggerFallbackPolling("subscription dropped to pending");
              }
            },
          );
          if (typeof remove === "function") {
            subRecord.stateRemovers = subRecord.stateRemovers || [];
            subRecord.stateRemovers.push(remove);
          }
        } catch {}
      }
    };

    // Handle WebSocket listener for 'confirmed' commitment
    try {
      subRecord.confirmedSubId = connection.onSignatureWithOptions(
        signature,
        (notification, context) => {
          const err = (notification as any).err;
          if (err) {
            if (isBlockhashExpiredError(err)) {
              void this.handleTimeoutOrExpiration(seatId);
              return;
            }
            const errorMsg =
              typeof err === "string" ? err : JSON.stringify(err);
            const reason = `Transaction failed on-chain: ${errorMsg}. Seat reservation reverted to available.`;
            this.rollback(seatId, reason, "failed");
            return;
          }

          // Transition to confirmed
          this.transitionToConfirmed(seatId, context?.slot, callbacks);
        },
        { commitment: "confirmed" },
      );
      if (subRecord.confirmedSubId !== undefined) {
        attachDisconnectListener(subRecord.confirmedSubId);
      }
    } catch (err) {
      console.error(
        "[SolanaPayEscrow] Failed to subscribe to confirmed notification:",
        err,
      );
    }

    // Handle WebSocket listener for 'finalized' commitment
    try {
      subRecord.finalizedSubId = connection.onSignatureWithOptions(
        signature,
        (notification, context) => {
          const err = (notification as any).err;
          if (err) {
            if (isBlockhashExpiredError(err)) {
              void this.handleTimeoutOrExpiration(seatId);
              return;
            }
            const errorMsg =
              typeof err === "string" ? err : JSON.stringify(err);
            const reason = `Transaction failed on-chain during finalization: ${errorMsg}. Seat reservation reverted to available.`;
            this.rollback(seatId, reason, "failed");
            return;
          }

          // Transition to finalized
          this.transitionToFinalized(seatId, context?.slot, callbacks);
        },
        { commitment: "finalized" },
      );
      if (subRecord.finalizedSubId !== undefined) {
        attachDisconnectListener(subRecord.finalizedSubId);
      }
    } catch (err) {
      console.error(
        "[SolanaPayEscrow] Failed to subscribe to finalized notification:",
        err,
      );
    }

    // Attach connection-level socket close/error listeners if present
    const connAny = connection as any;
    if (typeof connAny.on === "function") {
      const onSocketClose = () => triggerFallbackPolling("socket closed/error");
      connAny.on("close", onSocketClose);
      connAny.on("error", onSocketClose);
      connAny.on("disconnect", onSocketClose);
      subRecord.stateRemovers = subRecord.stateRemovers || [];
      subRecord.stateRemovers.push(() => {
        try {
          connAny.off?.("close", onSocketClose);
          connAny.off?.("error", onSocketClose);
          connAny.off?.("disconnect", onSocketClose);
        } catch {}
      });
    }

    this.activeSubscriptions.set(seatId, subRecord);

    // Both WebSocket subscriptions failed to register — fall back to background polling
    if (
      subRecord.confirmedSubId === undefined &&
      subRecord.finalizedSubId === undefined
    ) {
      console.warn(
        "[SolanaPayEscrow] WebSocket subscriptions unavailable; falling back to background status polling.",
      );
      this.scheduleNextPoll(
        subRecord,
        signature,
        pollIntervalMs,
        pollSignatureStatus,
      );
    }
  }

  /**
   * Tracks (confirmed -> finalized) commitment progress via background RPC polling
   * until finality, rolling the seat back to available on failure or mempool drop.
   */
  private startPollingConfirmation(
    connection: Connection,
    seatId: string,
    signature: string,
    timeoutMs: number,
    pollIntervalMs: number,
    pollSignatureStatus?: (
      signature: string,
      options?: { signal?: AbortSignal },
    ) => Promise<SignatureStatus | null>,
    callbacks?: SeatReservationCallbacks,

    lastValidBlockHeight?: number,
    recentBlockhash?: string,
    retryConfig?: SolanaPayEscrowRetryConfig,
    resubmitTransaction?: (
      freshBlockhash: string,
      lastValidBlockHeight: number,
      suggestedPriorityFeeMicroLamports?: number,
    ) => Promise<string>,
    onRetryAttempt?: (
      attempt: number,
      error: Error,
      nextDelayMs: number,
    ) => void,

    rpc429RetryOptions?: Rpc429RetryOptions,
    fallbackConnection?: Connection,
    fallbackPollSignatureStatus?: (
      signature: string,
      options?: { signal?: AbortSignal },
    ) => Promise<SignatureStatus | null>,
    pollTimeoutMs: number = DEFAULT_RPC_POLL_TIMEOUT_MS,
    signal?: AbortSignal,

  ): void {
    const subRecord: ActiveSubscription = {
      seatId,
      signature,
      connection,
      fallbackConnection,
      pollSignatureStatus,
      fallbackPollSignatureStatus,
      pollTimeoutMs,
      callbacks,

      lastValidBlockHeight,
      recentBlockhash,
      retryConfig,
      resubmitTransaction,
      onRetryAttempt,
      attempt: 0,
      timeoutMs,
      pollIntervalMs,
      pollSignatureStatus,
      confirmationMode: "polling",
    };

    // Overall timeout & slot expiration verification

      timeoutEndMs: Date.now() + timeoutMs,
      rpc429ConsecutiveCount: 0,
      rpc429RetryOptions,
    };

    if (signal) {
      const parentAbortHandler = () => {
        this.rollback(seatId, "Reservation aborted by client", "failed");
      };
      signal.addEventListener("abort", parentAbortHandler, { once: true });
      subRecord.parentSignal = signal;
      subRecord.parentAbortHandler = parentAbortHandler;
    }

    // Overall timeout: rollback to available if transaction drops from mempool

    subRecord.timeoutTimer = setTimeout(() => {
      void this.handleTimeoutOrExpiration(seatId);
    }, timeoutMs);
    subRecord.timeoutTimer.unref?.();

    this.activeSubscriptions.set(seatId, subRecord);
    this.scheduleNextPoll(
      subRecord,
      signature,
      pollIntervalMs,
      pollSignatureStatus,
    );
  }

  /**
   * Handles timeout or slot expiration by checking on-chain blockheight and invoking
   * exponential backoff retries with fresh blockhashes when available.
   */
  private async handleTimeoutOrExpiration(seatId: string): Promise<void> {
    const subRecord = this.activeSubscriptions.get(seatId);
    if (!subRecord || subRecord.pollAborted || subRecord.isRetrying) return;

    const current = this.reservations.get(seatId);
    if (
      !current ||
      current.state === "confirmed" ||
      current.state === "finalized"
    ) {
      return;
    }

    const {
      connection,
      lastValidBlockHeight,
      retryConfig,
      resubmitTransaction,
      callbacks,
      timeoutMs,
      pollIntervalMs,
      pollSignatureStatus,
      confirmationMode,
    } = subRecord;

    // 1. Verify on-chain blockheight: check if the blockhash has genuinely expired
    if (typeof lastValidBlockHeight === "number" && lastValidBlockHeight > 0) {
      const expiration = await verifyBlockheightExpiration(
        connection,
        lastValidBlockHeight,
      );
      if (!expiration.expired && expiration.currentBlockHeight !== undefined) {
        // Blockhash is still valid on-chain despite RPC/timeout delay (clock drift / congestion)
        // Keep waiting / polling until blockheight is actually exceeded
        const remainingBlocks =
          lastValidBlockHeight - expiration.currentBlockHeight;
        const recheckMs = Math.max(
          1_000,
          Math.min(remainingBlocks * 400, timeoutMs),
        );
        subRecord.timeoutTimer = setTimeout(() => {
          void this.handleTimeoutOrExpiration(seatId);
        }, recheckMs);
        subRecord.timeoutTimer.unref?.();
        return;
      }
    }

    // 2. Check if retry is configured and attempts remain
    const maxRetries = retryConfig?.maxRetries ?? DEFAULT_ESCROW_MAX_RETRIES;
    const currentAttempt = subRecord.attempt ?? 0;

    if (resubmitTransaction && currentAttempt < maxRetries) {
      subRecord.isRetrying = true;
      const nextAttempt = currentAttempt + 1;
      subRecord.attempt = nextAttempt;

      const baseBackoff =
        retryConfig?.baseBackoffMs ?? DEFAULT_ESCROW_BASE_BACKOFF_MS;
      const maxBackoff =
        retryConfig?.maxBackoffMs ?? DEFAULT_ESCROW_MAX_BACKOFF_MS;
      const backoffDelay = Math.min(
        baseBackoff * Math.pow(2, currentAttempt),
        maxBackoff,
      );

      const feeMultiplier =
        retryConfig?.feeBumpMultiplier ?? DEFAULT_ESCROW_FEE_BUMP_MULTIPLIER;
      const baseFee = retryConfig?.priorityFeeMicroLamports ?? 5_000;
      const suggestedFee = calculatePriorityFeeForAttempt(
        baseFee,
        nextAttempt,
        feeMultiplier,
      );

      const retryReason =
        `Transaction blockhash expired (attempt ${nextAttempt}/${maxRetries}). ` +
        `Re-querying fresh blockhash with exponential backoff (${backoffDelay}ms) and stepped priority fee (${suggestedFee} micro-lamports).`;
      console.warn(`[SolanaPayEscrow] ${retryReason}`);

      callbacks?.onRetry?.(nextAttempt, retryReason, current);
      subRecord.onRetryAttempt?.(
        nextAttempt,
        new Error(retryReason),
        backoffDelay,
      );

      // Clean up previous listeners and timers before re-submitting
      this.clearActiveListeners(subRecord);

      if (backoffDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, backoffDelay));
      }

      try {
        const fresh = await fetchLatestBlockhashWithBackoff(connection);
        const newSignature = await resubmitTransaction(
          fresh.blockhash,
          fresh.lastValidBlockHeight,
          suggestedFee,
        );

        subRecord.signature = newSignature;
        subRecord.recentBlockhash = fresh.blockhash;
        subRecord.lastValidBlockHeight = fresh.lastValidBlockHeight;
        subRecord.isRetrying = false;

        const updatedState: SeatReservationState = {
          ...current,
          signature: newSignature,
          retryAttempt: nextAttempt,
          lastValidBlockHeight: fresh.lastValidBlockHeight,
          recentBlockhash: fresh.blockhash,
          error: null,
          updatedAt: Date.now(),
        };
        this.reservations.set(seatId, updatedState);
        callbacks?.onStateChange?.(updatedState);

        // Re-arm confirmation tracking for the newly broadcasted transaction
        if (confirmationMode === "polling") {
          this.startPollingConfirmation(
            connection,
            seatId,
            newSignature,
            timeoutMs,
            pollIntervalMs,
            pollSignatureStatus,
            callbacks,
            fresh.lastValidBlockHeight,
            fresh.blockhash,
            retryConfig,
            resubmitTransaction,
            subRecord.onRetryAttempt,
          );
        } else {
          this.subscribeToSignatureUpdates(
            connection,
            seatId,
            newSignature,
            timeoutMs,
            callbacks,
            pollIntervalMs,
            pollSignatureStatus,
            fresh.lastValidBlockHeight,
            fresh.blockhash,
            retryConfig,
            resubmitTransaction,
            subRecord.onRetryAttempt,
          );
        }
        return;
      } catch (err: any) {
        console.error(
          `[SolanaPayEscrow] Resubmission attempt ${nextAttempt} failed:`,
          err,
        );
        subRecord.isRetrying = false;
        if (subRecord.attempt < maxRetries) {
          void this.handleTimeoutOrExpiration(seatId);
          return;
        }
      }
    }

    // 3. Rollback when retries are exhausted or no resubmission handler exists
    const timeoutReason =
      subRecord.attempt > 0
        ? `Transaction confirmation timed out after ${subRecord.attempt} retry attempts ` +
          `(blockhash expired or dropped from mempool). Seat reservation has been restored to available.`
        : `Transaction confirmation timed out after ${Math.round(timeoutMs / 1000)} seconds ` +
          `(dropped from mempool). Seat reservation has been restored to available.`;
    this.rollback(seatId, timeoutReason, "timeout");
  }

  /**
   * Clears timers, listeners, and polling handlers for an active subscription without aborting.
   */
  private clearActiveListeners(sub: ActiveSubscription): void {
    if (sub.timeoutTimer) {
      clearTimeout(sub.timeoutTimer);
      sub.timeoutTimer = undefined;
    }
    if (sub.pollTimer) {
      clearTimeout(sub.pollTimer);
      sub.pollTimer = undefined;
    }
    if (sub.stateRemovers) {
      for (const remover of sub.stateRemovers) {
        try {
          remover();
        } catch {}
      }
      sub.stateRemovers = undefined;
    }
    if (sub.confirmedSubId !== undefined) {
      try {
        Promise.resolve(
          sub.connection.removeSignatureListener(sub.confirmedSubId),
        ).catch(() => {});
      } catch {}
      sub.confirmedSubId = undefined;
    }
    if (sub.finalizedSubId !== undefined) {
      try {
        Promise.resolve(
          sub.connection.removeSignatureListener(sub.finalizedSubId),
        ).catch(() => {});
      } catch {}
      sub.finalizedSubId = undefined;
    }
  }

  /**
   * Schedules the next background status poll for an active subscription.
   */
  private scheduleNextPoll(
    subRecord: ActiveSubscription,
    signature: string,
    delayMs: number,
    pollSignatureStatus?: (
      signature: string,
      options?: { signal?: AbortSignal },
    ) => Promise<SignatureStatus | null>,
    normalPollIntervalMs?: number,
  ): void {
    if (subRecord.pollAborted) return;
    const intervalToUse = normalPollIntervalMs ?? delayMs;
    subRecord.pollTimer = setTimeout(() => {
      void this.pollSignatureStatusOnce(
        subRecord,
        signature,
        intervalToUse,
        pollSignatureStatus,
      );
    }, delayMs);
    subRecord.pollTimer.unref?.();
  }

  /**
   * Performs one background status poll and advances the reservation state machine.
   * Handles HTTP 429 rate limit errors with exponential jitter backoff and Retry-After header.
   * Wraps each poll attempt in an AbortController with a strict 5000ms timeout (#9448).
   */
  private async pollSignatureStatusOnce(
    subRecord: ActiveSubscription,
    signature: string,
    pollIntervalMs: number,
    pollSignatureStatus?: (
      signature: string,
      options?: { signal?: AbortSignal },
    ) => Promise<SignatureStatus | null>,
  ): Promise<void> {
    if (subRecord.pollAborted) return;
    const { seatId, connection, callbacks } = subRecord;
    const timeoutMs = subRecord.pollTimeoutMs ?? DEFAULT_RPC_POLL_TIMEOUT_MS;

    const executeAttempt = async (
      conn: Connection,
      poller?: (
        sig: string,
        opts?: { signal?: AbortSignal },
      ) => Promise<SignatureStatus | null>,
    ): Promise<SignatureStatus | null> => {
      let didTimeout = false;
      const controller = new AbortController();
      subRecord.activeAbortController = controller;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          didTimeout = true;
          controller.abort(
            new SolanaRpcPollTimeoutError(
              `Solana RPC status poll timed out after ${timeoutMs}ms`,
            ),
          );
          reject(
            new SolanaRpcPollTimeoutError(
              `Solana RPC status poll timed out after ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
        timer.unref?.();
      });

      try {
        const pollPromise = poller
          ? poller(signature, { signal: controller.signal })
          : fetchSignatureStatusViaConnection(conn, signature, {
              signal: controller.signal,
            });

        return await Promise.race([pollPromise, timeoutPromise]);
      } catch (pollErr) {
        if (didTimeout) {
          throw new SolanaRpcPollTimeoutError(
            `Solana RPC status poll timed out after ${timeoutMs}ms`,
          );
        }
        throw pollErr;
      } finally {
        if (timer) clearTimeout(timer);
        if (subRecord.activeAbortController === controller) {
          subRecord.activeAbortController = undefined;
        }
      }
    };

    const pollerToUse = subRecord.pollSignatureStatus ?? pollSignatureStatus;
    const fallbackConn = subRecord.fallbackConnection;
    const fallbackPoller = subRecord.fallbackPollSignatureStatus;
    const hasFallback = Boolean(fallbackConn || fallbackPoller);

    let status: SignatureStatus | null = null;
    try {
      if (subRecord.activeConnectionIsFallback && hasFallback) {
        status = await executeAttempt(
          fallbackConn || connection,
          fallbackPoller,
        );
      } else {
        status = await executeAttempt(connection, pollerToUse);
      }
    } catch (err) {
      if (subRecord.pollAborted) return;

      const isTimeout =
        err instanceof SolanaRpcPollTimeoutError ||
        (err instanceof Error &&
          (err.name === "AbortError" ||
            err.message.includes("timed out") ||
            err.message.includes("Timeout")));

      if (isTimeout) {
        console.warn(
          `[SolanaPayEscrow] RPC status poll timed out after ${timeoutMs}ms.`,
        );

        if (hasFallback && !subRecord.activeConnectionIsFallback) {
          console.warn(
            "[SolanaPayEscrow] Failing over to secondary fallback RPC endpoint.",
          );
          subRecord.activeConnectionIsFallback = true;
          try {
            status = await executeAttempt(
              fallbackConn || connection,
              fallbackPoller,
            );
          } catch (fallbackErr) {
            if (subRecord.pollAborted) return;
            console.warn(
              "[SolanaPayEscrow] Fallback RPC poll failed or timed out:",
              fallbackErr,
            );
            const timeoutReason = `Transaction confirmation status polling timed out after ${timeoutMs}ms on primary and fallback RPC endpoints.`;
            this.rollback(seatId, timeoutReason, STATUS_TIMEOUT);
            return;
          }
        } else {
          const timeoutReason = `Transaction confirmation status polling timed out after ${timeoutMs}ms.`;
          this.rollback(seatId, timeoutReason, STATUS_TIMEOUT);
          return;
        }
      } else if (isSolanaRpcRateLimitError(err)) {
        const retryOpts = subRecord.rpc429RetryOptions || {};
        const maxRetries = retryOpts.maxRetries ?? DEFAULT_RPC_429_MAX_RETRIES;
        const currentAttempt = subRecord.rpc429ConsecutiveCount ?? 0;

        if (currentAttempt >= maxRetries) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const reason = `Solana RPC rate limit exceeded (${maxRetries} retries exhausted): ${errMsg}. Seat reservation reverted to available.`;
          this.rollback(seatId, reason, "failed");
          return;
        }

        subRecord.rpc429ConsecutiveCount = currentAttempt + 1;

        // Calculate backoff delay: check Retry-After first, then fallback to exponential jitter
        const parsedRetryAfter = parseRetryAfterMs(err);
        let waitMs = parsedRetryAfter !== undefined
          ? parsedRetryAfter
          : computeRpc429Delay(currentAttempt, retryOpts);

        // Check if raw Retry-After exceeded the remaining confirmation timeout budget
        if (subRecord.timeoutEndMs && parsedRetryAfter !== undefined) {
          const remainingTimeout = subRecord.timeoutEndMs - Date.now();
          if (remainingTimeout <= 0 || parsedRetryAfter > remainingTimeout) {
            const timeoutReason = `Transaction confirmation timed out while waiting for rate-limit backoff. Seat reservation has been restored to available.`;
            this.rollback(seatId, timeoutReason, "timeout");
            return;
          }
        }

        // Bounded by maxDelayMs if configured or default
        const maxDelay = retryOpts.maxDelayMs ?? DEFAULT_RPC_429_MAX_DELAY_MS;
        waitMs = Math.min(maxDelay, Math.max(0, waitMs));

        // Ensure retry does not schedule past remaining confirmation timeout budget
        if (subRecord.timeoutEndMs) {
          const remainingTimeout = subRecord.timeoutEndMs - Date.now();
          if (remainingTimeout <= 0 || waitMs > remainingTimeout) {
            const timeoutReason = `Transaction confirmation timed out while waiting for rate-limit backoff. Seat reservation has been restored to available.`;
            this.rollback(seatId, timeoutReason, "timeout");
            return;
          }
        }

        console.warn(
          `[SolanaPayEscrow] Solana RPC 429 rate limit encountered (attempt ${subRecord.rpc429ConsecutiveCount}/${maxRetries}); retrying in ${waitMs}ms`,
        );

        this.scheduleNextPoll(
          subRecord,
          signature,
          waitMs,
          pollSignatureStatus,
          pollIntervalMs,
        );
        return;
      } else {
        // Non-429 transient polling failure: maintain existing behavior
        console.warn(
          "[SolanaPayEscrow] Signature status poll failed; retrying next interval:",
          err,
        );
        this.scheduleNextPoll(
          subRecord,
          signature,
          pollIntervalMs,
          pollSignatureStatus,
        );
        return;
      }
    }

    if (subRecord.pollAborted) return;


    // Status not visible on-chain yet — keep polling; verify if blockheight has expired

    // Successful RPC response resets consecutive 429 counter
    subRecord.rpc429ConsecutiveCount = 0;

    // Status not visible on-chain yet — keep polling; the overall timeout
    // handles the dropped-from-mempool case.

    if (!status) {
      if (typeof subRecord.lastValidBlockHeight === "number") {
        try {
          const currentBlockHeight =
            await connection.getBlockHeight?.("confirmed");
          if (
            typeof currentBlockHeight === "number" &&
            currentBlockHeight > subRecord.lastValidBlockHeight
          ) {
            void this.handleTimeoutOrExpiration(seatId);
            return;
          }
        } catch {}
      }
      this.scheduleNextPoll(
        subRecord,
        signature,
        pollIntervalMs,
        pollSignatureStatus,
      );
      return;
    }

    if (status.err) {
      if (isBlockhashExpiredError(status.err)) {
        void this.handleTimeoutOrExpiration(seatId);
        return;
      }
      const errorMsg =
        typeof status.err === "string"
          ? status.err
          : JSON.stringify(status.err);
      const reason = `Transaction failed on-chain: ${errorMsg}. Seat reservation reverted to available.`;
      this.rollback(seatId, reason, "failed");
      return;
    }

    const commitment = status.confirmationStatus;
    if (commitment === "finalized" || status.confirmations === null) {
      this.transitionToFinalized(seatId, status.slot, callbacks);
      return;
    }

    if (commitment === "confirmed") {
      this.transitionToConfirmed(seatId, status.slot, callbacks);
    }

    this.scheduleNextPoll(
      subRecord,
      signature,
      pollIntervalMs,
      pollSignatureStatus,
    );
  }

  /**
   * Transitions a reservation from provisionally_reserved to confirmed.
   */
  private transitionToConfirmed(
    seatId: string,
    slot: number | undefined,
    callbacks?: SeatReservationCallbacks,
  ): void {
    const current = this.reservations.get(seatId);
    if (!current || current.state !== "provisionally_reserved") return;

    const confirmedState: SeatReservationState = {
      ...current,
      state: "confirmed",
      paymentStatus: "confirmed",
      slot,
      error: null,
      updatedAt: Date.now(),
    };
    this.reservations.set(seatId, confirmedState);

    try {
      callbacks?.onStateChange?.(confirmedState);
      callbacks?.onConfirmed?.(confirmedState);
    } catch (err) {
      console.error("[SolanaPayEscrow] Error in confirmed callback:", err);
    }
  }

  /**
   * Transitions a reservation to finalized and cleans up its listeners.
   */
  private transitionToFinalized(
    seatId: string,
    slot: number | undefined,
    callbacks?: SeatReservationCallbacks,
  ): void {
    const current = this.reservations.get(seatId);
    if (
      !current ||
      (current.state !== "provisionally_reserved" &&
        current.state !== "confirmed")
    ) {
      return;
    }

    const finalizedState: SeatReservationState = {
      ...current,
      state: "finalized",
      paymentStatus: "finalized",
      slot,
      error: null,
      updatedAt: Date.now(),
    };
    this.reservations.set(seatId, finalizedState);

    // Successfully finalized, clear subscriptions and timers
    this.cleanupSubscription(seatId);

    try {
      callbacks?.onStateChange?.(finalizedState);
      callbacks?.onFinalized?.(finalizedState);
    } catch (err) {
      console.error("[SolanaPayEscrow] Error in finalized callback:", err);
    }
  }

  /**
   * Rolls back seat reservation to "available" with a user-friendly error message.
   */
  public rollback(
    seatId: string,
    reason: string,
    status: PaymentConfirmationStage = "failed",
  ): SeatReservationState | null {
    const current = this.reservations.get(seatId);
    const sub = this.activeSubscriptions.get(seatId);
    const callbacks = sub?.callbacks;

    // Clean up active WebSocket listeners and timers
    this.cleanupSubscription(seatId);

    const rolledBackState: SeatReservationState = {
      seatId,
      venueId: current?.venueId ?? "",
      state: "available",
      paymentStatus: status,
      signature: current?.signature,
      payerWallet: current?.payerWallet,
      amount: current?.amount,
      currency: current?.currency,
      error: reason,
      updatedAt: Date.now(),
    };

    this.reservations.set(seatId, rolledBackState);

    const err = new Error(reason);
    try {
      callbacks?.onError?.(err, rolledBackState);
      callbacks?.onRollback?.(reason, rolledBackState);
      callbacks?.onStateChange?.(rolledBackState);
    } catch (callbackErr) {
      console.error(
        "[SolanaPayEscrow] Error in rollback callback:",
        callbackErr,
      );
    }

    return rolledBackState;
  }

  /**
   * Cleans up WebSocket subscriptions, poll timers, and timeout timers for a seat.
   */
  private cleanupSubscription(seatId: string): void {
    const sub = this.activeSubscriptions.get(seatId);
    if (!sub) return;


    if (sub.parentSignal && sub.parentAbortHandler) {
      try {
        sub.parentSignal.removeEventListener("abort", sub.parentAbortHandler);
      } catch {}
      sub.parentSignal = undefined;
      sub.parentAbortHandler = undefined;
    }

    if (sub.activeAbortController) {
      try {
        sub.activeAbortController.abort(new Error("Subscription cleaned up"));
      } catch {}
      sub.activeAbortController = undefined;
    }

    if (sub.stateRemovers) {
      for (const remover of sub.stateRemovers) {
        try {
          remover();
        } catch {}
      }
      sub.stateRemovers = undefined;
    }


    // Halt any background polling loop for this reservation
    sub.pollAborted = true;
    this.clearActiveListeners(sub);
    this.activeSubscriptions.delete(seatId);
  }

  /**
   * Explicitly cleans up any active subscription, polling timers, and listeners for a seat.
   */
  public cleanup(seatId: string): void {
    this.cleanupSubscription(seatId);
  }
}

// Global default singleton instance
export const solanaPayEscrowManager = new SolanaPayEscrowManager();

/**
 * Convenience functions
 */
export async function reserveSeatOptimistically(
  options: ReserveSeatOptions,
): Promise<SeatReservationState> {
  return solanaPayEscrowManager.reserveSeatOptimistically(options);
}

export function rollbackSeatReservation(
  seatId: string,
  reason: string,
  status: PaymentConfirmationStage = "failed",
): SeatReservationState | null {
  return solanaPayEscrowManager.rollback(seatId, reason, status);
}

export function getSeatReservationState(
  seatId: string,
): SeatReservationState | null {
  return solanaPayEscrowManager.getSeatState(seatId);
}

export function resetSeatReservations(): void {
  solanaPayEscrowManager.reset();
}

export function validateSeatReservationPoW(submission: PoWSubmission): boolean {
  return solanaPayEscrowManager.validatePoW(submission);
}

export function cleanupSeatReservation(seatId: string): void {
  solanaPayEscrowManager.cleanup(seatId);
}

export interface FetchSignatureStatusWithTimeoutOptions {
  timeoutMs?: number;
  fallbackConnection?: Connection;
  secondaryConnection?: Connection;
  fallbackPollSignatureStatus?: (
    signature: string,
    options?: { signal?: AbortSignal },
  ) => Promise<SignatureStatus | null>;
  signal?: AbortSignal;
}

/**
 * Wraps an RPC status poll in an AbortController with a strict timeout (default 5000ms),
 * failing over to secondary fallback RPC endpoint or returning STATUS_TIMEOUT (#9448).
 */
export async function fetchSignatureStatusWithTimeout(
  connection: Connection,
  signature: string,
  options: FetchSignatureStatusWithTimeoutOptions = {},
): Promise<SignatureStatus | null | typeof STATUS_TIMEOUT> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_RPC_POLL_TIMEOUT_MS;
  const parentSignal = options.signal;
  const fallbackConn =
    options.fallbackConnection ?? options.secondaryConnection;
  const fallbackPoller = options.fallbackPollSignatureStatus;

  const tryPoll = async (
    conn: Connection,
    poller?: (
      sig: string,
      opts?: { signal?: AbortSignal },
    ) => Promise<SignatureStatus | null>,
  ): Promise<SignatureStatus | null> => {
    let pollTimedOut = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onParentAbort = () => {
      controller.abort(parentSignal?.reason || new Error("Aborted"));
    };
    if (parentSignal) {
      if (parentSignal.aborted) {
        controller.abort(parentSignal.reason || new Error("Aborted"));
      } else {
        parentSignal.addEventListener("abort", onParentAbort, { once: true });
      }
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        pollTimedOut = true;
        controller.abort(
          new SolanaRpcPollTimeoutError(
            `Solana RPC status poll timed out after ${timeoutMs}ms`,
          ),
        );
        reject(
          new SolanaRpcPollTimeoutError(
            `Solana RPC status poll timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
      timer.unref?.();
    });

    try {
      const pollPromise = poller
        ? poller(signature, { signal: controller.signal })
        : fetchSignatureStatusViaConnection(conn, signature, {
            signal: controller.signal,
          });

      return await Promise.race([pollPromise, timeoutPromise]);
    } catch (pollErr) {
      if (pollTimedOut) {
        throw new SolanaRpcPollTimeoutError(
          `Solana RPC status poll timed out after ${timeoutMs}ms`,
        );
      }
      throw pollErr;
    } finally {
      if (timer) clearTimeout(timer);
      if (parentSignal) {
        parentSignal.removeEventListener("abort", onParentAbort);
      }
    }
  };

  try {
    return await tryPoll(connection);
  } catch (err) {
    const isTimeout =
      err instanceof SolanaRpcPollTimeoutError ||
      (err instanceof Error &&
        (err.name === "AbortError" ||
          err.message.includes("timed out") ||
          err.message.includes("Timeout")));

    if (isTimeout) {
      if (fallbackConn || fallbackPoller) {
        try {
          return await tryPoll(fallbackConn || connection, fallbackPoller);
        } catch {
          return STATUS_TIMEOUT;
        }
      }
      return STATUS_TIMEOUT;
    }
    throw err;
  }
}
