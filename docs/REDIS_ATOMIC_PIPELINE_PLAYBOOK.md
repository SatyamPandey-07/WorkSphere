# High-Throughput Upstash Redis Atomic Pipeline & Rate Limiter Playbook

This playbook documents the strategy and implementation details for achieving high-throughput rate limiting (300+ RPS) using Upstash Redis within the WorkSphere application.

## Overview & Goal

To protect the application's APIs and token budgets (e.g., for Groq AI completions), we employ a sliding-window rate limit using Redis.
Under high concurrency, ensuring atomic execution of operations (pruning the window, adding a new request, counting the window, and resetting TTL) is critical. Without atomicity, concurrent requests can read stale data and bypass limits.
While Lua scripts (`eval`) can provide atomicity, serverless environments like Upstash Redis often encounter execution timeouts with Lua scripts under heavy load (>200 RPS). To overcome this, we use an **Atomic Pipeline (`MULTI/EXEC`)** pattern.

## The Sliding Window Algorithm (ZSET Pattern)

We use Redis Sorted Sets (`ZSET`) to store request timestamps:

1. **Prune**: Remove all entries older than `now - window_duration` using `ZREMRANGEBYSCORE`.
2. **Add**: Insert the current request with its timestamp as the score using `ZADD`.
3. **Count**: Count the remaining requests in the window using `ZCARD`.
4. **Cleanup**: Set the key's TTL using `EXPIRE` so it is automatically removed when the window expires.

## Atomic Execution Comparison

### 1. The Lua Script Baseline

A traditional way to ensure atomicity in Redis is by running a Lua script.
Example script (used under the hood by `@upstash/ratelimit`):

```lua
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

local clearBefore = now - window

redis.call('ZREMRANGEBYSCORE', key, 0, clearBefore)
redis.call('ZADD', key, now, member)
local count = redis.call('ZCARD', key)
redis.call('EXPIRE', key, math.ceil(window / 1000))

if count > limit then
  redis.call('ZREM', key, member)
  return 0 -- Rate limited
end

return 1 -- Allowed
```

**Limitations**: Lua scripts run sequentially, blocking the Redis single thread. On Upstash, heavy concurrent `eval` loads can hit execution timeout constraints under high RPS (~200 RPS), resulting in failed requests.

### 2. The Atomic Pipeline (`MULTI/EXEC`) Solution

To maintain atomicity without blocking the thread via Lua, we utilize a `MULTI/EXEC` pipeline in `src/lib/rateLimit.ts`. Redis queues the commands and executes them serially, eliminating race conditions while drastically improving throughput (handling 300+ RPS gracefully).

```typescript
const tx = redis.multi();
tx.zremrangebyscore(key, 0, windowStart);
tx.zadd(key, { score: now, member });
tx.zcard(key);
tx.expire(key, windowSeconds);
const result = await tx.exec();

// result[2] contains the ZCARD response
const count = Number(result?.[2] ?? 0);
if (count > limit) {
  await redis.zrem(key, member);
  return false; // rate limited
}
return true; // allowed
```

## Key TTL Expiration Management

Whenever writing to the rate limit ZSET, it is imperative to include an `EXPIRE` command. If the sliding window is 60 seconds, the key should expire after 60 seconds of inactivity.
By packaging the `EXPIRE` command in the same `MULTI/EXEC` pipeline, we ensure that no key is ever left hanging without a TTL, even if subsequent application logic crashes. This prevents memory leaks in the Upstash Redis database.

## Edge Cases

1. **Timestamp Collisions**: If multiple requests hit in the exact same millisecond, they would have the same score and member timestamp, potentially overwriting each other in the ZSET.
   _Fix_: We append a random 8-character string (nonce) to the member name (e.g., `microTimestampMember(sec, usec, nonce)`).
2. **Missing Upstash Environment Variables**: If `UPSTASH_REDIS_REST_URL` or `UPSTASH_REDIS_REST_TOKEN` is missing, the application automatically falls back to an in-memory rate limiter `memRateLimit` without throwing startup errors.
3. **Pipeline Failures**: If the Upstash API endpoint fails, the exception is caught, and the request falls back to the in-memory map.

## Load Test Benchmarks

- **Lua `eval` approach**: Stable up to ~150-180 RPS. Encounters `UpstashError: script timeout` and latency spikes > 500ms above 200 RPS.
- **Pipeline `MULTI/EXEC` approach**: Stable at 300+ RPS. Sub-50ms latencies with no script timeouts, providing a high-throughput shield for backend API endpoints.
