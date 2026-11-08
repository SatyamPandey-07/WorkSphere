import {
  getQueuedFavorites,
  dequeueOfflineAction,
  incrementRetryCount,
  restoreFailedPayload,
  MAX_SYNC_RETRIES,
} from "../lib/offlineStore";

// Circuit Breaker types and state
type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

// ─── Auth Token State ─────────────────────────────────────────────────────────
// Clerk runs on the main thread only. The main thread passes its session JWT to
// the worker via WAKE_UP (initial) and TOKEN_REFRESH (after AUTH_EXPIRED).
let currentToken: string | null = null;
let pendingTokenRefresh: ((token: string | null) => void) | null = null;

/**
 * Posts AUTH_EXPIRED to the main thread and awaits a TOKEN_REFRESH reply.
 * Returns the refreshed token, or null if the session could not be renewed.
 */
function requestTokenRefresh(): Promise<string | null> {
  return new Promise((resolve) => {
    pendingTokenRefresh = resolve;
    self.postMessage({ type: "AUTH_EXPIRED" });
  });
}

/**
 * Wraps fetch() with Clerk JWT injection and automatic 401 recovery.
 *
 * On a 401 response the worker posts AUTH_EXPIRED to the main thread,
 * waits for a TOKEN_REFRESH message containing a fresh JWT, then retries
 * the request once. If the refreshed token is unavailable or the retry
 * also fails, the original/retry response is returned to the caller so
 * the existing error-handling path can decide what to do.
 */
async function authenticatedFetch(
  url: string,
  options: RequestInit,
): Promise<Response> {
  const headersWithToken: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (currentToken) {
    headersWithToken["Authorization"] = `Bearer ${currentToken}`;
  }

  const response = await fetch(url, { ...options, headers: headersWithToken });

  if (response.status === 401) {
    const freshToken = await requestTokenRefresh();
    if (!freshToken) {
      // Session could not be renewed; return the 401 for the caller to handle.
      return response;
    }
    return fetch(url, {
      ...options,
      headers: {
        ...(options.headers as Record<string, string>),
        Authorization: `Bearer ${freshToken}`,
      },
    });
  }

  return response;
}

let cbState: CircuitBreakerState = "CLOSED";
let cbFailures = 0;
const CB_MAX_FAILURES = 3;
const CB_OPEN_TIMEOUT_MS = 30000;
let cbOpenTimestamp = 0;

// Exponential Backoff Config
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 60000;

// Status Flags
let isProcessing = false;

// -----------------------------------------------------------------------------
// Message Protocol
// -----------------------------------------------------------------------------
export type SyncWorkerMessage =
  // ── Inbound (main thread → worker) ──────────────────────────────────────
  /** Wake the worker; optionally carry the current Clerk JWT. */
  | { type: "WAKE_UP"; token?: string }
  /** Deliver a refreshed Clerk JWT after the worker posted AUTH_EXPIRED. */
  | { type: "TOKEN_REFRESH"; token: string }
  // ── Outbound (worker → main thread) ─────────────────────────────────────
  | { type: "SYNC_STARTED" }
  | { type: "SYNC_SUCCESS"; remainingCount: number }
  | { type: "SYNC_ERROR"; error: string }
  | { type: "CIRCUIT_BREAKER_OPEN"; timeoutMs: number }
  /**
   * Posted when a fetch returns 401 (expired Clerk session).
   * The main thread should call Clerk's getToken({ skipCache: true }) and
   * reply with a TOKEN_REFRESH message.
   */
  | { type: "AUTH_EXPIRED" }
  | {
      type: "PERMANENT_FAILURE";
      venueId: string;
      action: string;
      attempts: number;
    };

function sendMessage(message: Extract<SyncWorkerMessage, { type: string }>) {
  self.postMessage(message);
}

// -----------------------------------------------------------------------------
// Circuit Breaker Logic
// -----------------------------------------------------------------------------
function checkCircuitBreaker(): boolean {
  if (cbState === "OPEN") {
    const now = Date.now();
    if (now - cbOpenTimestamp >= CB_OPEN_TIMEOUT_MS) {
      // Timeout expired, transition to HALF_OPEN to test the waters
      cbState = "HALF_OPEN";
      return true; // Allow one request through
    }
    return false; // Still OPEN, block requests
  }
  return true; // CLOSED or HALF_OPEN
}

function recordSuccess() {
  cbFailures = 0;
  cbState = "CLOSED";
}

function resetCircuitBreaker() {
  cbFailures = 0;
  cbState = "CLOSED";
  cbOpenTimestamp = 0;
}

function recordFailure() {
  cbFailures++;
  if (cbState === "HALF_OPEN" || cbFailures >= CB_MAX_FAILURES) {
    cbState = "OPEN";
    cbOpenTimestamp = Date.now();
    sendMessage({
      type: "CIRCUIT_BREAKER_OPEN",
      timeoutMs: CB_OPEN_TIMEOUT_MS,
    });
  }
}

