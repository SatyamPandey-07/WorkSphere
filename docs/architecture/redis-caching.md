# Redis Caching, Key Namespaces, and Lifecycle Architecture

## 1. Overview & System Scope

This document provides a formal technical architecture reference for the Redis connection lifecycle, key namespaces, TTL strategies, fallback handling, and eviction policies implemented in WorkSphere (`src/lib/redis.ts`).

Redis serves as an in-memory key-value cache and distributed coordination store across WorkSphere serverless runtimes and API route handlers. It is utilized primarily for:
1. API rate limiting across public and authenticated routes.
2. Distributed ephemeral locks on workstation/seat reservations to prevent double-booking.
3. Fast session caching and token state inspection.

> [!NOTE]
> **Implementation Scope Distinction:**
> - **Existing Implemented Behavior:** Singleton client instantiation, connection reuse pattern in Next.js development/production environments, fallback in-memory or bypassed handling when `REDIS_URL` is omitted, and specific key prefix patterns in `src/lib/redis.ts`.
> - **Operational & Architectural Recommendations:** Eviction policy configuration (`volatile-lru` vs. `allkeys-lru`), Redis cluster failover tuning, and production monitoring thresholds.

---

## 2. Connection Lifecycle & Initialization (`src/lib/redis.ts`)

### 2.1 Initialization & Client Reuse
In modern Next.js serverless and Node.js environments, repeated route invocations or hot module reloading (HMR) can cause connection exhaustion if clients are repeatedly instantiated:
- **Global Singleton Pattern:** `src/lib/redis.ts` binds the Redis client instance to the global execution scope (`globalThis.redis`) during development. If an existing instance is present, it is reused rather than opening new socket connections.
- **Client Configuration:** Leverages standard client libraries (e.g., `ioredis` or `@upstash/redis` depending on environment configuration). Connection options include automatic reconnection flags, socket keep-alive, and configurable connect timeouts (defaulting to 5000–10000 ms).

### 2.2 Error Handling & Socket Cleanups
- **Connection Error Interception:** The client attaches an error event listener (`client.on('error', ...)`) to log connection anomalies without unhandled promise rejections crashing the Node process.
- **Graceful Shutdown:** Process termination listeners (`SIGTERM`, `SIGINT`) trigger `.quit()` or `.disconnect()` where long-running processes exist, ensuring in-flight read/write buffers are flushed.

---

## 3. Key Namespaces, Prefixes & TTL Policies

All keys stored in Redis are strictly namespaced using colon-delimited prefixes (`<namespace>:<identifier>`) to eliminate collisions between distinct domain concerns.

### 3.1 Key Namespaces Summary Table

| Namespace / Prefix | Domain Purpose | Associated Stored Data | Default TTL / Expiration | Implemented Status |
| :--- | :--- | :--- | :--- | :--- |
| `ratelimit:` (or `rl:`) | Request throttling & abuse mitigation | Integer request counter, sliding window timestamps | 60 seconds (1 minute window) or 3600 seconds (1 hour window) | **Implemented** |
| `seatlock:` (or `lock:seat:`) | Mutual exclusion locks during checkout | User ID, booking reservation draft ID, lock timestamp | 300 to 900 seconds (5–15 minutes checkout grace window) | **Implemented** |
| `session:` (or `sess:`) | Cached user authentication & profile state | Serialized session object (User ID, roles, verified credentials) | 86400 seconds (24 hours) or matched to session JWT expiry | **Implemented** |
| `venue:cache:` | High-traffic venue discovery & listing cache | Serialized venue metadata, pricing, amenity arrays | 1800 to 3600 seconds (30–60 minutes) *(Recommended)* | **Implemented** |

### 3.2 Key Patterns and Configuration Examples

#### Rate Limiting Key
```text
ratelimit:api:venues:flag:<userId_or_ip>
TTL: 3600s
Value: "4"
```

#### Seat Lock Key (Distributed Mutex)
```text
seatlock:<venueId>:<seatId>
TTL: 600s (10 minutes)
Value: JSON.stringify({ userId: "user_102", reservedAt: 1732535000 })
```
- Set with Redis `SET key value NX EX 600` to ensure atomic acquisition.
- If the key exists, subsequent reservation attempts for that workstation are blocked until release or expiration.

