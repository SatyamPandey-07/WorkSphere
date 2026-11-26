# PWA Push Notification Debugging Guide

This guide explains how to test, trigger, and debug **background push notifications** locally in WorkSphere.

It is scoped specifically to the push notification architecture: the client-side subscription hook (`src/hooks/usePushNotifications.ts`), the backend VAPID/subscription endpoints (`/api/push/*`), the server push dispatcher (`src/lib/pushNotifications.ts`), and the Service Worker listeners (`push` and `notificationclick`) in `public/sw.js`.

For asset caching, Background Sync (offline ratings, favorites, draft reservations), and general Service Worker lifecycle issues, see [`PWA_TROUBLESHOOTING.md`](./PWA_TROUBLESHOOTING.md), [`PWA_SYNC_DEBUG.md`](./PWA_SYNC_DEBUG.md), and [`PWA_OFFLINE_GUIDE.md`](./PWA_OFFLINE_GUIDE.md). For complete VAPID keypair generation and rotation procedures, see [`PUSH_NOTIFICATIONS.md`](./PUSH_NOTIFICATIONS.md).

---

# Architecture Overview

WorkSphere provides end-to-end Web Push notification support:

```
┌─────────────────────────────────┐       ┌───────────────────────────────────┐
│     Client (Browser / PWA)      │       │        WorkSphere Backend         │
├─────────────────────────────────┤       ├───────────────────────────────────┤
│ 1. usePushNotifications.ts      │ ────> │ GET  /api/push/vapid-public-key   │
│    Fetches public VAPID key     │       │                                   │
│ 2. reg.pushManager.subscribe()  │       │                                   │
│    Registers with Browser Push  │       │                                   │
│ 3. Stores PushSubscription      │ ────> │ POST /api/push/subscribe          │
│                                 │       │ (persists subscription in DB)     │
└─────────────────────────────────┘       └──────────────────┬────────────────┘
                                                             │
                                          Trigger event / notification dispatcher
                                                             │
                                                             ▼
┌─────────────────────────────────┐       ┌───────────────────────────────────┐
│       public/sw.js (PWA)        │       │    Browser Push Service (FCM/etc) │
├─────────────────────────────────┤       ├───────────────────────────────────┤
│ 4. "push" event handler fires   │ <──── │ Server pushes encrypted payload   │
│    Parses JSON/text payload     │       │ via web-push library              │
│    Shows native notification    │       └───────────────────────────────────┘
│ 5. "notificationclick" fires    │
│    Focuses or opens target URL  │
└─────────────────────────────────┘
```

1. **Client Subscription Hook (`src/hooks/usePushNotifications.ts`):** Checks browser support (`PushManager`, `Notification`, `serviceWorker`), requests user permissions, fetches the public VAPID key from `/api/push/vapid-public-key`, calls `registration.pushManager.subscribe()`, and registers the subscription via `POST /api/push/subscribe`.
2. **Backend API Endpoints (`src/app/api/push/`):**
   - `GET /api/push/vapid-public-key` — exposes `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
   - `POST /api/push/subscribe` — associates the push endpoint and authentication keys with the signed-in user.
   - `POST /api/push/unsubscribe` — deactivates or removes a registered subscription.
3. **Push Delivery Helper (`src/lib/pushNotifications.ts`):** Encrypts and transmits payloads to push endpoints using the `web-push` standard with VAPID signing.
4. **Service Worker Handlers (`public/sw.js`):**
   - **`push`** — receives the push event, parses JSON (with fallback for text payloads), customizes options (sound, vibration, urgency), and calls `self.registration.showNotification()`.
   - **`notificationclick`** — handles click actions ("open" vs "dismiss"), finds existing matching browser windows by pathname, focuses them and sends a `NAVIGATE_PUSH` message, or opens a new tab.

---

# Prerequisites for Local Debugging

Before debugging push notifications, ensure:

- The app is running locally (`npm run dev` or local production server).
- You are using a browser supporting the Push API (e.g. Chrome, Edge, Brave, Firefox, Safari 16+ on macOS/iOS).
- The Service Worker is registered and activated at `Application → Service Workers`.
- Notification permission for `localhost` is granted (`Notification.permission === "granted"`).

---

# 1. Testing via Chrome DevTools (Manual Push Simulation)

Chrome DevTools allows you to test the Service Worker's `push` and `notificationclick` handlers directly without requiring valid VAPID keys or external push network delivery:

1. Open **Chrome DevTools** (`F12` or `Ctrl+Shift+I` / `Cmd+Opt+I`).
2. Navigate to **Application → Service Workers**.
3. Locate the Service Worker registered for `localhost:3000`. Confirm the status shows **activated and is running**.
4. In the worker entry, locate the **Push** input field and button.
5. Enter a JSON payload and click **Push**.

### Expected Payload Shape

WorkSphere's `public/sw.js` push handler expects the following payload structure:

```json
{
  "title": "Venue Seat Available",
  "body": "A seat opened up at Cyber Cafe Tokyo. Tap to reserve.",
  "url": "/venues/cyber-cafe-tokyo",
  "icon": "/icons/icon.svg",
  "badge": "/icons/icon.svg",
  "tag": "venue-availability-tokyo-1",
  "data": {
    "venueId": "tokyo-1"
  }
}
```

### Supported Properties and Behaviors

| Field     | Type   | Default                        | Description                                                                                                                                                   |
| --------- | ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`   | string | `"WorkSphere"`                 | Notification title.                                                                                                                                           |
| `body`    | string | `"New update from WorkSphere"` | Main notification body text.                                                                                                                                  |
| `url`     | string | `"/"`                          | Relative or absolute URL navigated when clicked.                                                                                                              |
| `tag`     | string | `"worksphere-notification"`    | Unique tag identifier. If prefixed with `venue-availability-`, activates urgent vibration pattern `[200, 100, 200, 100, 200]` and `requireInteraction: true`. |
| `icon`    | string | `"/icons/icon.svg"`            | Notification icon URL.                                                                                                                                        |
| `badge`   | string | `"/icons/icon.svg"`            | Monochrome badge icon for mobile status bars.                                                                                                                 |
| `actions` | array  | `[Open, Dismiss]`              | Action buttons configured automatically by `sw.js`.                                                                                                           |

