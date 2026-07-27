# Background Sync Architecture

This document explains how background sync handles pending offline requests in `public/sw.js`. WorkSphere's service worker uses the native Background Sync API (or periodic background sync) alongside IndexedDB to ensure offline changes are robustly synced back to the server when network connectivity is restored.

## The Outbox Queue (`pendingActions`)

When the user performs actions while offline (such as updating their profile, favoriting a venue, etc.), those requests cannot be sent immediately. Instead:
1. The client intercepts the failure or proactively detects offline status.
2. The request details (endpoint, method, body, timestamps) are serialized and pushed into an IndexedDB object store outbox queue.
3. The queue for general actions is typically named `pendingActions`.
4. The service worker (`public/sw.js`) registers a sync tag (e.g., `sync-actions`).

## Retry Backoff Policies

If a background sync event fires but the server is still unreachable or returns a 5xx error, the service worker must not hammer the backend.
- **Exponential Backoff:** `sw.js` implements a retry backoff. Each failure increments an attempt counter on the queued item.
- The next retry is delayed using an exponential curve (e.g., `delay = Math.min(maxDelay, baseDelay * 2^attempts)`).
- **Dead Letter Queue:** If an item exceeds the maximum number of retry attempts (e.g., 5-10 retries), it is either discarded or moved to a failed-actions log to prevent infinite looping and blocking the queue.

## Network Error Classification

During the replay of the `pendingActions` queue, the service worker inspects the `Response` to classify the error:
- **Offline / Network Failure (Fetch throws):** The device is offline or the request was blocked. The action remains in the queue for a future sync.
- **5xx Server Errors:** Treated as transient errors. The action remains in the queue and backoff is applied.
- **4xx Client Errors:** The request is invalid (e.g., 400 Bad Request, 401 Unauthorized, 404 Not Found). These are typically non-recoverable without user intervention. The action is removed from the queue to prevent blocking subsequent valid actions.
- **2xx Success:** The action is successfully synced and removed from the queue.

## Testing Steps (Chrome DevTools)

To simulate and test offline outbox replays:
1. Open Chrome DevTools (`F12` or `Ctrl+Shift+I`).
2. Go to the **Application** tab and select **Service Workers** from the left pane.
3. Check the **Offline** box to simulate network disconnection.
4. Perform an action in the app that writes to the outbox (e.g., toggle a favorite).
5. Open the **IndexedDB** section under **Application**, find the `pendingActions` store, and verify your action was queued.
6. Uncheck the **Offline** box to restore connectivity.
7. In the **Service Workers** pane, type the sync tag (e.g., `sync-actions`) in the "Sync" input field and click the **Sync** button.
8. Check the **Network** tab to verify the queued request was sent, and check IndexedDB to ensure the queue is empty.
