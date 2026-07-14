# Background Sync Debugging Guide

## Overview

Background Sync allows WorkSphere to temporarily store supported requests while the user is offline or experiencing an unstable network connection. Instead of failing immediately, these requests are queued locally and automatically retried by the Service Worker when connectivity is restored.

This guide explains how to simulate Background Sync during local development, inspect queued data, monitor Service Worker activity, and troubleshoot common synchronization issues.

---

# Prerequisites

Before testing Background Sync, verify the following:

- The WorkSphere application is running locally.
- The Service Worker has been successfully registered.
- Google Chrome (or another browser with Background Sync support) is being used.
- Chrome DevTools are available.
- The browser is not blocking Service Worker registration.

Checking these prerequisites first helps eliminate common setup issues before debugging synchronization behavior.

---

# Simulating Background Sync

## Step 1 – Launch the application

Start the local development server and open the application in Google Chrome.

## Step 2 – Open Chrome DevTools

Navigate to:

Confirm that the Service Worker is:

- Registered
- Activated
- Running

## Step 3 – Simulate Offline Mode

Open the **Network** tab and enable:

Offline

## Step 4 – Generate an Offline Request

Perform an action that normally sends data to the backend, such as:

- Creating a review
- Making a booking
- Updating user information

The request should be queued locally instead of being sent immediately.

## Step 5 – Restore Connectivity

Disable **Offline** mode and reconnect to the network.

If your browser exposes Background Sync controls, trigger a sync event from the **Service Workers** panel. Otherwise, restoring connectivity should automatically allow the Service Worker to retry queued requests.

A successful synchronization should process pending requests and clear them from the local queue.

---

# Inspecting Queued Requests in IndexedDB

Background Sync stores pending operations inside the browser until they can be synchronized with the server.

Open Chrome DevTools and navigate to:


Verify the following:

- Offline requests are added to the queue.
- Stored data matches the original request payload.
- Duplicate entries are not created after retries.
- Queued records are removed after successful synchronization.

If requests remain in IndexedDB after the network is restored, inspect the Service Worker logs and backend responses to identify retry failures.

---

# Monitoring Service Worker Logs

Service Worker logs provide useful information about the Background Sync lifecycle.

Open:


Look for log messages related to:

- Service Worker registration
- Installation and activation
- Background Sync registration
- Sync event execution
- Queue processing
- Successful synchronization
- Retry failures or exceptions

For more detailed debugging, open:


A typical synchronization sequence may look similar to:

```text
Service Worker registered
Background Sync registered
Sync event received
Processing queued requests...
Synchronization completed
Queue cleared

---

# Common Troubleshooting Scenarios

## Background Sync Never Executes

Possible reasons include:

- The Service Worker is not active.
- The browser does not support the Background Sync API.
- No requests were queued while offline.
- Background Sync registration failed.

Verify that the Service Worker is registered correctly and that offline requests are being stored before expecting synchronization to occur.

---

## Requests Remain in IndexedDB

If queued requests are never removed, check the following:

- Network connectivity has been restored.
- The target API endpoint is reachable.
- The server accepts the queued request.
- The Service Worker completes queue processing without errors.

Inspect the browser console and Service Worker logs for additional details.

---

## Service Worker Changes Are Not Applied

If code changes do not appear after updating the Service Worker:

- Perform a hard refresh (`Ctrl + Shift + R`).
- Unregister the existing Service Worker.
- Clear Site Data from DevTools.
- Restart the development server.
- Reload the application.

---

## Synchronization Completes but the UI Does Not Update

If synchronization succeeds but the interface still shows stale data:

- Verify that the backend accepted the request.
- Refresh cached data if required.
- Confirm that the application state updates after synchronization.
- Check for client-side caching issues.

---

# Validation Checklist

Use the following checklist to confirm that Background Sync is working correctly:

- ✅ Service Worker is registered and active.
- ✅ Offline requests are successfully queued.
- ✅ IndexedDB contains the expected pending records.
- ✅ Background Sync is triggered after connectivity returns.
- ✅ Queued entries are removed after successful synchronization.
- ✅ The application reflects synchronized data without requiring manual intervention.

Completing each of these checks helps verify the entire offline synchronization workflow.

---

# Related Source Files

The following files are related to WorkSphere's offline synchronization implementation:

- `src/hooks/usePWA.tsx`
- `src/lib/offlineStorage.ts`

These files are responsible for Service Worker registration, offline storage, queue management, and Background Sync behavior.

---

# Useful Chrome DevTools Panels

The following DevTools panels are commonly used while debugging Background Sync:

- **Application → Service Workers** – Verify registration and inspect Service Worker execution.
- **Application → IndexedDB** – Inspect queued offline requests.
- **Network** – Simulate offline and online conditions.
- **Console** – View application and Service Worker logs.

Using these tools together provides a complete workflow for testing, validating, and troubleshooting Background Sync during local development.