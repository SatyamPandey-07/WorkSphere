# Offline-First Architecture & IndexedDB Sync Protocol

## 1. Architectural Overview

The offline storage layer is designed to provide a seamless user experience during unstable or disconnected network conditions. It utilizes **IndexedDB** as the primary client-side database, wrapped by our internal `offlineStore.ts` utility.
The architecture is split into two main operational flows:

1. **Read-Through Caching:** Storing server responses (like searches and favorites) locally for instant retrieval when offline.
2. **Outbox Pattern (Action Queuing):** Capturing user mutations (like renaming or deleting conversations) while offline, storing them in a queue, and syncing them to the server once connectivity is restored.

---

## 2. IndexedDB Schema Stores

The database is structured into distinct object stores to separate cached data from pending mutations:

- **`searches` (Cache):**
  - **Purpose:** Stores recent AI chatbot queries and their associated metadata/venues.
  - **Key:** `query` (String)
  - **Payload:** Venue results, coordinates, and categories.
- **`favorites` (Cache):**
  - **Purpose:** Maintains a local set of the user's saved venues for offline rendering.
  - **Key:** `venueId` (String)
  - **Payload:** Venue details required for UI mapping (lat, lng, name).
- **`outbox_queue` (Mutations):**
  - **Purpose:** Acts as the holding area for optimistic UI updates that need to be synced with the server.
  - **Key:** Auto-incrementing ID or timestamp.
  - **Payload:** Action type (e.g., `RENAME_CONVERSATION`, `DELETE_CONVERSATION`), endpoint, payload data, and retry count.

---

## 3. Transaction Lifecycle

All interactions with `offlineStore.ts` follow a strict transaction lifecycle to ensure atomicity and prevent data corruption:

1.  **Initialization:** The IndexedDB instance is opened. If the schema version is outdated, the `onupgradeneeded` event fires to create or alter stores.
2.  **Read/Write Execution:** Transactions are opened strictly with the necessary permissions (`readonly` for rendering UI, `readwrite` for saving searches or queuing edits).
3.  **Optimistic Resolution:** For UI-blocking actions, the local state is updated immediately (e.g., hiding a deleted conversation) before the transaction even commits to IndexedDB.
4.  **Completion/Rollback:** The transaction naturally commits upon the successful resolution of all requests. If an error occurs (e.g., quota exceeded), the transaction is aborted, and the UI gracefully falls back to the server state.

---

## 4. Outbox Queue Processing & Retry Rules

When the user is offline, actions are intercepted and pushed to the `outbox_queue`. The processing protocol is as follows:

- **Queueing Mechanism:** Functions like `queueConversationRename` serialize the intended API request and store it. The UI is updated locally via `applyPendingConversationEdits` to merge server state with the un-synced local edits.
- **Processing the Queue:** The `flushConversationEditQueue()` function iterates through the outbox, attempting to execute the stored API requests sequentially.
- **Retry Rules:**
  - **Success:** The action is permanently removed from the IndexedDB outbox.
  - **Client Error (4xx):** The action is discarded to prevent infinite failing loops (e.g., trying to rename a conversation that was already deleted on another device).
  - **Server/Network Error (5xx or Timeout):** The action remains in the queue. The `retryCount` is incremented.
  - **Max Retries:** If an action exceeds the maximum retry threshold (typically 5 attempts), it is moved to a dead-letter state or discarded to prevent queue blocking.

---

## 5. Network Reconnect Sync Listeners

To ensure data consistency without requiring a manual page refresh, the application relies on event listeners tied to the browser's network state.

```typescript
// Core sync listener implementation
window.addEventListener("online", () => {
  flushConversationEditQueue().then(() => {
    // Re-sync server state once the outbox is cleared
    loadConversations();
  });
});
```
