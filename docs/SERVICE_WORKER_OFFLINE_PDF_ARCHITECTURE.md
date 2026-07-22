# Service Worker Offline PDF Generation & Background Sync Architecture

This document specifies WorkSphere's **Service Worker background sync queues**, **IndexedDB ArrayBuffer storage** for PDF binary data, **offline PDF receipt rendering**, and **reconnection download triggers**. It provides the architectural flows, storage schemas, sync event handlers, and automated test strategies for the offline PDF pipeline.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Service Worker Background Sync Queues](#3-service-worker-background-sync-queues)
4. [IndexedDB Storage Schemas](#4-indexeddb-storage-schemas)
5. [Offline PDF Receipt Rendering](#5-offline-pdf-receipt-rendering)
6. [Reconnection Download Triggers](#6-reconnection-download-triggers)
7. [Service Worker Sync Event Handlers](#7-service-worker-sync-event-handlers)
8. [PDF Binary Storage in IndexedDB](#8-pdf-binary-storage-in-indexeddb)
9. [Client-Side Orchestration](#9-client-side-orchestration)
10. [Automated Test Strategies](#10-automated-test-strategies)
11. [Troubleshooting](#11-troubleshooting)
12. [Implementation Checklist](#12-implementation-checklist)

---

## 1. Overview

WorkSphere enables users to download booking receipt PDFs and tax export PDFs. When the user is offline or on an unreliable network, the PDF generation pipeline queues the request, generates the PDF client-side (or defers to a background sync), stores the binary result in IndexedDB, and triggers a download when connectivity is restored.

### Key Components

| Component | Responsibility | Location |
|-----------|---------------|----------|
| **PDF Generator** | Produces `Uint8Array` PDF binary using pdf-lib | `src/lib/pdfGenerator.ts` |
| **Offline Storage** | Stores PDF binary in IndexedDB `receiptExports` store | `src/lib/offlineStorage.ts` |
| **Service Worker** | Background Sync handler, receipt sync, push notification | `public/sw.js` |
| **Sync Web Worker** | Circuit breaker, retry logic, exponential backoff | `src/workers/sync.worker.ts` |
| **Client Hook** | Orchestrates queue, render, store, and download trigger | `src/hooks/usePWA.tsx` |

### Sync Tags

| Tag | Purpose |
|-----|---------|
| `receipt-export-sync` | Triggers background sync for pending receipt PDFs |
| `sync-crdt` | General CRDT state synchronization |
| `sync-favorites` | Favorites outbox sync |
| `sync-ratings` | Ratings outbox sync |
| `sync-conversations` | Conversation edits sync |
| `availability-sync` | Seat availability sync |

---

## 2. Architecture Diagram

```text
+-----------------------------------------------------------------------+
|                         Client Browser                                |
|                                                                       |
|  [User clicks Download Receipt]                                       |
|           |                                                           |
|           v                                                           |
|  [generateReceiptPdf()] → Uint8Array                                  |
|           |                                                           |
|           v                                                           |
|  [Store in IndexedDB receiptExports]                                  |
|           |                                                           |
|           +--- Online? ---+--- Offline? ---+                          |
|           |                |                |                          |
|           v                v                v                          |
|  [Fetch /download]  [Register            [Queue for                   |
|           |          background-sync]      later]                      |
|           |                |                                           |
|           v                v                                           |
|  [Download PDF]   SW sync event fires                                 |
|                         |                                              |
|                         v                                              |
|              [SW reads IDB receiptExports]                             |
|                         |                                              |
|                         v                                              |
|              [POST /download with stored data]                         |
|                         |                                              |
|                         v                                              |
|              [Update IDB status → "completed"]                         |
|                         |                                              |
|                         v                                              |
|              [postMessage("RECEIPT_SYNC_READY")]                       |
|                         |                                              |
|                         v                                              |
|              [Client triggers browser download]                        |
+-----------------------------------------------------------------------+
```

---

## 3. Service Worker Background Sync Queues

### 3.1 Queue Architecture

The Service Worker maintains a sync queue backed by IndexedDB. Each queue entry represents a pending operation that must be retried when connectivity is restored.

```text
Sync Queue Lifecycle:

  Client requests export
        |
        v
  Enqueue in IndexedDB "receiptExports"
  { bookingId, status: "pending", createdAt, pdfData? }
        |
        v
  Register background-sync tag: "receipt-export-sync"
        |
        v
  SW "sync" event fires (when online)
        |
        v
  Read all entries where status === "pending"
        |
        v
  For each entry:
    POST to /api/bookings/[id]/download
    On success: status → "completed"
    On failure:  status → "failed", retryCount++
        |
        v
  postMessage("RECEIPT_SYNC_READY") to all clients
```

### 3.2 Sync Registration

```typescript
// Client-side: register background sync
if ("serviceWorker" in navigator && "SyncManager" in window) {
  const registration = await navigator.serviceWorker.ready;
  await registration.sync.register("receipt-export-sync");
}
```

### 3.3 Fallback Triggers

When `SyncManager` is unavailable (e.g., Firefox, private browsing), the system falls back to alternative sync triggers:

| Trigger | Event | Condition |
|---------|-------|-----------|
| **Online event** | `window.addEventListener("online", ...)` | Browser reports connectivity |
| **Visibility change** | `document.addEventListener("visibilitychange", ...)` | Tab becomes visible |
| **Periodic check** | `setInterval` (30s) | App is in foreground |
| **Manual retry** | User clicks "Retry" button | Explicit user action |

---

## 4. IndexedDB Storage Schemas

### 4.1 `worksphere-offline` Database (Version 6)

The receipt export store within the SW-side IndexedDB:

#### `receiptExports` Store

| Field | Type | Key/Index | Description |
|-------|------|-----------|-------------|
| `bookingId` | `string` | Primary Key | Unique booking identifier |
| `status` | `"pending" \| "processing" \| "completed" \| "failed"` | Index: `status` | Current sync state |
| `createdAt` | `number` | Index: `createdAt` | Timestamp of queue entry |
| `updatedAt` | `number` | — | Last status change timestamp |
| `pdfData` | `ArrayBuffer \| null` | — | Raw PDF binary (stored after generation) |
| `fileName` | `string` | — | Download filename (e.g., `receipt-12345.pdf`) |
| `retryCount` | `number` | — | Number of sync attempts (max 3) |
| `errorMessage` | `string \| null` | — | Last error message on failure |
| `userId` | `string` | — | Owner's Clerk user ID |
| `venueId` | `string` | — | Associated venue ID |

### 4.2 `pendingActions` Store

Generic outbox for non-PDF actions:

| Field | Type | Key | Description |
|-------|------|-----|-------------|
| `id` | `number` | Primary Key (auto-increment) | Unique action ID |
| `type` | `string` | — | Action type (e.g., `checkin`, `checkout`, `favorite`) |
| `payload` | `object` | — | Action-specific data |
| `timestamp` | `number` | — | Creation time |
| `retryCount` | `number` | — | Attempt count |

### 4.3 Database Schema Diagram

```text
worksphere-offline (v6)
├── venues               (PK: id, Index: type, savedAt)
├── favorites            (PK: id, Index: savedAt)
├── searches             (PK: query, Index: timestamp)
├── pendingActions       (PK: id, auto-increment)
├── imageCacheLRU        (PK: url, Index: lastAccessed)
├── receiptExports       (PK: bookingId, Index: status, createdAt)
│   ├── bookingId: string
│   ├── status: "pending" | "processing" | "completed" | "failed"
│   ├── createdAt: number
│   ├── pdfData: ArrayBuffer | null
│   ├── fileName: string
│   ├── retryCount: number
│   ├── errorMessage: string | null
│   └── userId: string
└── availabilityDeltas   (PK: venueId)
```

---

## 5. Offline PDF Receipt Rendering

### 5.1 PDF Generation Pipeline

When the user requests a receipt download while online, the full pipeline executes:

```text
GET /api/bookings/[bookingId]/download
        |
        v
Server: generateReceiptPdf(booking)
        |
        v
Return Response (Content-Type: application/pdf)
        |
        v
Client: blob → ArrayBuffer → trigger download
```

### 5.2 Offline Fallback Pipeline

When the user is offline, the pipeline generates the PDF client-side and stores it:

```typescript
async function queueReceiptForOffline(bookingId: string): Promise<void> {
  // 1. Fetch booking data from IndexedDB (venue cache)
  const booking = await getBookingFromCache(bookingId);
  if (!booking) throw new Error("Booking not found in offline cache");

  // 2. Generate PDF client-side
  const pdfBytes = await generateReceiptPdf(booking);

  // 3. Store in IndexedDB
  await db.put("receiptExports", {
    bookingId,
    status: "pending",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pdfData: pdfBytes.buffer,
    fileName: `receipt-${bookingId}.pdf`,
    retryCount: 0,
    errorMessage: null,
    userId: booking.userId,
    venueId: booking.venueId,
  });

  // 4. Register background sync
  if ("SyncManager" in window) {
    const reg = await navigator.serviceWorker.ready;
    await reg.sync.register("receipt-export-sync");
  }
}
```

### 5.3 PDF Binary Format

The generated PDF is stored as a raw `ArrayBuffer` in IndexedDB:

| Property | Value |
|----------|-------|
| Format | PDF 1.4 (pdf-lib default) |
| Page size | A4 (595 × 842 points) |
| Font | NotoSans-Regular.ttf (with Helvetica fallback) |
| Encoding | Raw bytes, no compression applied by pdf-lib |
| Typical size | 15–45 KB per receipt |

### 5.4 ArrayBuffer Storage Considerations

| Concern | Strategy |
|---------|----------|
| **Storage quota** | Monitor via `navigator.storage.estimate()`; warn at 80% usage |
| **Safari private browsing** | IndexedDB writes may fail; catch `QuotaExceededError` |
| **Large PDFs** | Tax exports (multi-page) may reach 200 KB; compress if > 100 KB |
| **Cleanup** | Auto-delete completed exports after 7 days |
| **Serialization** | `ArrayBuffer` is cloneable via `structuredClone()` for IDB storage |

---

## 6. Reconnection Download Triggers

### 6.1 Trigger Flow

When the Service Worker completes a background sync for a receipt, it notifies all clients:

```text
SW completes receipt sync
        |
        v
postMessage({ type: "RECEIPT_SYNC_READY", bookingId: "..." })
        |
        v
Client receives message in ServiceWorker controller listener
        |
        v
Client reads IDB: get receiptExports[bookingId]
        |
        v
Create Blob from pdfData ArrayBuffer
        |
        v
Create object URL: URL.createObjectURL(blob)
        |
        v
Create <a> element with download attribute
        |
        v
Programmatic click → browser download dialog
        |
        v
Revoke object URL: URL.revokeObjectURL(url)
```

### 6.2 Client-Side Download Handler

```typescript
// Listen for SW messages
navigator.serviceWorker?.addEventListener("message", (event) => {
  if (event.data?.type === "RECEIPT_SYNC_READY") {
    triggerReceiptDownload(event.data.bookingId);
  }
});

async function triggerReceiptDownload(bookingId: string): Promise<void> {
  const record = await db.get("receiptExports", bookingId);
  if (!record?.pdfData) return;

  const blob = new Blob([record.pdfData], {
    type: "application/pdf",
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = record.fileName || `receipt-${bookingId}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);

  // Update status to completed
  await db.put("receiptExports", {
    ...record,
    status: "completed",
    updatedAt: Date.now(),
  });
}
```

### 6.3 Retry Strategy

| Attempt | Delay | Condition |
|---------|-------|-----------|
| 1st | Immediate | On sync event fire |
| 2nd | 30 seconds | After first failure |
| 3rd | 2 minutes | After second failure |
| 4th+ | Manual only | User-triggered retry |

After 3 failed attempts, the entry is marked as `failed` and requires manual user intervention.

### 6.4 Stale Entry Cleanup

```typescript
// SW: cleanup completed exports older than 7 days
async function cleanupOldExports() {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const tx = db.transaction("receiptExports", "readwrite");
  const store = tx.objectStore("receiptExports");
  const index = store.index("createdAt");

  let cursor = await index.openCursor();
  while (cursor) {
    if (cursor.value.createdAt < cutoff && cursor.value.status === "completed") {
      await cursor.delete();
    }
    cursor = await cursor.continue();
  }
}
```

---

## 7. Service Worker Sync Event Handlers

### 7.1 Sync Event Map

| Tag | Handler Function | Action |
|-----|-----------------|--------|
| `receipt-export-sync` | `handleReceiptSync()` | Process pending receipt exports |
| `sync-crdt` | `handleCrdtSync()` | Upload local CRDT deltas to server |
| `sync-favorites` | `handleFavoritesSync()` | Sync favorites outbox |
| `sync-ratings` | `handleRatingsSync()` | Sync ratings outbox |
| `sync-conversations` | `handleConversationsSync()` | Sync conversation edits |
| `availability-sync` | `handleAvailabilitySync()` | Diff seat availability |

### 7.2 Receipt Sync Handler

```javascript
// public/sw.js
self.addEventListener("sync", (event) => {
  if (event.tag === "receipt-export-sync") {
    event.waitUntil(handleReceiptSync());
  }
  // ... other sync handlers
});

async function handleReceiptSync() {
  const db = await openDatabase("worksphere-offline", 6);
  const tx = db.transaction("receiptExports", "readwrite");
  const store = tx.objectStore("receiptExports");
  const index = store.index("status");

  // Get all pending entries
  const pendingEntries = await getAllFromIndex(index, "pending");

  for (const entry of pendingEntries) {
    try {
      // Update status to processing
      entry.status = "processing";
      entry.updatedAt = Date.now();
      await store.put(entry);

      // Attempt download from server
      const response = await fetch(
        `/api/bookings/${entry.bookingId}/download`,
        { credentials: "include" }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // Store the PDF binary
      const pdfBuffer = await response.arrayBuffer();
      entry.pdfData = pdfBuffer;
      entry.status = "completed";
      entry.updatedAt = Date.now();
      await store.put(entry);

      // Notify all clients
      const clients = await self.clients.matchAll();
      for (const client of clients) {
        client.postMessage({
          type: "RECEIPT_SYNC_READY",
          bookingId: entry.bookingId,
        });
      }
    } catch (error) {
      entry.retryCount += 1;
      entry.errorMessage = error.message;
      entry.updatedAt = Date.now();

      if (entry.retryCount >= 3) {
        entry.status = "failed";
      } else {
        entry.status = "pending"; // Re-queue for next sync
      }

      await store.put(entry);
    }
  }
}
```

### 7.3 Client Message Listener

```typescript
// Client-side: src/hooks/usePWA.tsx
useEffect(() => {
  const listener = (event: MessageEvent) => {
    switch (event.data?.type) {
      case "RECEIPT_SYNC_READY":
        triggerReceiptDownload(event.data.bookingId);
        break;
      case "RECEIPT_SYNC_FAILED":
        showRetryNotification(event.data.bookingId);
        break;
      case "AVAILABILITY_UPDATE":
        refreshAvailability(event.data.venueId);
        break;
    }
  };

  navigator.serviceWorker?.addEventListener("message", listener);
  return () => {
    navigator.serviceWorker?.removeEventListener("message", listener);
  };
}, []);
```

---

## 8. PDF Binary Storage in IndexedDB

### 8.1 Storage Flow

```text
PDF Generation (pdf-lib)
        |
        v
Uint8Array (in memory)
        |
        v
structuredClone() → ArrayBuffer
        |
        v
IndexedDB put("receiptExports", { pdfData: buffer })
        |
        v
Retrieved on demand → Blob → Object URL → Download
```

### 8.2 Storage Estimate Monitoring

```typescript
async function checkStorageQuota(): Promise<{
  usage: number;
  quota: number;
  percentUsed: number;
}> {
  if ("storage" in navigator && "estimate" in navigator.storage) {
    const { usage, quota } = await navigator.storage.estimate();
    return {
      usage: usage || 0,
      quota: quota || 0,
      percentUsed: ((usage || 0) / (quota || 1)) * 100,
    };
  }
  return { usage: 0, quota: 0, percentUsed: 0 };
}
```

### 8.3 Storage Budget

| Data Type | Typical Size | Max per User | Total Budget |
|-----------|:------------:|:------------:|:------------:|
| Single receipt PDF | 15–45 KB | 20 receipts | ~900 KB |
| Tax export PDF | 50–200 KB | 5 exports | ~1 MB |
| Venue cache | 5–10 KB each | 50 venues | ~500 KB |
| Image LRU cache | Variable | 20 MB cap | 20 MB |
| CRDT state | 1–10 KB | 1 doc | ~10 KB |
| **Total estimate** | — | — | **~22.4 MB** |

### 8.4 Error Handling

| Error | Cause | Handling |
|-------|-------|----------|
| `QuotaExceededError` | IDB storage full | Evict oldest completed receipts; warn user |
| `NotFoundError` | DB not opened | Retry database open with exponential backoff |
| `TransactionInactiveError` | Transaction expired | Re-open transaction and retry |
| `DataCloneError` | Non-cloneable data | Ensure `ArrayBuffer`, not `Uint8Array` |

---

## 9. Client-Side Orchestration

### 9.1 Download Request Flow

```typescript
async function requestReceiptDownload(bookingId: string): Promise<void> {
  // Check online status
  if (navigator.onLine) {
    try {
      // Try synchronous download
      const response = await fetch(
        `/api/bookings/${bookingId}/download`,
        { credentials: "include" }
      );

      if (response.ok) {
        const blob = await response.blob();
        triggerBrowserDownload(blob, `receipt-${bookingId}.pdf`);
        return;
      }
    } catch {
      // Fall through to offline queue
    }
  }

  // Offline: queue for background sync
  await queueReceiptForOffline(bookingId);
  showOfflineQueuedNotification(bookingId);
}
```

### 9.2 Notification UX

| State | Notification |
|-------|-------------|
| Queued offline | "Receipt queued. It will download when you're back online." |
| Sync started | "Downloading receipt..." |
| Download ready | "Receipt ready! Download starting..." |
| Sync failed | "Receipt download failed. [Retry]" |

### 9.3 Status Indicator Component

```tsx
function ReceiptDownloadStatus({ bookingId }: { bookingId: string }) {
  const [status, setStatus] = useState<"idle" | "queued" | "syncing" | "ready" | "failed">("idle");

  useEffect(() => {
    // Check IDB for existing status
    db.get("receiptExports", bookingId).then((record) => {
      if (record) setStatus(record.status as any);
    });

    // Listen for SW messages
    const handler = (event: MessageEvent) => {
      if (event.data?.bookingId === bookingId) {
        if (event.data.type === "RECEIPT_SYNC_READY") setStatus("ready");
        if (event.data.type === "RECEIPT_SYNC_FAILED") setStatus("failed");
      }
    };
    navigator.serviceWorker?.addEventListener("message", handler);
    return () => navigator.serviceWorker?.removeEventListener("message", handler);
  }, [bookingId]);

  // Render status UI...
}
```

---

## 10. Automated Test Strategies

### 10.1 Test Categories

| Category | Framework | Focus |
|----------|-----------|-------|
| Unit tests | Jest | PDF generation, IDB operations, sync logic |
| Integration tests | Jest + MSW | SW sync handlers, client-SW messaging |
| E2E tests | Playwright | Full offline → reconnection → download flow |
| Service Worker tests | `@shopify/jest-dom-mocks` | SW registration, sync registration |

### 10.2 Unit Test: PDF Generation

```typescript
// src/__tests__/lib/pdfGenerator.test.ts
import { generateReceiptPdf } from "@/lib/pdfGenerator";

describe("generateReceiptPdf", () => {
  it("returns a valid PDF ArrayBuffer", async () => {
    const mockBooking = {
      id: "booking-123",
      venue: { name: "Test Venue" },
      date: new Date().toISOString(),
      amount: 42.00,
    };

    const result = await generateReceiptPdf(mockBooking);

    expect(result).toBeInstanceOf Uint8Array;
    expect(result.length).toBeGreaterThan(0);
    // PDF magic bytes
    expect(result[0]).toBe(0x25); // %
    expect(result[1]).toBe(0x50); // P
    expect(result[2]).toBe(0x44); // D
    expect(result[3]).toBe(0x46); // F
  });

  it("handles Unicode venue names", async () => {
    const mockBooking = {
      id: "booking-unicode",
      venue: { name: "Café München" },
      date: new Date().toISOString(),
      amount: 10.00,
    };

    const result = await generateReceiptPdf(mockBooking);
    expect(result.length).toBeGreaterThan(0);
  });
});
```

### 10.3 Unit Test: IndexedDB Receipt Storage

```typescript
// src/__tests__/lib/offlineReceiptSync.test.ts
describe("receiptExports IDB store", () => {
  let db: IDBDatabase;

  beforeEach(async () => {
    db = await openTestDatabase("worksphere-offline-test", 6);
  });

  afterEach(() => {
    db.close();
    indexedDB.deleteDatabase("worksphere-offline-test");
  });

  it("stores and retrieves a PDF ArrayBuffer", async () => {
    const pdfData = new ArrayBuffer(1024);
    const record = {
      bookingId: "test-123",
      status: "pending",
      createdAt: Date.now(),
      pdfData,
      fileName: "receipt-test.pdf",
      retryCount: 0,
    };

    await idbPut(db, "receiptExports", record);
    const retrieved = await idbGet(db, "receiptExports", "test-123");

    expect(retrieved).toBeDefined();
    expect(retrieved.pdfData).toBeInstanceOf(ArrayBuffer);
    expect(retrieved.pdfData.byteLength).toBe(1024);
    expect(retrieved.status).toBe("pending");
  });

  it("queries pending entries by status index", async () => {
    await idbPut(db, "receiptExports", {
      bookingId: "a", status: "pending", createdAt: 100,
      pdfData: new ArrayBuffer(100), fileName: "a.pdf", retryCount: 0,
    });
    await idbPut(db, "receiptExports", {
      bookingId: "b", status: "completed", createdAt: 200,
      pdfData: new ArrayBuffer(100), fileName: "b.pdf", retryCount: 0,
    });

    const pending = await idbGetAllFromIndex(db, "receiptExports", "status", "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].bookingId).toBe("a");
  });
});
```

### 10.4 Integration Test: Service Worker Sync

```typescript
// src/__tests__/lib/offlineReceiptSync.test.ts
describe("receipt background sync", () => {
  it("registers receipt-export-sync on offline queue", async () => {
    const reg = await navigator.serviceWorker.ready;
    const syncRegister = jest.spyOn(reg.sync, "register");

    await queueReceiptForOffline("booking-456");

    expect(syncRegister).toHaveBeenCalledWith("receipt-export-sync");
  });

  it("handles RECEIPT_SYNC_READY message from SW", (done) => {
    navigator.serviceWorker.addEventListener("message", function handler(event) {
      if (event.data?.type === "RECEIPT_SYNC_READY") {
        expect(event.data.bookingId).toBe("booking-789");
        navigator.serviceWorker.removeEventListener("message", handler);
        done();
      }
    });

    // Simulate SW message
    navigator.serviceWorker.controller?.postMessage({
      type: "RECEIPT_SYNC_READY",
      bookingId: "booking-789",
    });
  });
});
```

### 10.5 E2E Test: Offline → Reconnection Flow

```typescript
// Playwright E2E test
test.describe("Offline receipt download", () => {
  test("queues receipt offline and downloads on reconnection", async ({ page, context }) => {
    // Go online
    await page.goto("/bookings/123");

    // Simulate going offline
    await context.setOffline(true);

    // Click download receipt
    await page.click('[data-testid="download-receipt"]');
    await expect(page.locator('[data-testid="offline-queued"]')).toBeVisible();

    // Verify IDB has the pending entry
    const pendingEntry = await page.evaluate(async () => {
      const db = await openDB("worksphere-offline", 6);
      const tx = db.transaction("receiptExports", "readonly");
      return tx.objectStore("receiptExports").get("123");
    });
    expect(pendingEntry.status).toBe("pending");
    expect(pendingEntry.pdfData).toBeDefined();

    // Go back online
    await context.setOffline(false);

    // Wait for sync to complete
    await expect(page.locator('[data-testid="download-ready"]')).toBeVisible({
      timeout: 10000,
    });

    // Verify download triggered
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click('[data-testid="download-receipt"]'),
    ]);
    expect(download.suggestedFilename()).toContain("receipt-123");
  });
});
```

### 10.6 Test Matrix

| Test | Unit | Integration | E2E | What it validates |
|------|:----:|:-----------:|:---:|-------------------|
| PDF generation output format | x | | | Valid PDF bytes, correct magic bytes |
| PDF Unicode handling | x | | | Non-ASCII venue names render correctly |
| IDB store write/read | x | | | ArrayBuffer round-trip fidelity |
| IDB status index query | x | | | Pending entries filtered correctly |
| Background sync registration | | x | | `SyncManager.register()` called |
| SW sync → client message | | x | | `RECEIPT_SYNC_READY` received |
| Offline queue → online download | | | x | Full flow from queue to browser download |
| Retry on failure | | x | | Retry count incremented, status cycled |
| Stale entry cleanup | x | | | Entries > 7 days deleted |
| Storage quota monitoring | x | | | Estimate returns valid numbers |

---

## 11. Troubleshooting

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| PDF not downloading after reconnection | SW sync event not firing | Check `SyncManager` support; verify tag name matches |
| IndexedDB `QuotaExceededError` | Storage full | Run cleanup; evict old completed exports |
| PDF ArrayBuffer is empty | Generation failed silently | Check `pdfGenerator` error handling; verify font loading |
| SW message not received | Client not listening | Ensure `navigator.serviceWorker.addEventListener("message")` is registered |
| Safari: PDF works online but not offline | Safari IndexedDB quota in private browsing | Warn user; fall back to server-side generation |
| Receipt shows "failed" status | 3 retry attempts exhausted | User must manually retry; check network |

---

## 12. Implementation Checklist

- [ ] Verify `public/sw.js` handles `receipt-export-sync` tag in `sync` event listener.
- [ ] Confirm `receiptExports` IDB store schema matches Section 4.1 in `offlineStorage.ts`.
- [ ] Ensure PDF `ArrayBuffer` is stored (not `Uint8Array`) for IDB `structuredClone` compatibility.
- [ ] Verify SW sends `RECEIPT_SYNC_READY` message to all clients after successful sync.
- [ ] Confirm client listener in `usePWA.tsx` handles `RECEIPT_SYNC_READY` and triggers download.
- [ ] Implement storage quota monitoring with warning at 80% usage.
- [ ] Add stale entry cleanup (7-day TTL) for completed exports.
- [ ] Ensure `retryCount` max is 3 with `failed` status after exhaustion.
- [ ] Add unit tests for PDF generation and IDB round-trip (Sections 10.2–10.3).
- [ ] Add integration test for SW sync → client message (Section 10.4).
- [ ] Add E2E test for offline → reconnection → download flow (Section 10.5).
- [ ] Update `TODO.md` to mark completed implementation items.

---

## References

- [PDF Compiling Guide](./PDF_COMPILING_GUIDE.md)
- [Offline Storage and IndexedDB Sync Strategy](./OFFLINE_INDEXEDDB_STRATEGY.md)
- [Periodic Background Sync Playbook](./PERIODIC_BACKGROUND_SYNC_PLAYBOOK.md)
- [PWA Service Worker Specification](./PWA_SERVICE_WORKER_SPECIFICATION.md)
- [PWA Service Worker Guide](./PWA_SERVICE_WORKER_GUIDE.md)
- [Background Sync Debug Guide](./BACKGROUND_SYNC_DEBUG.md)
- [PWA Testing Guidelines](./PWA_TESTING_GUIDELINES.md)
- [Web Workers Sync Infrastructure](./WEB_WORKERS_SYNC_INFRASTRUCTURE.md)
