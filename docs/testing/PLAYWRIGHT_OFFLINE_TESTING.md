# Playwright End-to-End Testing Runbook for Offline PWA Flows

## Overview & Scope

WorkSphere operates as a Progressive Web App (PWA) with offline-first capabilities. Nomads can draft desk reservations, check venue details, and stage check-in actions even when disconnected from the internet.

Testing these capabilities in CI requires configuring Playwright browser contexts to simulate network disconnections, evaluate Service Worker caches, and verify IndexedDB persistent storage queues.

---

## Network Emulation Commands in Playwright

Playwright provides built-in browser context network emulation via `context.setOffline(boolean)`:

```typescript
// 1. Emulate network disconnection
await context.setOffline(true);

// 2. Perform offline user interactions (e.g. form submissions, cache browsing)
// ...

// 3. Restore network connectivity
await context.setOffline(false);
```

When offline emulation is active, any un-cached network `fetch` or `XMLHttpRequest` fails immediately with `net::ERR_INTERNET_DISCONNECTED`, allowing validation of Service Worker fallback responses and offline UI banners.

---

## Verifying Service Worker Caches & IndexedDB Storage

### 1. Verifying Service Worker Cache Hits
Ensure static assets and API route responses (e.g. `/api/venues/*`) are served directly from Cache Storage during offline mode:

```typescript
test("serves cached venue details from Service Worker cache when offline", async ({ page, context }) => {
  // Prime cache while online
  await page.goto("/venues/cafe-artisan");
  await page.waitForLoadState("networkidle");

  // Switch to offline
  await context.setOffline(true);

  // Reload page to verify offline cache delivery
  await page.reload();

  // Verify cached content renders
  await expect(page.getByRole("heading", { name: "Cafe Artisan" })).toBeVisible();
  await expect(page.getByTestId("offline-indicator-banner")).toBeVisible();
});
```

### 2. Inspecting IndexedDB Draft Storage via `page.evaluate()`
WorkSphere queues offline booking drafts and mutation operations in IndexedDB (`worksphere-offline-db`). Playwright tests can query IndexedDB directly:

```typescript
export async function getIndexedDBRecords(page: Page, dbName: string, storeName: string) {
  return page.evaluate(
    ({ dbName, storeName }) => {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(storeName, "readonly");
          const store = tx.objectStore(storeName);
          const getAllReq = store.getAll();
          getAllReq.onsuccess = () => resolve(getAllReq.result);
          getAllReq.onerror = () => reject(getAllReq.error);
        };
      });
    },
    { dbName, storeName }
  );
}
```

---

## Complete E2E Test Suite Example: Offline Booking Submission

```typescript
import { test, expect } from "@playwright/test";
import { getIndexedDBRecords } from "./helpers/idbHelper";

test.describe("Offline PWA Booking Flows", () => {
  test("queues booking in IndexedDB when offline and syncs upon reconnection", async ({ page, context }) => {
    // 1. Visit venue page while online
    await page.goto("/venues/hub-nomad");
    await page.getByRole("button", { name: "Book Desk" }).click();

    // 2. Disconnect network
    await context.setOffline(true);

    // 3. Fill booking reservation details
    await page.getByLabel("Select Date").fill("2026-11-25");
    await page.getByRole("button", { name: "Confirm Reservation" }).click();

    // 4. Verify offline feedback UI
    await expect(page.getByText("You are currently offline. Booking saved to sync queue.")).toBeVisible();

    // 5. Verify record staged in IndexedDB
    const queuedBookings: any = await getIndexedDBRecords(page, "worksphere-offline-db", "booking-queue");
    expect(queuedBookings).toHaveLength(1);
    expect(queuedBookings[0].venueId).toBe("hub-nomad");
    expect(queuedBookings[0].status).toBe("PENDING_SYNC");

    // 6. Restore network connection
    await context.setOffline(false);

    // 7. Verify background sync flush
    await expect(page.getByText("Booking synced successfully!")).toBeVisible({ timeout: 10000 });
  });
});
```

---

## Best Practices & Troubleshooting

1. **Wait for Service Worker Activation**: In tests, ensure `navigator.serviceWorker.ready` has resolved before toggling `context.setOffline(true)`.
2. **Clear Storage Between Tests**: Always purge IndexedDB and caches in `test.beforeEach` or isolate test contexts to avoid cross-test pollution.
3. **Handle Chromium vs WebKit Limitations**: Ensure Service Worker permissions are enabled when running under WebKit or headless Chromium containers.
