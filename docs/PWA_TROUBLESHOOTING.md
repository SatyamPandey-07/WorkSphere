# PWA Troubleshooting Guide

This guide explains how to troubleshoot Progressive Web App (PWA) functionality in WorkSphere during local development.

It focuses on the application's Service Worker, cached assets, IndexedDB storage, Background Sync, and offline experience. Whether you are developing a new feature or debugging an existing one, this guide provides practical steps to help you verify and troubleshoot the PWA implementation.

This document is intended for contributors working on the WorkSphere codebase.

---

# Overview

WorkSphere includes Progressive Web App (PWA) capabilities to improve reliability and provide a smoother experience when network connectivity is unavailable or unstable.

The current implementation includes:

- Service Worker registration for asset caching.
- Offline fallback support for navigation requests.
- IndexedDB storage for offline data and queued actions.
- Background Sync for retrying pending operations.
- Installable PWA support through the Web App Manifest.

Understanding how these components interact makes it much easier to debug caching issues, validate offline functionality, and verify application updates during development.

---

# WorkSphere PWA Architecture

The offline workflow used by WorkSphere is illustrated below.

```text
                 User Request
                      │
                      ▼
              Service Worker
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
     Cache Storage          IndexedDB
   (worksphere-v2)     (worksphere-offline)
          │                       │
          └───────────┬───────────┘
                      ▼
              Background Sync
                      │
                      ▼
               WorkSphere APIs
```

---

# Core Components

The following files are responsible for the application's PWA functionality.

| Component                   | Purpose                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| `public/sw.js`              | Registers the Service Worker, manages cache strategies, and handles Background Sync events.         |
| `public/manifest.json`      | Defines installable PWA metadata, including application name, icons, theme color, and display mode. |
| `src/hooks/usePWA.tsx`      | Registers the Service Worker and tracks installation status and network connectivity.               |
| `src/app/offline/page.tsx`  | Displays the offline experience when navigation requests cannot reach the network.                  |
| `src/lib/offlineStorage.ts` | Stores offline data in IndexedDB and queues actions for Background Sync.                            |

---

# Current Implementation

The current WorkSphere PWA implementation includes the following components.

| Feature              | Status         |
| -------------------- | -------------- |
| Service Worker       | ✅ Implemented |
| Offline Page         | ✅ Implemented |
| Cache Storage        | ✅ Implemented |
| IndexedDB Storage    | ✅ Implemented |
| Background Sync      | ✅ Implemented |
| Web App Manifest     | ✅ Implemented |
| Offline Retry Page   | ✅ Implemented |
| Playwright PWA Tests | ✅ Implemented |

---

# Service Worker Lifecycle

WorkSphere uses a dedicated Service Worker (`public/sw.js`) to provide offline capabilities, improve loading performance, and support Background Sync.

During development, understanding the Service Worker lifecycle helps diagnose issues related to stale assets, outdated caches, and offline behavior.

The lifecycle consists of three main phases.

## 1. Installation

When the browser downloads a new version of the Service Worker, the `install` event is triggered.

During this phase, WorkSphere creates a new cache and preloads a small set of essential assets required for offline functionality.

Current cache name:

```text
worksphere-v2
```

Precached assets include:

- `/`
- `/offline`
- `/manifest.json`
- `/icons/icon.svg`

After successful installation, the Service Worker immediately activates by calling `skipWaiting()`, allowing updates to become available without waiting for older workers to terminate.

---

## 2. Activation

Once installed, the Service Worker enters the activation phase.

During activation, WorkSphere removes outdated cache versions to prevent users from receiving stale assets after deployments.

The Service Worker also claims existing browser clients so that newly opened pages immediately begin using the latest version.

If cached assets appear outdated after making changes, this phase is usually the first place to investigate.

---

## 3. Fetch Handling

Every network request made by the application passes through the Service Worker.

WorkSphere applies different caching strategies depending on the type of resource being requested.

| Resource Type                      | Strategy              |
| ---------------------------------- | --------------------- |
| Application pages and local assets | Network First         |
| OpenStreetMap tiles                | Cache First           |
| Unsplash images                    | Cache First           |
| Non-GET requests                   | Bypass Service Worker |