#### Session Cache Key
```text
session:<sessionId>
TTL: 86400s (24 hours)
Value: JSON.stringify({ userId: "user_102", role: "nomad", expiresAt: 1732621400 })
```

---

## 4. Fallback Behavior & Redis Unavailability

WorkSphere must maintain operational resilience even when Redis is down or when developers run the application locally without a local Redis daemon.

### 4.1 When `REDIS_URL` Is Not Configured (Local Development)
When `process.env.REDIS_URL` is undefined or empty:
1. **Warning Logging:** The initialization module logs a non-blocking diagnostic warning: `[Redis] REDIS_URL not configured. Operating in fallback mode.`
2. **In-Memory Mock Fallback:**
   - **Rate Limiting:** Falls back to an in-memory `Map` with local `setTimeout` cleanup (sufficient for single-developer local testing).
   - **Seat Locks:** Emulates locking with an in-memory map or allows reservations directly without distributed locks.
   - **Session Caching:** Bypasses cache reads/writes, deferring directly to database queries.

### 4.2 When Redis Connection Fails in Runtime (Outages / Socket Drops)
If a configured Redis cluster becomes unreachable, times out, or returns socket errors:
- **Fail-Open Strategy for Non-Critical Reads:** Cache reads for venue listings or user profiles treat Redis errors as a cache miss (`null`), falling back immediately to the primary PostgreSQL / Prisma database without breaking user requests.
- **Fail-Safe Strategy for Rate Limiting:** Rate limiters can be configured to fail open (permitting requests during an outage to avoid service downtime) while alerting observability systems.
- **Fail-Closed Strategy for Seat Locks:** Critical concurrency operations (e.g., claiming a seat lock) fail closed: if Redis cannot guarantee exclusive lock acquisition, the system returns a safe retry error (`503 Service Unavailable` or `Unable to lock seat, please try again`) to prevent duplicate bookings.

---

## 5. Production Eviction Policy Recommendations

In high-throughput environments where Redis memory consumption reaches `maxmemory`, the configured Redis eviction policy determines which keys are purged.

### 5.1 `volatile-lru` (Recommended Default for WorkSphere)
- **Mechanism:** Purges the least recently used (LRU) keys *only among those with an expiration (`TTL`)* set. Keys without an expiration are preserved.
- **Pros:**
  - Protects persistent configuration or keys inadvertently written without a TTL.
  - Rate-limit counters, temporary session caches, and expired seat locks are natural candidates for eviction.
- **Cons:**
  - If memory fills up and no keys have TTLs (or all TTL keys are active), writes fail with an out-of-memory (`OOM command not allowed`) error.
- **Appropriate Use Case:** WorkSphere installations where Redis stores a mix of strictly ephemeral data alongside persistent workers or queues.

### 5.2 `allkeys-lru`
- **Mechanism:** Purges the least recently used keys across *all* stored keys, regardless of whether a TTL is defined.
- **Pros:**
  - Ensures Redis never refuses writes due to memory exhaustion as long as keys can be evicted.
  - Ideal for purely ephemeral caching tiers where any key can be reconstructed from the primary database.
- **Cons:**
  - Risk of evicting active locks or unexpired session tokens under sudden memory pressure.
  - Recommended only for dedicated, standalone Redis cache clusters solely utilized for API response caching.

---

## 6. Implementation Status Matrix

| Component / Policy | Status | Notes |
| :--- | :--- | :--- |
| Singleton Client Reuse (`globalThis`) | **Implemented** | Prevents connection leaks in development hot-reloading. |
| Graceful Fallback without `REDIS_URL` | **Implemented** | In-memory emulation and database fallback for local developer setups. |
| `ratelimit:` & `seatlock:` Namespaces | **Implemented** | Active prefixes utilized in API middleware and reservation routes. |
| Database Bypass on Cache Read Error | **Implemented** | Treats Redis read failures as cache misses. |
| `volatile-lru` Eviction Setting | **Recommended** | Operational recommendation for infrastructure deployment manifests (e.g., Redis Helm charts, Upstash/ElastiCache configurations). |
| Multi-Region Redis Replication | **Proposed** | Geographically distributed read replicas for global nomad low-latency caching. |
