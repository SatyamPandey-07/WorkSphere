# PWA Push Notification Debugging Guide

This guide explains how to trigger and debug **background push notification events** locally in WorkSphere.

It is scoped specifically to the `push` and `notificationclick` handlers in `public/sw.js`. For asset caching, Background Sync (offline favorites/ratings/conversations), and general Service Worker lifecycle issues, see [`PWA_TROUBLESHOOTING.md`](./PWA_TROUBLESHOOTING.md) and [`PWA_SYNC_DEBUG.md`](./PWA_SYNC_DEBUG.md) instead — push and sync are separate features that happen to live in the same file.

This document is intended for contributors working on the WorkSphere codebase.

---

# Overview

WorkSphere's Service Worker (`public/sw.js`) listens for two notification-related events:

- **`push`** — fires when a push message is received. The handler parses the payload as JSON and calls `self.registration.showNotification(...)`.
- **`notificationclick`** — fires when the user clicks (or dismisses) a shown notification. The handler focuses an existing tab or opens a new one at `data.url`.

**Important:** as of this writing, WorkSphere does not yet implement a client-side `PushManager.subscribe()` flow (there's no VAPID key exchange or subscription endpoint registered anywhere in `src/`). This means there is currently no way to trigger a *real* push message end-to-end from a server in local development. All local testing goes through Chrome DevTools' manual push simulator described below, which invokes the `push` event handler directly without a real push subscription. Keep this in mind so you don't spend time hunting for a subscription bug that isn't there yet — if you're implementing the subscribe flow, this doc still applies for verifying the receiving side.

---

# Prerequisites

Before testing push events, make sure:

- The app is running locally (`npm run dev` or a production build served locally).
- You're using Chrome or another Chromium-based browser (Edge, Brave) — DevTools' push simulator is not available in Firefox/Safari.
- The Service Worker is registered and **activated** (`Application → Service Workers`).
- Notification permission for `localhost` is not set to `denied` (see [Permission Status](#permission-status) below).

---

# 1. Push Triggers (Chrome DevTools)

1. Open **Chrome DevTools** (`F12` or `Cmd+Opt+I`).
2. Go to **Application → Service Workers**.
3. Confirm the worker for your origin shows **activated and is running**. If it says "waiting to activate," check **Update on reload** and refresh the page.
4. In the row for the active worker, find the **Push** text field and button.
5. Type a payload and click **Push**. The payload must be valid JSON, since `sw.js` calls `event.data.json()` — a non-JSON string will throw inside the handler and no notification will appear. Use a shape matching what the handler expects, for example:
   ```json
   { "title": "New venue nearby", "body": "A cafe matching your search just opened.", "url": "/ai" }
   ```
6. A native OS/browser notification should appear using the `title`/`body`/`url` fields. If it doesn't, see [Common Issues](#common-issues) below.
7. Click the notification (or its **Open**/**Dismiss** action buttons) to exercise `notificationclick`. **Open** should focus an existing WorkSphere tab if one is open at that URL, or open a new one; **Dismiss** should just close the notification with no navigation.

### Permission status

The `push` handler doesn't request permission itself — something calling `Notification.requestPermission()` from a user gesture must grant it first. Check the current state in the DevTools console:

```javascript
Notification.permission; // "default" | "granted" | "denied"
```

- `default`: not yet prompted — the DevTools Push button will still deliver the event to the Service Worker, but `showNotification` may silently no-op depending on the browser.
- `granted`: required for the notification to actually display.
- `denied`: click the lock/info icon in the address bar and reset the **Notifications** permission to **Ask** or **Allow**, since the browser won't prompt again on its own.

### Empty or malformed payloads

`sw.js` returns early if `event.data` is empty (`if (!event.data) return;`), so pushing with a blank payload is a valid way to confirm the early-return path doesn't throw — you just won't see a notification, which is expected.

---

# 2. IndexedDB Inspection

Push notifications themselves don't write anything to IndexedDB — the `push`/`notificationclick` handlers only call the Notifications API. What *does* live in IndexedDB is the offline action queue that Background Sync drains (reviews/ratings, favorites, conversation edits), which is often being debugged alongside push in the same session since both surface as "did the background event actually run."

1. Open **Application → IndexedDB → `worksphere-offline`**.
2. You'll see these object stores (schema defined in both `src/lib/offlineStorage.ts` and mirrored in `public/sw.js`'s `openIndexedDB()`):
   - **`venues`** — cached venue records for offline browsing.
   - **`favorites`** — locally saved favorites (mirrors the `yFavorites` Yjs map).
   - **`searches`** — recent search results, capped at the 15 most recent queries.
   - **`pendingActions`** — the outbox. Every queued offline mutation lands here with a `type` field, including:
     - `"rate"` — a queued venue rating/review (submitted via the rating dialog while offline).
     - `"favorite"` / `"unfavorite"` — queued favorite toggles.
     - `"crdt-sync"` — raw Yjs update payloads.
     - `"conversation-rename"` / `"conversation-delete"` — queued conversation edits.
3. To verify a **queued review**: submit a rating while DevTools' Network tab is set to **Offline**, then check `pendingActions` for a new entry with `type: "rate"` and a `venueId`. Go back online and confirm the entry disappears once `sync-ratings` runs (see `PWA_SYNC_DEBUG.md` for triggering Background Sync manually).
4. **Note on bookings:** there is currently no offline queue for bookings in this codebase — booking confirmation is an online-only flow (`src/app/api/bookings/confirm/route.ts`). If you're testing a booking-related notification, it will only exist as a `push` payload you send manually via DevTools (per section 1), not as a `pendingActions` entry.
5. If a store you expect is missing entirely, the database may not have been created yet — perform the relevant action once while online first, or check that `initOfflineDB()` has run (it runs lazily on first offline-storage call, not automatically on page load).

---

# 3. Log Tracing

The Service Worker and offline-storage code use a few consistent console tags. Filter the console by these to cut noise:

| Tag | Source | What it tells you |
| --- | --- | --- |
| `[PWA]` | `src/hooks/usePWA.tsx` | Service Worker registration, update detection |
| `[SW]` | `public/sw.js` install handler | Precache failures during install |
| `[OfflineDB]` | `src/lib/offlineStorage.ts` | IndexedDB open/schema creation |

**The `push` and `notificationclick` handlers themselves don't currently log anything on success or failure.** When debugging a push that silently fails to show, the most reliable approach is:

1. Go to **Application → Service Workers**, find your worker, and click **Inspect**. This opens a dedicated DevTools window scoped to the Service Worker's own execution context (not the page).
2. In that window's **Console**, trigger the push again from the main tab's Application panel. Any exception thrown inside the `push` handler (e.g. `event.data.json()` failing on invalid JSON) will surface here — it will *not* appear in the regular page console.
3. If you need more visibility while debugging, temporarily add `console.log` statements inside the `push` and `notificationclick` listeners in `public/sw.js` — just remember to remove them before committing, since this file is not currently instrumented like the rest of the offline stack.
4. The **Application → Service Workers** panel also has a small event log at the bottom of each worker's row (look for "push", "notificationclick" entries with timestamps) that's useful for confirming an event actually reached the worker versus being silently dropped.

---

# Common Issues

## Nothing happens when I click "Push" in DevTools

- The worker isn't actually activated — check the status badge in **Application → Service Workers**.
- The payload isn't valid JSON. `event.data.json()` throws on non-JSON input, and that error is only visible in the dedicated Service Worker console (see [Log Tracing](#3-log-tracing)), not the page console.
- Notification permission is `denied` for the origin.

## The Service Worker fails to install/activate at all (push never has a chance to fire)

`public/sw.js` is registered as a classic (non-module) script via `navigator.serviceWorker.register("/sw.js")` in `src/hooks/usePWA.tsx`. If the file contains an `import` statement (there currently is one, importing from `../src/lib/offlineStore` near the bottom of the file, alongside a second `sync` event listener), that will throw a `SyntaxError` on parse in a classic worker context and can prevent the whole file — including the `push` handler — from registering correctly. If push stops working after editing `sw.js`, check the **Console** on the page (not the SW-scoped console) for a registration failure first, before digging into push-specific causes.

## Notification shows the wrong title/body or the fallback text

The handler falls back to `"WorkSphere"` / `"New update from WorkSphere"` when `data.title`/`data.body` are missing — this usually means the pushed payload's field names don't match what `sw.js` reads (`title`, `body`, `url`). Double-check the JSON keys you're sending from DevTools.

## Clicking the notification opens a new tab instead of focusing the existing one

`notificationclick` only focuses an existing client if its `client.url` matches `event.notification.data.url` **exactly**. A trailing slash or query string mismatch (e.g. `/ai` vs `/ai/`) will cause it to always open a new window.

## Service Worker changes aren't picked up

Same as any Service Worker update: enable **Update on reload** in **Application → Service Workers**, or manually **Unregister** and hard-refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`).

---

# Related Source Files

- `public/sw.js` — `push` and `notificationclick` event handlers, `openIndexedDB()`.
- `src/hooks/usePWA.tsx` — Service Worker registration (`useServiceWorker`).
- `src/lib/offlineStorage.ts` — IndexedDB schema and `pendingActions` queue helpers.

# Related Docs

- [`PWA_TROUBLESHOOTING.md`](./PWA_TROUBLESHOOTING.md) — general Service Worker, caching, and offline troubleshooting.
- [`PWA_SYNC_DEBUG.md`](./PWA_SYNC_DEBUG.md) — Background Sync debugging for the offline action queue.
- [`PWA_STRATEGY.md`](./PWA_STRATEGY.md) — overall PWA caching/offline strategy.
