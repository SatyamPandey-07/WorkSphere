# Offline-First IndexedDB Bookmark Sync

## Overview

WorkSphere provides an offline-first storage layer built on **IndexedDB** to improve reliability when network connectivity is unavailable. Offline storage allows users to continue interacting with workspace data while disconnected and synchronizes pending changes once connectivity is restored.

The implementation is centered around `src/lib/offlineStorage.ts` and combines:

- IndexedDB for persistent browser storage
- Yjs for conflict-resistant state synchronization
- Web Locks API coordination
- Background synchronization support for queued operations

The storage layer is designed to reduce data loss, improve user experience during intermittent connectivity, and support eventual synchronization with server-side APIs.

---

# Architecture

The offline storage system consists of several cooperating components.

```
User Action
      │
      ▼
Application Logic
      │
      ▼
offlineStorage.ts
      │
      ├─────────────► IndexedDB
      │                  │
      │                  ├── venues
      │                  ├── favorites
      │                  ├── searches
      │                  ├── pendingActions
      │                  ├── pendingFavorites
      │                  ├── receiptExports
      │                  └── preference_rankings
      │
      ▼
Yjs Document
      │
      ▼
Queued CRDT Updates
      │
      ▼
Background Synchronization
```

The offline layer persists application state locally while queuing synchronization work for later processing.

---

# IndexedDB Configuration

Database Name

```
worksphere-offline
```

Database Version

```
6
```

The database is initialized through `initOfflineDB()`.

A singleton database connection is reused throughout the application and is automatically closed when the browser unloads.

---

# Database Initialization

During initialization the storage layer:

- Opens the IndexedDB database.
- Handles blocked upgrade events.
- Handles database version upgrades.
- Reuses an existing connection whenever possible.
- Closes the database during browser unload.
- Reopens the connection after version changes.

If IndexedDB cannot be accessed because of Safari Private Browsing restrictions, the application displays a warning informing the user that offline storage is unavailable.

---

# Object Stores

## venues

Primary Key

```
id
```

Indexes

- type
- savedAt

Purpose

Stores offline venue information for later retrieval.

---

## favorites

Primary Key

```
id
```

Indexes

- savedAt

Purpose

Stores bookmarked venues available while offline.

---

## searches

Primary Key

```
query
```

Indexes

- timestamp

Purpose

Caches previous search results for offline access.

---

## pendingActions

Primary Key

Auto Increment ID

Purpose

Stores queued operations that will be synchronized later.

---

## receiptExports

Primary Key

```
bookingId
```

Indexes

- status
- createdAt

Purpose

Stores offline receipt export requests.

---

## pendingFavorites

Primary Key

```
id
```

Purpose

Stores favorite updates waiting to be synchronized.

---

## preference_rankings

Primary Key

```
id
```

Purpose

Caches preference ranking information for offline use.

---

# Venue Storage

Offline venues are represented using the `OfflineVenue` interface.

Important fields include:

- id
- name
- latitude
- longitude
- location
- category
- address
- rating
- amenities
- savedAt

When a venue is stored, the storage layer automatically records the current timestamp in `savedAt`.

---

# IndexedDB Access

All database operations are executed through the shared Web Lock wrapper.

This prevents concurrent modifications from multiple browser tabs and serializes access to shared offline data.

Operations include:

- Save venue
- Retrieve venue
- Retrieve all venues

---

# Yjs Integration

The offline layer creates a shared Yjs document.

```
userDoc
```

The document currently exposes shared maps including:

- favorites
- ratings

Whenever the Yjs document emits an update event, the generated CRDT update is automatically queued for synchronization.

Errors while queueing updates are logged to the console without interrupting the application.

---

# Connection Lifecycle

The database connection follows a singleton lifecycle.

Initialization

↓

Reuse existing connection

↓

Respond to version upgrades

↓

Close on browser unload

This avoids repeatedly opening IndexedDB connections during normal application usage.

---

# Error Handling

The storage layer includes handling for:

- blocked database upgrades
- failed database initialization
- IndexedDB security errors
- browser private browsing restrictions
- failed CRDT queue operations

Errors are logged to the browser console to simplify debugging.

---

# Offline Workflow

Typical workflow:

1. User performs an action.
2. Data is written into IndexedDB.
3. Yjs records collaborative state updates.
4. CRDT updates are queued.
5. Pending synchronization can later process queued updates.

---

# Manual Testing

1. Launch WorkSphere.
2. Open browser developer tools.
3. Navigate to Application → IndexedDB.
4. Verify that the `worksphere-offline` database is created.
5. Save several venues while online.
6. Confirm entries appear inside the `venues` object store.
7. Disable network connectivity.
8. Continue interacting with offline-supported features.
9. Confirm IndexedDB contents continue updating.
10. Re-enable network connectivity.
11. Verify that queued synchronization resumes without database errors.

---

# Troubleshooting

## Database does not initialize

Possible causes:

- Browser blocks IndexedDB.
- Private Browsing restrictions.
- Version upgrade conflicts.

---

## Database upgrade blocked

Another browser tab may still hold an open database connection.

Close other tabs and reload the application.

---

## CRDT update queue errors

Failures during CRDT queueing are logged through the browser console.

Review console output for synchronization failures before investigating higher-level synchronization logic.

---

# Related Files

- `src/lib/offlineStorage.ts`
- `src/lib/webLock.ts`
- `src/hooks/useOfflineSync.ts`
- `src/hooks/useFavorites.ts`
