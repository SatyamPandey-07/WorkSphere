import {
  getQueuedFavorites,
  dequeueOfflineAction,
  incrementRetryCount,
  MAX_SYNC_RETRIES,
} from "../lib/offlineStore";

// Circuit Breaker types and state
type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

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
  | { type: "WAKE_UP" }
  | { type: "SYNC_STARTED" }
  | { type: "SYNC_SUCCESS"; remainingCount: number }
  | { type: "SYNC_ERROR"; error: string }
  | { type: "CIRCUIT_BREAKER_OPEN"; timeoutMs: number }
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
          const response = await fetch("/api/favorites", {
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

          // If failure is due to device being offline, do NOT penalize or dequeue outbox item
          if (
            typeof self !== "undefined" &&
            self.navigator &&
            !self.navigator.onLine
          ) {
            console.warn(
              "[Sync Worker] Offline network error; keeping item in queue.",
            );
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
  if (event.data.type === "WAKE_UP") {
    if (
      typeof self !== "undefined" &&
      self.navigator &&
      self.navigator.onLine
    ) {
      resetCircuitBreaker();
    }
    processOutbox().catch(console.error);
  }
});