For navigation requests, WorkSphere attempts to fetch fresh content from the network first.

If the request cannot be completed because the user is offline, the cached offline page is returned instead.

This approach ensures that users receive the most recent content whenever possible while still providing a functional experience without network connectivity.

---

# Cache Storage

WorkSphere stores cached assets using the browser Cache Storage API.

Current cache:

```text
worksphere-v2
```

The cache is automatically managed by the Service Worker.

During activation:

- Older cache versions are removed.
- The latest cache remains active.
- Newly fetched resources are stored for future use.

Developers generally do not need to modify cached data manually unless they are testing changes to the Service Worker or debugging outdated assets.

---

# Force Refreshing the Service Worker

Browsers aggressively cache Service Workers during development.

If recent changes are not appearing, manually refreshing the Service Worker usually resolves the issue.

### Chrome

1. Open **Developer Tools**.
2. Navigate to **Application → Service Workers**.
3. Select **Unregister**.
4. Open **Application → Storage**.
5. Click **Clear site data**.
6. Reload the application.

### Safari

1. Enable the **Develop** menu.
2. Open **Develop → Show Web Inspector**.
3. Remove the registered Service Worker.
4. Clear website data if necessary.
5. Reload the application.

---

# Verifying Cache Storage

To confirm that caching is working correctly:

1. Open **Developer Tools**.
2. Navigate to **Application → Cache Storage**.
3. Expand the active cache.

You should see a cache named:

```text
worksphere-v2
```

The cache should contain the application's precached assets along with any resources cached during normal usage.

If the cache is missing, verify that:

- the Service Worker is successfully registered,
- `sw.js` is accessible,
- browser caching has not been disabled,
- no registration errors appear in the browser console.

---

# IndexedDB Storage

WorkSphere uses **IndexedDB** to persist offline data and queue user actions that cannot be completed while the device is offline.

Unlike Cache Storage, which stores network responses, IndexedDB is designed to hold structured application data. This allows WorkSphere to preserve user information locally until connectivity is restored.

Current database:

```text
worksphere-offline
```

The database contains the following object stores.

| Object Store     | Purpose                                                                        |
| ---------------- | ------------------------------------------------------------------------------ |
| `venues`         | Stores cached workspace information for offline access.                        |
| `favorites`      | Stores bookmarked workspaces locally.                                          |
| `searches`       | Saves recent search results for faster access.                                 |
| `pendingActions` | Queues actions that should be synchronized after reconnecting to the internet. |

---

# Inspecting IndexedDB

To inspect locally stored data:

1. Open **Developer Tools**.
2. Navigate to **Application → IndexedDB**.
3. Expand the **worksphere-offline** database.
4. Select the required object store.

Useful stores to inspect include:

- `venues`
- `favorites`
- `searches`
- `pendingActions`

Checking these stores helps verify whether offline data has been stored correctly and whether queued actions are waiting to be synchronized.

---

# Background Sync

WorkSphere uses the **Background Sync API** to retry operations that could not be completed while the application was offline.

Instead of immediately discarding failed requests, they are stored locally and automatically retried when the browser detects that network connectivity has returned.

The current implementation supports the following sync events:

| Sync Tag         | Purpose                                              |
| ---------------- | ---------------------------------------------------- |
| `sync-crdt`      | Synchronizes queued collaborative editing updates.   |
| `sync-favorites` | Synchronizes pending favorite or unfavorite actions. |
| `sync-ratings`   | Synchronizes pending venue ratings.                  |

This process happens automatically without requiring additional user interaction.

---

# Offline Queue Workflow

When the application cannot reach the server, pending operations follow the workflow below.

```text
User Action
      │
      ▼
Store in IndexedDB
(pendingActions)
      │
      ▼
Background Sync Registered
      │
      ▼
Network Connection Restored
      │
      ▼
Service Worker Sync Event
      │
      ▼
API Request Retried
      │
      ▼
Queue Entry Removed
```

This approach helps prevent accidental data loss while maintaining a smooth user experience during temporary network interruptions.

---

# Verifying Background Sync

To confirm that Background Sync is working correctly:

