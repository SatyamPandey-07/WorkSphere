# IndexedDB Offline Storage Architecture, Quota Management & Eviction Policies

This technical architecture manual documents WorkSphere's client-side offline persistence layer, detailed across [`src/lib/offline/storageStats.ts`](file:///c:/Users/admin/Desktop/workfere/src/lib/offline/storageStats.ts), [`src/lib/offline/db.ts`](file:///c:/Users/admin/Desktop/workfere/src/lib/offline/db.ts), and [`src/lib/offline/venueCache.ts`](file:///c:/Users/admin/Desktop/workfere/src/lib/offline/venueCache.ts). It details IndexedDB schema stores, StorageManager browser quota estimation, and multi-tier LRU cache eviction strategies.

---

## 1. Executive Summary & Offline Storage Architecture

Digital nomads and remote workers operating in transit, airplanes, or venues with unstable connectivity rely on WorkSphere’s offline-first architecture. WorkSphere unifies **IndexedDB (`worksphere-offline`)**, **Cache Storage API**, and **StorageManager** to provide transparent offline access to:
1. **Workspaces & Venues:** Complete metadata, amenities, coordinates, and interactive floor plans.
2. **Bookings & Draft Reservations:** Optimistic local reservations and receipt PDF exports.
3. **User Favorites & Tags:** Pinned workspaces and personalized collections.
4. **Offline Telemetry & Queued Mutations:** Action queues with FIFO replay and conflict resolution upon reconnection.

```mermaid
flowchart TD
    App[WorkSphere Frontend / PWA] --> StorageRouter{Online or Offline?}
    
    StorageRouter -->|Read Request| CachePriority[Cache Priority Hierarchy]
    CachePriority --> MemoryCache[In-Memory React / Zustand State]
    MemoryCache --> IDB[IndexedDB worksphere-offline v8]
    IDB --> CacheAPI[Cache Storage API (Assets & Floor Plans)]
    
    StorageRouter -->|Mutation while Offline| SyncQueue[Queue into pending_sync_queue / pendingActions]
    
    subgraph StorageGovernance [StorageManager & Quota Governance]
        IDB --> QuotaMonitor[navigator.storage.estimate()]
        QuotaMonitor --> UsageCalc[Usage % = usageBytes / quotaBytes]
        UsageCalc --> EvictionTrigger{Usage >= 80% or QuotaExceededError?}
        EvictionTrigger -->|Yes| LRUEvictor[venueCache.ts: Prune Stale & Unpinned Records]
        EvictionTrigger -->|No| NormalState[Healthy Storage State]
    end
```

---

## 2. IndexedDB Schema & Object Stores (`worksphere-offline`)

