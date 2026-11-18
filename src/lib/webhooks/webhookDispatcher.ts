/**
 * WorkSphere Webhook Delivery Engine
 *
 * Implements high-reliability webhook dispatching with:
 * 1. HMAC-SHA256 signature generation and verification (`X-WorkSphere-Signature: t=${timestamp},v1=${signature}`)
 * 2. Exponential backoff retry policy with exact intervals: [1m, 5m, 30m, 2h, 24h]
 * 3. Dead Letter Queue (DLQ) persistence in the database for manual review after 5 failed retries
 */

import { createHmac, timingSafeEqual, randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";

export const WEBHOOK_SIGNATURE_HEADER = "x-worksphere-signature";

// Exponential backoff retry schedule: 1m, 5m, 30m, 2h, 24h
export const RETRY_INTERVALS_MS = [
  1 * 60 * 1000, // Attempt 1: 1m (60,000 ms)
  5 * 60 * 1000, // Attempt 2: 5m (300,000 ms)
  30 * 60 * 1000, // Attempt 3: 30m (1,800,000 ms)
  2 * 60 * 60 * 1000, // Attempt 4: 2h (7,200,000 ms)
  24 * 60 * 60 * 1000, // Attempt 5: 24h (86,400,000 ms)
] as const;

export const MAX_RETRY_ATTEMPTS = 5;

export interface WebhookSignatureResult {
  header: string;
  signature: string;
  timestamp: number;
}

export interface WebhookVerificationResult {
  isValid: boolean;
  reason?: string;
  timestamp?: number;
}

export interface WebhookDispatchOptions {
  endpointId?: string;
  endpointUrl: string;
  secret: string;
  eventType: string;
  payload: Record<string, unknown> | string;
  customHeaders?: Record<string, string>;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export interface WebhookDeliveryAttemptResult {
  success: boolean;
  attemptNumber: number;
  statusCode?: number | null;
  error?: string;
  responseBody?: string;
  isRetriable: boolean;
  nextRetryDelayMs?: number | null;
  movedToDlq?: boolean;
  dlqId?: string;
}

export interface DLQEntry {
  id: string;
  endpointId?: string;
  endpointUrl: string;
  eventType: string;
  payload: Record<string, unknown>;
  failedAttempts: number;
  lastStatusCode?: number | null;
  lastError?: string;
  createdAt: Date;
  requiresManualReview: boolean;
}

// In-memory DLQ store for test environments or offline local dev
const inMemoryDLQ = new Map<string, DLQEntry>();

// ---------------------------------------------------------------------------
// 1. HMAC-SHA256 Signing & Verification
// ---------------------------------------------------------------------------

/**
 * Signs a webhook payload using HMAC-SHA256 according to the WorkSphere specification:
 * Header format: `X-WorkSphere-Signature: t=${timestamp},v1=${signature}`
 */
export function signWebhookPayload(
  payload: string | Record<string, unknown>,
  secret: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): WebhookSignatureResult {
  const bodyString = typeof payload === "string" ? payload : JSON.stringify(payload);
  const cleanSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;

  // Sign `${timestamp}.${bodyString}` using HMAC-SHA256
  const hmac = createHmac("sha256", cleanSecret);
  hmac.update(`${timestamp}.${bodyString}`);
  const signature = hmac.digest("hex");

  const header = `t=${timestamp},v1=${signature}`;

  return {
    header,
    signature,
    timestamp,
  };
}

/**
 * Verifies an incoming `X-WorkSphere-Signature` header against the raw payload and secret.
 * Enforces constant-time comparison via timingSafeEqual and checks timestamp tolerance.
 */
export function verifyWebhookSignature(
  payload: string | Record<string, unknown>,
  signatureHeader: string | null | undefined,
  secret: string,
  options?: {
    toleranceSeconds?: number; // default 300s (5m), 0 to disable
    currentTimestamp?: number;
  },
): WebhookVerificationResult {
  if (!signatureHeader || typeof signatureHeader !== "string") {
    return { isValid: false, reason: "MISSING_SIGNATURE_HEADER" };
  }

  // Parse `t=${timestamp},v1=${signature}`
  const parts = signatureHeader.split(",");
  let timestampStr: string | null = null;
  let signature: string | null = null;

  for (const part of parts) {
    const [key, value] = part.trim().split("=");
    if (key === "t") timestampStr = value;
    if (key === "v1") signature = value;
  }

  if (!timestampStr || !signature) {
    return { isValid: false, reason: "INVALID_SIGNATURE_FORMAT" };
  }

  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp) || timestamp <= 0) {
    return { isValid: false, reason: "INVALID_TIMESTAMP" };
  }

  // Validate timestamp tolerance to prevent replay attacks
  const tolerance = options?.toleranceSeconds ?? 300;
  const nowSec = options?.currentTimestamp ?? Math.floor(Date.now() / 1000);
  if (tolerance > 0 && Math.abs(nowSec - timestamp) > tolerance) {
    return { isValid: false, reason: "TIMESTAMP_OUT_OF_TOLERANCE", timestamp };
  }

  // Compute expected HMAC-SHA256
  const expected = signWebhookPayload(payload, secret, timestamp);

  try {
    const sigBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expected.signature, "hex");

    if (sigBuffer.length !== expectedBuffer.length) {
      return { isValid: false, reason: "SIGNATURE_MISMATCH", timestamp };
    }

    const matches = timingSafeEqual(sigBuffer, expectedBuffer);
    if (!matches) {
      return { isValid: false, reason: "SIGNATURE_MISMATCH", timestamp };
    }

    return { isValid: true, timestamp };
  } catch {
    return { isValid: false, reason: "VERIFICATION_ERROR", timestamp };
  }
}