1. Disconnect the device from the internet.
2. Perform an action that normally sends data to the server.
3. Open **Application → IndexedDB**.
4. Verify that a new entry appears inside the `pendingActions` object store.
5. Restore the network connection.
6. Wait for synchronization to complete.
7. Confirm that the queued entry has been removed after a successful request.

If queued actions remain in the database after reconnecting, verify that:

- the Service Worker is active,
- Background Sync is supported by the browser,
- no JavaScript errors appear in the console,
- the corresponding API endpoint is reachable.

---

# Common IndexedDB Issues

| Problem                            | Possible Cause                               | Recommended Action                                              |
| ---------------------------------- | -------------------------------------------- | --------------------------------------------------------------- |
| Database does not appear           | Service Worker has not initialized correctly | Refresh the application and verify Service Worker registration. |
| `pendingActions` remains populated | Synchronization failed                       | Check browser console and API responses.                        |
| Cached data is missing             | IndexedDB was cleared                        | Repeat the operation while online to recreate local data.       |
| Offline actions are not retried    | Background Sync unavailable                  | Verify browser support and Service Worker status.               |

---

# Offline Testing

Testing offline functionality before opening a pull request helps ensure that the Service Worker, cache, and Background Sync behave as expected.

## Testing in Google Chrome

1. Start the WorkSphere development server.
2. Open the application in Google Chrome.
3. Open **Developer Tools**.
4. Navigate to **Application → Service Workers** and verify that the Service Worker is registered.
5. Open **Application → Cache Storage** and confirm that the `worksphere-v2` cache has been created.
6. Open **Application → IndexedDB** and verify that the `worksphere-offline` database is available.
7. Switch to the **Network** tab.
8. Change the network profile to **Offline**.
9. Refresh the application.

Expected behavior:

- The application should display the offline page for navigation requests.
- Previously cached assets should continue to load.
- Requests requiring network connectivity should fail gracefully.

---

## Testing in Safari

Safari provides similar debugging tools for Service Workers and local storage.

1. Enable the **Develop** menu in Safari preferences.
2. Open **Develop → Show Web Inspector**.
3. Verify that the Service Worker is registered.
4. Inspect Cache Storage and IndexedDB.
5. Disable network connectivity.
6. Refresh the application.

Expected behavior should match the Chrome implementation.

---

# Troubleshooting

## Service Worker is not updating

Possible causes:

- Browser is still using an older Service Worker.
- Cached assets have not been cleared.
- The browser has not activated the latest Service Worker.

Recommended solution:

1. Open **Developer Tools → Application → Service Workers**.
2. Click **Unregister**.
3. Clear site data.
4. Reload the application.

---

## Cached assets are outdated

Possible causes:

- Browser cache still contains older resources.
- Cache version has not changed after modifying cached assets.

Recommended solution:

- Clear Cache Storage.
- Reload the application.
- Verify that the active cache is `worksphere-v2`.

---

## Offline page does not appear

Possible causes:

- Service Worker failed to register.
- Offline route is unavailable.
- Navigation request was not intercepted.

Recommended solution:

- Verify that `public/sw.js` is accessible.
- Confirm that `/offline` loads successfully while online.
- Check the browser console for Service Worker errors.

---

## Background Sync is not running

Possible causes:

- Browser does not support the Background Sync API.
- Service Worker is inactive.
- Sync registration failed.

Recommended solution:

- Verify that queued actions appear in the `pendingActions` object store.
- Reconnect to the network.
- Check the browser console for synchronization errors.

---

## IndexedDB data is missing

Possible causes:

- Site data has been cleared.
- The application has not yet written data locally.

Recommended solution:

- Repeat the operation while online.
- Confirm that the expected object stores exist.
- Verify that new entries are being created.

---

# PWA Push Notifications & Local Sync

Troubleshooting push notifications and service worker notification event routing during local development.

## 1. Local Testing & Mocking Push Notifications

Since push messages rely on browser vendor push servers (e.g. Google Cloud Messaging / Firebase Cloud Messaging for Chrome), testing outbound pushes locally without complete server infrastructure is done using **Chrome DevTools Mocking**:

1. Open **Chrome DevTools** (`F12`) and navigate to the **Application** tab.
2. Under the **Application** sidebar section, click **Service Workers**.
3. In the right panel, find the **Push** trigger control input field.
4. Input a mock payload (JSON string or raw text) and click the **Push** button.
5. Verify that the service worker intercepts the mock event and presents a visual notification.