The central offline database is initialized via [`initOfflineDB()`](file:///c:/Users/admin/Desktop/workfere/src/lib/offline/db.ts) under database name `worksphere-offline` (current schema version: `8`).

### 2.1 Core Object Stores Overview

| Object Store Name | Key Path | Primary Indexes | Typical Record Size | Estimated Capacity / Target Budget |
| :--- | :--- | :--- | :---: | :---: |
| **`venues`** | `id` (string) | `type`, `savedAt` | $15\text{ KB} - 60\text{ KB}$ | $50\text{ MB} - 150\text{ MB}$ (Up to 1,000 venues) |
| **`favorites`** | `id` (string) | `savedAt` | $5\text{ KB} - 20\text{ KB}$ | $10\text{ MB}$ (Pinned indefinitely) |
| **`recentlyViewedVenues`** | `id` (string) | `viewedAt` | $20\text{ KB} - 80\text{ KB}$ | Cap: 20 venues ($1.5\text{ MB}$) |
| **`pending_sync_queue`** | `id` (string) | `domain`, `status`, `timestamp` | $2\text{ KB} - 8\text{ KB}$ | Unbounded FIFO queue ($5\text{ MB}$) |
| **`pendingActions`** | `id` (autoIncrement) | N/A | $1\text{ KB} - 5\text{ KB}$ | Dynamic replay queue |
| **`receiptExports`** | `bookingId` (string) | `status`, `createdAt` | $100\text{ KB} - 450\text{ KB}$ | $25\text{ MB}$ (PDF receipt blobs) |
| **`notes_cache`** | `folderId` (string) | N/A | $10\text{ KB} - 100\text{ KB}$ | $20\text{ MB}$ (CRDT / Markdown notes) |
| **`pendingReviews`** | `id` (string) | `venueId`, `status`, `createdAt` | $2\text{ KB} - 10\text{ KB}$ | Pending offline review submissions |
| **`searches`** | `query` (string) | `timestamp` | $5\text{ KB} - 30\text{ KB}$ | Recent search cache |

### 2.2 Store Details

1. **`venues` Store:**
   - Stores full `OfflineVenue` documents, including amenity tags, geolocation, and embedded vector floor plan models.
   - Floor plans contribute $\sim 85\%$ of record byte weight.
2. **`favorites` Store:**
   - User-favorited workspaces marked with `isFavorite: true` and `isPinned: true`.
   - Protected from automatic LRU eviction pruning.
3. **`receiptExports` Store:**
   - Caches completed reservation confirmation receipts and downloaded invoice PDFs so travelers can present them offline to venue hosts.
4. **`pending_sync_queue` (Offline Telemetry & Mutations):**
   - Stores queued mutations (check-ins, rating submissions, amenity votes) when the device lacks internet.
   - Includes retry counts, exponential backoff timers, and idempotency keys.

---

## 3. StorageManager Quota Estimation (`storageStats.ts`)

WorkSphere actively tracks storage allocation using the standard Web API `navigator.storage.estimate()`:

```typescript
export async function getOfflineStorageStats(): Promise<OfflineStorageStats> {
  if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
    const { usage, quota } = await navigator.storage.estimate();
    const usageBytes = usage ?? 0;
    const quotaBytes = quota ?? 0;
    const usagePercent = quotaBytes > 0 ? (usageBytes / quotaBytes) * 100 : 0;
    // ...
  }
}
```

### 3.1 Browser Storage Quota Allocation Rules

Modern browser engines allocate client storage dynamically based on available physical disk capacity and origin privilege:

| Browser / Platform | Maximum Origin Quota Allocation | Eviction Behavior Under Low Disk Space |
| :--- | :--- | :--- |
| **Chromium (Chrome / Edge)** | Up to $60\%$ of total free physical disk space. Shared across all origins ($80\%$ pool). | Evicts Least-Recently-Used origin when free disk space falls below thresholds. |
| **Firefox (Gecko)** | Up to $50\%$ of free disk space, with an individual origin cap of $10\text{ GB}$. | Groups origins into temporary storage pools; prompts user for persistent storage permission. |
| **Safari / WebKit (iOS & macOS)** | Fixed tiered quota starting at $1\text{ GB}$; increments in prompts ($200\text{ MB}$ jumps). | **Strict 7-Day Inactivity Cap:** If user does not visit within 7 days, client data may be purged. |
| **Safari Private Browsing** | IndexedDB throws `SecurityError` or times out ($3{,}000\text{ ms}$). | Fallback to in-memory non-persistent storage. |

### 3.2 Proportional Metric Calculation
- **`usagePercent`:** Total bytes consumed by origin $\div$ granted browser quota $\times 100$.
- **`floorPlanPercentOfUsage`:** Exact byte weight of floor plans $\div$ total origin usage $\times 100$.
- **`floorPlanPercentOfQuota`:** Floor plan footprint relative to total available quota.

---

## 4. Cache Eviction & Quota Recovery Strategies

To prevent `QuotaExceededError` exceptions from breaking the application, WorkSphere applies a multi-stage proactive and reactive eviction protocol.

```mermaid
flowchart TD
    WriteAttempt[Write Venue / Floor Plan to IDB] --> QuotaCatch{Does Write Succeed?}
    
    QuotaCatch -->|Success| Complete[Transaction Committed]
    
    QuotaCatch -->|Fails with QuotaExceededError| ReactiveRecovery[Reactive Quota Recovery]
    
    subgraph EvictionPipeline [Multi-Tier Eviction Pipeline]
        ReactiveRecovery --> PruneStale[Phase 1: Prune Stale Floor Plans > 30 Days]
        PruneStale --> CheckPinned{Is Venue Pinned or Favorite?}
        CheckPinned -->|Yes| Protect[Retain in Database]
        CheckPinned -->|No| EvictLRU[Phase 2: Purge Least-Recently-Used (LRU)]
        
        EvictLRU --> CheckCap[Phase 3: Enforce MAX_RECENTLY_VIEWED_IDB = 20 Cap]
        CheckCap --> RetryWrite[Retry Transaction]
    end
    
    RetryWrite --> Complete
```

### 4.1 Eviction Tiers

1. **Age-Based Stale Pruning (`STALE_FLOOR_PLAN_AGE_MS = 30 days`):**
   - Floor plans unaccessed for $> 30\text{ days}$ are identified via `lastAccessedAt`.
   - Their high-byte floor plan vector objects are discarded while retaining core metadata.
2. **Pinned & Favorite Protection:**
   - Records marked `isPinned: true` or `isFavorite: true` are immune to automatic eviction.
3. **Strict LRU Capacity Capping (`MAX_RECENTLY_VIEWED_IDB = 20`):**
   - The `recentlyViewedVenues` store maintains a strict ceiling of 20 items.
   - Any insertion past 20 purges the oldest record (`viewedAt` ascending).
4. **Persistent Storage Request:**
   - WorkSphere prompts the browser for `navigator.storage.persist()` on installation to prevent background OS memory reclamation:

```typescript
if (navigator.storage && navigator.storage.persist) {
  const isPersisted = await navigator.storage.persist();
  console.log(`Persistent storage granted: ${isPersisted}`);
}
```

---

## 5. Error Handling & Privacy Mode Fallbacks

- **Safari Private Browsing:** IndexedDB operations block or time out after $3\text{ seconds}$. The subsystem detects `SecurityError` or open timeouts, alerts the user, and gracefully falls back to session memory.
- **Corrupted Storage Stats Recovery:** [`parseOfflineStorageStats()`](file:///c:/Users/admin/Desktop/workfere/src/lib/offline/storageStats.ts) catches `SyntaxError` on malformed or partially written JSON, logging diagnostics and restoring default zeroed metrics.
- **Cross-Tab Database Version Changes:** Listens to `onversionchange` and gracefully calls `db.close()` to prevent blocking database upgrades initiated by active background Service Workers or adjacent tabs.