### Payload Parsing and Fallbacks

Unlike primitive push implementations, WorkSphere's `public/sw.js` uses multi-stage parsing:

1. First attempts `event.data.json()`.
2. If JSON parsing fails, retrieves raw string via `event.data.text()`.
3. Attempts `JSON.parse(textPayload)`.
4. If still invalid JSON, falls back to displaying `{ title: "WorkSphere", body: textPayload }`.
5. If `event.data` is completely null or empty, the handler safely exits without crashing.

---

# 2. Testing End-to-End Push with VAPID Keys

To test real server-delivered push notifications locally:

1. Generate a test VAPID keypair if not already configured:
   ```bash
   npx web-push generate-vapid-keys
   ```
2. Configure `.env.local`:
   ```dotenv
   NEXT_PUBLIC_VAPID_PUBLIC_KEY=your_public_key_base64
   VAPID_PRIVATE_KEY=your_private_key_base64
   VAPID_SUBJECT=mailto:dev@worksphere.local
   ```
3. Restart the development server (`npm run dev`).
4. In the application, use the notification toggle or call `usePushNotifications().subscribe()` to generate a browser push subscription.
5. Verify in DevTools Network tab that `POST /api/push/subscribe` returns HTTP 200/201.
6. Trigger a notification dispatch via the backend notification service or test script. The push service will deliver the encrypted message to the browser, triggering `public/sw.js`.

---

# 3. Notification Click and Navigation Behavior

When a notification is clicked:

1. `event.notification.close()` is called immediately to dismiss the notification.
2. If the user clicked the **Dismiss** action button, the handler returns without opening any window.
3. If the user clicked the body or **Open**:
   - Computes target absolute URL from `notification.data.url`.
   - Iterates through all open window clients (`clients.matchAll({ type: "window", includeUncontrolled: true })`).
   - If an open window matches the target pathname (`client.url.includes(new URL(fullUrl).pathname)`):
     - Sends `{ type: "NAVIGATE_PUSH", url: fullUrl }` via `postMessage`.
     - Calls `client.focus()`.
   - If no matching window client exists, calls `clients.openWindow(fullUrl)` to launch a new tab.

---

# 4. Troubleshooting and Common Issues

### Notification does not display when clicking "Push" in DevTools

- **Permission denied:** Check `Notification.permission` in the browser console. If `"denied"`, click the lock icon in the browser address bar and set Notifications to **Allow**.
- **Worker inactive:** In **Application → Service Workers**, check that the status is green ("activated and is running"). Check **Update on reload** and reload the page if it is waiting to activate.
- **Operating system focus/do-not-disturb mode:** On macOS and Windows, system Focus Assist or Do Not Disturb may suppress banner alerts and route them directly to Notification Center / Action Center.

### Click event opens a new tab instead of focusing existing tab

- Pathname comparison checks `client.url.includes(new URL(fullUrl).pathname)`. If the existing tab is on a different route or subpath, a new tab is deliberately opened to preserve the user's existing work context.

### Classic Service Worker registration

- `public/sw.js` is registered as a classic (non-module) script via `navigator.serviceWorker.register("/sw.js")`. It does not contain ES module `import` or `export` statements; test exports are wrapped in CommonJS conditional checks (`typeof module !== "undefined" && module.exports`) to remain compatible with browser runtime execution.

---

# Related Source Files

- `public/sw.js` — Service Worker `push` and `notificationclick` listeners.
- `src/hooks/usePushNotifications.ts` — React hook managing subscription lifecycle and permissions.
- `src/lib/pushNotifications.ts` — Server-side VAPID message encryption and dispatch.
- `src/app/api/push/vapid-public-key/route.ts` — Public key distribution endpoint.
- `src/app/api/push/subscribe/route.ts` — Push subscription persistence endpoint.
- `src/app/api/push/unsubscribe/route.ts` — Push subscription removal endpoint.

# Related Documentation

- [`PUSH_NOTIFICATIONS.md`](./PUSH_NOTIFICATIONS.md) — Comprehensive VAPID configuration, database schema, and rotation playbook.
- [`PWA_OFFLINE_GUIDE.md`](./PWA_OFFLINE_GUIDE.md) — Offline architecture, IndexedDB stores, and sync mechanisms.
- [`PWA_SYNC_DEBUG.md`](./PWA_SYNC_DEBUG.md) — Background Sync debugging for offline action queues.
- [`PWA_TROUBLESHOOTING.md`](./PWA_TROUBLESHOOTING.md) — Service Worker registration and lifecycle troubleshooting.