// ---------------------------------------------------------------------------
// 2. Exponential Backoff Policy Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the delay in milliseconds for a specific retry attempt (1-indexed: 1..5).
 * Schedule: 1m, 5m, 30m, 2h, 24h.
 * Returns null if max retries (5) have been exhausted.
 */
export function getRetryDelayMs(attemptNumber: number): number | null {
  if (attemptNumber < 1 || attemptNumber > MAX_RETRY_ATTEMPTS) {
    return null;
  }
  return RETRY_INTERVALS_MS[attemptNumber - 1];
}

/**
 * Determines whether a failure status code or network error should be retried.
 * - 5xx Server Errors and network drops: retriable.
 * - 4xx Client Errors: non-retriable (permanent failure, e.g. 400 Bad Request, 401 Unauthorized, 404 Not Found).
 */
export function isRetriableFailure(statusCode?: number | null, isNetworkError: boolean = false): boolean {
  if (isNetworkError) return true;
  if (!statusCode) return true;
  // HTTP 429 Too Many Requests may be retried
  if (statusCode === 429) return true;
  // 5xx Server Errors are retriable
  if (statusCode >= 500 && statusCode <= 599) return true;
  // 4xx Client Errors are permanent non-retriable failures
  if (statusCode >= 400 && statusCode < 500) return false;
  return false;
}

// ---------------------------------------------------------------------------
// 3. Dead Letter Queue (DLQ) Database Persistence
// ---------------------------------------------------------------------------

/**
 * Moves an exhausted webhook delivery event into the database Dead Letter Queue (DLQ).
 */
export async function moveToDeadLetterQueue(params: {
  endpointId?: string;
  endpointUrl: string;
  eventType: string;
  payload: Record<string, unknown> | string;
  failedAttempts: number;
  lastStatusCode?: number | null;
  lastError?: string;
}): Promise<string> {
  const {
    endpointId,
    endpointUrl,
    eventType,
    payload,
    failedAttempts,
    lastStatusCode,
    lastError,
  } = params;

  const dlqId = `dlq_${randomUUID()}`;
  const parsedPayload = typeof payload === "string" ? JSON.parse(payload) : payload;

  const dlqEntry: DLQEntry = {
    id: dlqId,
    endpointId,
    endpointUrl,
    eventType,
    payload: parsedPayload,
    failedAttempts,
    lastStatusCode,
    lastError,
    createdAt: new Date(),
    requiresManualReview: true,
  };

  // Always keep in memory store
  inMemoryDLQ.set(dlqId, dlqEntry);

  // If endpointId exists in database, persist to WebhookDeliveryLog with DLQ status
  if (endpointId) {
    try {
      await prisma.webhookDeliveryLog.create({
        data: {
          endpointId,
          eventType,
          payload: {
            ...parsedPayload,
            _dlq: {
              dlqId,
              status: "DEAD_LETTER_QUEUE",
              endpointUrl,
              failedAttempts,
              lastStatusCode,
              lastError,
              movedToDlqAt: new Date().toISOString(),
              requiresManualReview: true,
            },
          },
          status: "DEAD_LETTER_QUEUE",
          statusCode: lastStatusCode,
        },
      });
    } catch (err) {
      console.warn("[WebhookDispatcher] Database DLQ persistence failed, preserved in memory:", err);
    }
  }

  console.warn(
    `[WebhookDispatcher] Event ${eventType} moved to DLQ after ${failedAttempts} attempts. Reason: ${lastError || `HTTP ${lastStatusCode}`}`,
  );

  return dlqId;
}