### Payload Verification & VAPID Key Mismatch

- **VAPID Keys**: Ensure that `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (client) and `VAPID_PRIVATE_KEY` (server) match.
- **Payload Parsing**: The service worker expects push payloads to be JSON. If a push event payload is unparseable or empty, the notification will fail silently or show a generic fallback message. Check the service worker console logs by clicking **Inspect** under the registered service worker entry in DevTools.

---

## 2. Chrome Notification Flags & Browser Configuration

Local development domains (like `http://localhost:3000`) bypass some secure-context requirements, but system integrations or browser-level settings can still block push notifications.

### Chromium Flag Overrides

Access these experimental configurations directly in your address bar:

- **System Notifications (`chrome://flags/#enable-system-notifications`)**:
  If notifications are not appearing even though permissions are granted, try disabling system-level notification center delegation. This forces Chrome to render notifications internally instead of forwarding them to the OS notification center.
- **Notifications Authorization (`chrome://flags/#notifications-authorization-rules`)**:
  Manages how origins request permission. Toggle this to default or reset if the browser refuses to trigger permission prompts.
- **Insecure Context Bypass (`chrome://flags/#unsafely-treat-insecure-origin-as-secure`)**:
  If testing the PWA on your local network using an IP address (e.g. `http://192.168.1.5:3000`) instead of `localhost`, add the IP origin to this flag to allow Service Workers and Push API subscriptions.

---

## 3. Permission Requests & Status Flows

Verify that the notification permission flows are handled correctly in your components.

### Status Troubleshooting

To check the current permission status:

```javascript
Notification.permission;
```

- **`default`**: The user has not been prompted yet. Ensure that `Notification.requestPermission()` is triggered by a direct user action (like clicking a button) to prevent browsers from blocking silent prompts.
- **`granted`**: Push notifications and subscription requests are allowed.
- **`denied`**: The user has explicitly blocked notifications for this origin. **Crucial**: The browser will never prompt the user again if the status is denied. To reset, click the lock icon in the address bar next to the URL and toggle the Notification permission back to "Ask" or "Allow".

---

## 4. Cache & Service Worker Update Loops

When push notifications trigger background data syncs, service worker cache management must follow clean structures to avoid cache pollution.

- **Dynamic Cache Pollution**: Do not cache dynamic API responses (like `/api/venues` or `/api/chat`) inside the static asset cache (`worksphere-v2`). This causes stale responses to be served even when online.
- **Stale Lifecycle Updates**: If you update the service worker code (`public/sw.js`), browsers will not activate the new worker immediately if there are active tabs open. Enable **Update on reload** in the DevTools **Service Workers** tab to force the new service worker to install and activate instantly on every page refresh.

---

# Verification Checklist

Before submitting changes related to the PWA implementation, verify the following:

- [ ] Service Worker registers successfully.
- [ ] `manifest.json` loads without errors.
- [ ] Cache Storage contains the `worksphere-v2` cache.
- [ ] IndexedDB contains the `worksphere-offline` database.
- [ ] Required object stores are created successfully.
- [ ] Offline navigation displays the offline page.
- [ ] Cached assets remain available while offline.
- [ ] Pending actions are stored in IndexedDB when offline.
- [ ] Background Sync retries queued actions after reconnecting.
- [ ] No Service Worker or IndexedDB errors appear in the browser console.

---

# Additional Resources

For more information about the technologies used in WorkSphere, refer to the official documentation:

- Progressive Web Apps (PWA)
- Service Workers
- Cache Storage API
- IndexedDB API
- Background Sync API

These resources provide detailed implementation guidance beyond the scope of this troubleshooting guide.

---

# Conclusion

WorkSphere's PWA implementation combines Service Workers, Cache Storage, IndexedDB, and Background Sync to improve reliability during unstable or unavailable network conditions.

When troubleshooting, begin by verifying that the Service Worker is registered correctly, then inspect Cache Storage and IndexedDB before investigating synchronization behavior. Following the workflow described in this guide should resolve most development and testing issues related to offline functionality.
