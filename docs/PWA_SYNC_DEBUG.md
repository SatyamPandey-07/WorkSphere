# PWA Background Sync Debugging Guide

## Overview

WorkSphere uses the **Background Sync API** to improve the offline experience by queuing user actions (such as reviews, bookings, or collaborative updates) while the network is unavailable. Once connectivity is restored, the Service Worker automatically retries these queued operations.

This guide explains how to debug and verify Background Sync during local development.

---

# Prerequisites

Before testing Background Sync, ensure that:

- The application is running locally.
- The Service Worker is successfully registered.
- Google Chrome (or another browser with Background Sync support) is being used.
- DevTools are available.

---

# Trigger Background Sync Using Chrome DevTools

1. Start the application locally.

2. Open **Google Chrome DevTools**.

3. Navigate to:

```
Application → Service Workers
```

4. Confirm that the Service Worker is:

- Registered
- Activated
- Running

5. Open the **Network** tab and enable:

```
Offline
```

6. Perform an action that normally sends data to the server (for example, creating a review or booking).

7. Verify that the request is queued instead of failing.

8. Re-enable the network connection.

9. Return to the **Service Workers** panel and trigger a Background Sync event (when available).

10. Confirm that the queued request is processed successfully.

---

# Inspect the Offline Queue (IndexedDB)

Queued operations are stored inside the browser's IndexedDB database.

Open:

```
Application → IndexedDB
```

Verify the following:

- Pending entries exist after an offline action.
- Stored data matches the expected payload.
- Entries disappear after successful synchronization.
- No duplicate records remain after retry.

---

# Monitor Service Worker Logs

Open:

```
Developer Tools → Console
```

Useful log messages include:

- Service Worker registration
- Background Sync registration
- Sync event execution
- Queue processing
- Successful synchronization
- Registration or synchronization failures

If debugging Service Worker execution directly:

```
Application → Service Workers → Inspect
```

This opens a dedicated console for Service Worker logs.

---

# Common Issues

## Background Sync Never Runs

Possible causes:

- Service Worker is not active.
- Browser does not support Background Sync.
- No queued operations exist.
- Background Sync registration failed.

---

## Requests Stay in IndexedDB

Possible causes:

- API request failed.
- Backend returned an error.
- Network connection was not restored.
- Queue processing encountered an exception.

---

## Service Worker Changes Are Not Applied

Try the following:

- Hard Refresh (`Ctrl + Shift + R`)
- Unregister the Service Worker
- Clear Site Data
- Reload the application
- Rebuild and restart the development server

---

# Recommended Debug Workflow

Follow this checklist when testing offline synchronization:

1. Register the Service Worker.
2. Enable Offline mode.
3. Perform an action that queues data.
4. Verify the queued entry inside IndexedDB.
5. Restore network connectivity.
6. Trigger Background Sync.
7. Confirm successful synchronization.
8. Verify that queued entries have been removed.
9. Ensure the UI reflects the synchronized state.

---

# Related Source Files

This guide is related to the following implementation files:

- `src/hooks/usePWA.tsx`
- `src/lib/offlineStorage.ts`

These files handle Service Worker registration, offline storage, queue management, and Background Sync behavior.

---

# Additional References

Useful browser tools:

- Chrome DevTools → Application → Service Workers
- Chrome DevTools → Application → IndexedDB
- Chrome DevTools → Network
- Chrome DevTools → Console

These tools provide everything needed to inspect, debug, and validate the complete Background Sync workflow during development.