/**
 * Retrieves entries currently stored in the Dead Letter Queue for manual review.
 */
export async function getDeadLetterQueueEntries(options?: {
  endpointId?: string;
  limit?: number;
}): Promise<DLQEntry[]> {
  const limit = options?.limit ?? 50;

  // Try fetching from database first
  try {
    const where: any = { status: "DEAD_LETTER_QUEUE" };
    if (options?.endpointId) {
      where.endpointId = options.endpointId;
    }

    const dbLogs = await prisma.webhookDeliveryLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { endpoint: true },
    });

    if (dbLogs.length > 0) {
      return dbLogs.map((log) => {
        const payloadObj = (log.payload as any) || {};
        const dlqMeta = payloadObj._dlq || {};
        return {
          id: dlqMeta.dlqId || log.id,
          endpointId: log.endpointId,
          endpointUrl: dlqMeta.endpointUrl || log.endpoint?.url || "unknown",
          eventType: log.eventType,
          payload: payloadObj,
          failedAttempts: dlqMeta.failedAttempts || 5,
          lastStatusCode: log.statusCode,
          lastError: dlqMeta.lastError,
          createdAt: log.createdAt,
          requiresManualReview: true,
        };
      });
    }
  } catch {
    // Database query failed or unavailable, return memory DLQ
  }

  let list = Array.from(inMemoryDLQ.values());
  if (options?.endpointId) {
    list = list.filter((e) => e.endpointId === options.endpointId);
  }
  return list.slice(0, limit);
}

// ---------------------------------------------------------------------------
// 4. Webhook Dispatcher Core Execution
// ---------------------------------------------------------------------------

/**
 * Performs a single delivery attempt with HMAC-SHA256 signature headers.
 */