// -----------------------------------------------------------------------------
// Sync Pipeline
// -----------------------------------------------------------------------------
async function processOutbox() {
  if (isProcessing) return;
  isProcessing = true;

  const processQueue = async () => {
    try {
      const actions = await getQueuedFavorites();

      if (actions.length > 0) {
        sendMessage({ type: "SYNC_STARTED" });
      }

      while (actions.length > 0) {
        // Stop if device is offline
        if (
          typeof self !== "undefined" &&
          self.navigator &&
          !self.navigator.onLine
        ) {
          console.warn("[Sync Worker] Device is offline. Pausing sync queue.");
          break;
        }

        if (!checkCircuitBreaker()) {
          console.warn("[Sync Worker] Circuit breaker is OPEN. Pausing sync.");
          break; // Stop processing, wait for next WAKE_UP or timeout
        }

        const action = actions[0];
        if (!action.id) {
          actions.shift();
          continue;
        }

        // Calculate backoff delay with jitter (only if online and previous retries failed on server)
        const attempt = action.retryCount || 0;
        if (
          attempt > 0 &&
          typeof self !== "undefined" &&
          self.navigator &&
          self.navigator.onLine
        ) {
          const delay = Math.min(
            MAX_DELAY_MS,
            BASE_DELAY_MS * Math.pow(2, attempt),
          );
          const jitter = Math.floor(Math.random() * 1000); // 0-1s jitter
          const totalDelay = delay + jitter;

          console.log(
            `[Sync Worker] Backing off for ${totalDelay}ms before retry ${attempt}...`,
          );
          await new Promise((resolve) => setTimeout(resolve, totalDelay));
        }

        // Re-check circuit breaker and online status after sleep
        if (
          typeof self !== "undefined" &&
          self.navigator &&
          !self.navigator.onLine
        )
          break;
        if (!checkCircuitBreaker()) break;

        try {
          const response = await authenticatedFetch("/api/favorites", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              venueId: action.venueId,
              action: action.action,
            }),
          });

          if (response.ok) {
            recordSuccess();
            await dequeueOfflineAction(action.id);
            actions.shift(); // Remove from local queue
            sendMessage({
              type: "SYNC_SUCCESS",
              remainingCount: actions.length,
            });
            continue;
          }

          throw new Error(`Sync request failed with status ${response.status}`);
        } catch (error: any) {
          console.error("[Sync Worker] Failed to sync favorite:", error);

          // -------------------------------------------------------------------
          // Distinguish network errors (TypeError) from server errors.
          //
          // fetch() throws TypeError for network failures:
          //   - DNS resolution failures
          //   - TCP connection timeouts / resets
          //   - TLS handshake failures
          //   - Premature connection close while reading body
          //
          // For network errors we MUST NOT:
          //   - Increment retryCount (it would exhaust MAX_SYNC_RETRIES unfairly)
          //   - Trip the circuit breaker (network is transient, not a server issue)
          //   - Dequeue the item (would lose data permanently)
          //
          // Instead we restore the payload (reset retryCount to 0) so the item
          // is re-attempted fresh on the next WAKE_UP cycle.
          // -------------------------------------------------------------------
          const isNetworkError = error instanceof TypeError;

          if (isNetworkError) {
            console.warn(
              "[Sync Worker] Network error detected (fetch TypeError). Restoring payload without retry penalty.",
            );
            await restoreFailedPayload(action.id!);
            // Break the loop — device may have gone offline mid-sync.
            // The next WAKE_UP (from online event, visibility change, or
            // next page load) will re-process the queue from scratch.
            break;
          }

          // If failure is due to device being offline (navigator.onLine),
          // do NOT penalize or dequeue outbox item
          if (
            typeof self !== "undefined" &&
            self.navigator &&
            !self.navigator.onLine
          ) {
            console.warn(
              "[Sync Worker] Offline network error; restoring payload without penalty.",
            );
            await restoreFailedPayload(action.id!);
            break;
          }

          recordFailure();
          sendMessage({ type: "SYNC_ERROR", error: error.message });

          const attempts = await incrementRetryCount(action.id);

          if (attempts !== null && attempts >= MAX_SYNC_RETRIES) {
            // Permanent failure
            await dequeueOfflineAction(action.id);
            actions.shift();
            sendMessage({
              type: "PERMANENT_FAILURE",
              venueId: action.venueId,
              action: action.action,
              attempts: MAX_SYNC_RETRIES,
            });
          } else {
            // If not permanent, we break the loop to wait for the next WAKE_UP
            // or circuit breaker retry, rather than hammering immediately.
            break;
          }
        }
      }
    } catch (e) {
      console.error("[Sync Worker] processQueue failed:", e);
    }
  };

  try {
    if ("locks" in navigator) {
      await navigator.locks.request(
        "sync-favorites-queue",
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            console.log(
              "[Sync Worker] Queue is being processed by another agent (SW or another tab).",
            );
            return;
          }
          await processQueue();
        },
      );
    } else {
      await processQueue();
    }
  } catch (error) {
    console.error("[Sync Worker] Queue processing failed:", error);
  } finally {
    isProcessing = false;
  }
}

// -----------------------------------------------------------------------------
// Message Listener
// -----------------------------------------------------------------------------
self.addEventListener("message", (event: MessageEvent<SyncWorkerMessage>) => {
  const { type } = event.data;

  if (type === "WAKE_UP") {
    // Accept a Clerk JWT forwarded by the main thread on each wake-up.
    if ("token" in event.data && event.data.token) {
      currentToken = event.data.token;
    }
    if (
      typeof self !== "undefined" &&
      self.navigator &&
      self.navigator.onLine
    ) {
      resetCircuitBreaker();
    }
    processOutbox().catch(console.error);
    return;
  }

  if (type === "TOKEN_REFRESH") {
    // Main thread has supplied a fresh JWT after an AUTH_EXPIRED signal.
    const token = event.data.token || null;
    currentToken = token;
    if (pendingTokenRefresh) {
      const resolve = pendingTokenRefresh;
      pendingTokenRefresh = null;
      resolve(token);
    }
    return;
  }
});
