# Redis HMR Singleton and Connection Reuse

This guide documents the Redis client lifecycle in `src/lib/redis.ts`.

## Why globalThis is used

Next.js development Hot Module Replacement (HMR) can re-evaluate modules. Module-scoped variables may be recreated during that process. WorkSphere stores its development Redis client on `globalThis.__workSphereRedis`, which survives module re-evaluation within the same Node.js runtime.

## Client lifecycle

- **Development:** `getRedis()` checks `globalThis.__workSphereRedis`. If absent, it creates an Upstash Redis client and stores it globally. Later calls reuse it.
- **Production:** `getRedis()` uses the module-scoped `redisInstance`, creating it once per loaded module.
- **Process boundaries:** Neither singleton is shared across separate Node.js processes, workers, containers, or machines. Restarting a process creates a new client.

## Environment configuration

Set both variables in local environment or deployment settings:

```env
UPSTASH_REDIS_REST_URL="https://your-database-endpoint.upstash.io"
UPSTASH_REDIS_REST_TOKEN="your_upstash_redis_token"
```

If either variable is missing or empty, `getRedis()` returns `null`. Restart the development server after changing environment variables. Never commit real credentials.

## Connection reuse and pooling

WorkSphere uses `@upstash/redis` over its REST endpoint. This is different from a direct TCP Redis client such as `ioredis`. Reusing the client avoids repeated initialization, but does not create a shared pool across application instances. Do not apply TCP pool settings for `ioredis` to this REST client. Transport-level HTTP connection reuse depends on the underlying runtime and client implementation.

## Troubleshooting

| Symptom | Possible cause | Recommended action |
| --- | --- | --- |
| `getRedis()` returns `null` | Missing environment variable | Configure both URL and token, then restart. |
| New client after restart | Previous process terminated | Expected; global state is process-local. |
| Multiple clients across workers | Independent worker memory | Expected; `globalThis` is not shared across processes. |
| HMR recreates client | Runtime restarted or guard changed | Check `src/lib/redis.ts` and server lifecycle. |
| Redis requests fail | Invalid credentials, endpoint, or network | Verify URL, token, connectivity, and Upstash status. |

## Maintenance

- Keep client creation centralized in `src/lib/redis.ts`.
- Use `getRedis()` to obtain the configured client.
- Preserve the development `globalThis` guard.
- Do not store credentials on `globalThis`.
- Update this guide if the provider or client transport changes.

Related implementation: `src/lib/redis.ts`.