export async function executeDeliveryAttempt(
  options: WebhookDispatchOptions,
  attemptNumber: number = 1,
): Promise<WebhookDeliveryAttemptResult> {
  const {
    endpointId,
    endpointUrl,
    secret,
    eventType,
    payload,
    customHeaders = {},
    timeoutMs = 10_000,
    fetchFn = fetch,
  } = options;

  const bodyString = typeof payload === "string" ? payload : JSON.stringify(payload);
  const signed = signWebhookPayload(bodyString, secret);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "WorkSphere-Webhooks/2.0",
    "x-worksphere-signature": signed.header,
    "x-worksphere-event": eventType,
    "x-worksphere-delivery-attempt": String(attemptNumber),
    ...customHeaders,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(endpointUrl, {
      method: "POST",
      headers,
      body: bodyString,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const isSuccess = response.status >= 200 && response.status < 300;
    const responseText = await response.text().catch(() => "");

    // Log attempt to database if endpointId provided
    if (endpointId) {
      prisma.webhookDeliveryLog
        .create({
          data: {
            endpointId,
            eventType,
            payload: typeof payload === "string" ? JSON.parse(payload) : payload,
            status: isSuccess ? "SUCCESS" : "FAILED",
            statusCode: response.status,
          },
        })
        .catch(() => {});
    }

    if (isSuccess) {
      return {
        success: true,
        attemptNumber,
        statusCode: response.status,
        responseBody: responseText,
        isRetriable: false,
      };
    }

    const retriable = isRetriableFailure(response.status, false);
    const nextRetryDelayMs = retriable ? getRetryDelayMs(attemptNumber) : null;

    return {
      success: false,
      attemptNumber,
      statusCode: response.status,
      error: `HTTP ${response.status}: ${responseText || response.statusText}`,
      isRetriable: retriable,
      nextRetryDelayMs,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);

    const isNetworkError = true;
    const nextRetryDelayMs = getRetryDelayMs(attemptNumber);
    const errorMessage = err?.name === "AbortError" ? `Request timed out after ${timeoutMs}ms` : (err?.message || "Network Error");

    if (endpointId) {
      prisma.webhookDeliveryLog
        .create({
          data: {
            endpointId,
            eventType,
            payload: typeof payload === "string" ? JSON.parse(payload) : payload,
            status: "FAILED",
            statusCode: null,
          },
        })
        .catch(() => {});
    }

    return {
      success: false,
      attemptNumber,
      statusCode: null,
      error: errorMessage,
      isRetriable: isNetworkError,
      nextRetryDelayMs,
    };
  }
}

/**
 * Dispatches a webhook with full exponential backoff retry logic.
 * If 5 retries fail, moves the event to the Dead Letter Queue (DLQ).
 *
 * @param options Webhook destination and payload options
 * @param onRetry Optional hook called before each retry
 */
export async function dispatchWebhookWithRetries(
  options: WebhookDispatchOptions,
  onRetry?: (attempt: number, delayMs: number, error?: string) => Promise<void> | void,
): Promise<WebhookDeliveryAttemptResult> {
  let attempt = 1;
  let lastResult: WebhookDeliveryAttemptResult;

  while (attempt <= MAX_RETRY_ATTEMPTS) {
    lastResult = await executeDeliveryAttempt(options, attempt);

    if (lastResult.success) {
      return lastResult;
    }

    // If client error or non-retriable, abort immediately without retrying
    if (!lastResult.isRetriable) {
      return lastResult;
    }

    const nextDelay = getRetryDelayMs(attempt);
    if (!nextDelay) {
      break;
    }

    await onRetry?.(attempt, nextDelay, lastResult.error);
    attempt++;
  }

  // After 5 failed attempts, move to Dead Letter Queue (DLQ)
  const dlqId = await moveToDeadLetterQueue({
    endpointId: options.endpointId,
    endpointUrl: options.endpointUrl,
    eventType: options.eventType,
    payload: options.payload,
    failedAttempts: MAX_RETRY_ATTEMPTS,
    lastStatusCode: lastResult!.statusCode,
    lastError: lastResult!.error,
  });

  return {
    ...lastResult!,
    movedToDlq: true,
    dlqId,
  };
}

/**
 * Replays a message from the Dead Letter Queue for manual review execution.
 */
export async function replayDeadLetterQueueEntry(
  dlqId: string,
  secret: string,
): Promise<WebhookDeliveryAttemptResult | null> {
  let entry = inMemoryDLQ.get(dlqId);

  if (!entry) {
    try {
      const log = await prisma.webhookDeliveryLog.findFirst({
        where: {
          payload: {
            path: ["_dlq", "dlqId"],
            equals: dlqId,
          },
        },
        include: { endpoint: true },
      });

      if (log) {
        const payloadObj = (log.payload as any) || {};
        const dlqMeta = payloadObj._dlq || {};
        entry = {
          id: dlqId,
          endpointId: log.endpointId,
          endpointUrl: dlqMeta.endpointUrl || log.endpoint?.url || "",
          eventType: log.eventType,
          payload: payloadObj,
          failedAttempts: dlqMeta.failedAttempts || 5,
          createdAt: log.createdAt,
          requiresManualReview: true,
        };
      }
    } catch {
      // ignore
    }
  }

  if (!entry) return null;

  const result = await executeDeliveryAttempt({
    endpointId: entry.endpointId,
    endpointUrl: entry.endpointUrl,
    secret,
    eventType: entry.eventType,
    payload: entry.payload,
  });

  if (result.success) {
    inMemoryDLQ.delete(dlqId);
  }

  return result;
}

/**
 * Clears in-memory DLQ state (for test isolation).
 */
export function resetInMemoryDLQ(): void {
  inMemoryDLQ.clear();
}
