# Architecture Documentation

Architecture decisions, implementation notes, and system-level design references for WorkSphere.

## Reservation and reliability

- [Atomic desk reservation countdown and Redis keyspace](./atomic-desk-reservation-countdown-redis-keyspace.md)
- [Distributed locks and fencing](./distributed-locks-and-fencing.md)
- [Redlock lease fencing token protocol](./REDLOCK_FENCING_TOKENS.md)
- [Seat hold lock architecture](./seat-hold-lock-architecture.md)
- [Seat hold Redlock architecture](./seat-hold-lock-redlock-architecture.md)
- [Rate limiting strategies](./rate-limiting-strategies.md)
- [Sliding-window rate limiting](./sliding-window-rate-limiting.md)

## Application architecture

- [ADR-004: Dual PostGIS spatial and trigram venue search](./ADR-004-spatial-phonetic-venue-search.md)
- [Middleware routing](./middleware-routing.md)
- [Multi-region sync](./multi-region-sync.md)
- [Offline sync flow](./offline-sync-flow.md)
- [Reminder cron pipeline](./reminder-cron-pipeline.md)

## Database and cache operations

- [Redis keyspace and TTL invalidation](../database/REDIS_KEYSPACE.md)
