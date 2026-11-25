# Prisma Database Aggregate Query Patterns for User Analytics

## Overview & Motivation

In high-traffic endpoints such as `/api/analytics` and `/api/venues/metrics`, querying full table datasets into Node.js application memory (e.g. via `prisma.booking.findMany()`) causes severe Node.js V8 heap memory bloat, high garbage collection pauses, and slow query latency.

To ensure constant memory overhead ($O(1)$ Node.js heap memory usage) and optimal query performance, all analytical queries must be delegated to PostgreSQL database engine aggregates using native Prisma features:
- `prisma.<model>.count`
- `prisma.<model>.groupBy`
- `prisma.<model>.aggregate` (e.g. `_avg`, `_sum`, `_min`, `_max`)

---

## Aggregation Patterns

### 1. Fast Row Counting with `count`
Instead of fetching models or relations to check size:

```typescript
// Count venue reviews matching filters
const verifiedReviewCount = await prisma.venueRating.count({
  where: {
    venueId,
    verifiedVisit: true,
  },
});
```

### 2. Analytical Grouping with `groupBy`
For dimensional metrics (e.g., breakdown of bookings by status, or seat reservation counts by date):

```typescript
// Group bookings by status and calculate summary statistics
const bookingMetrics = await prisma.booking.groupBy({
  by: ["status"],
  where: {
    userId,
    createdAt: {
      gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // last 30 days
    },
  },
  _count: {
    _all: true,
  },
  _sum: {
    totalAmount: true,
  },
});

// Result format:
// [
//   { status: 'CONFIRMED', _count: { _all: 12 }, _sum: { totalAmount: 480 } },
//   { status: 'CANCELLED', _count: { _all: 2 },  _sum: { totalAmount: 80 } }
// ]
```

### 3. Aggregating Numeric Averages and Extremes
Calculate average WiFi speeds or noise ratings directly in SQL:

```typescript
const telemetrySummary = await prisma.speedtest.aggregate({
  where: { venueId },
  _avg: {
    downloadSpeed: true,
    uploadSpeed: true,
    ping: true,
  },
  _max: {
    downloadSpeed: true,
  },
  _count: {
    _all: true,
  },
});
```

---

## Parallel Execution with `Promise.all`

To minimize database connection hold time and reduce API response latency, independent analytical queries must be executed concurrently rather than serially:

```typescript
export async function getUserAnalytics(userId: string) {
  // Execute aggregates concurrently in a single round-trip pool window
  const [totalBookings, statusBreakdown, verifiedRatingsCount, activeVisits] =
    await Promise.all([
      prisma.booking.count({
        where: { userId },
      }),
      prisma.booking.groupBy({
        by: ["status"],
        where: { userId },
        _count: { _all: true },
      }),
      prisma.venueRating.count({
        where: { userId, verifiedVisit: true },
      }),
      prisma.checkIn.count({
        where: { userId, checkedOutAt: null },
      }),
    ]);

  return {
    totalBookings,
    statusBreakdown,
    verifiedRatingsCount,
    activeVisits,
  };
}
```

---

## Index Coverage Best Practices

Database aggregates rely heavily on proper PostgreSQL B-tree composite indexes to perform Index-Only Scans (`Index Only Scan using ...`) rather than full table sequential scans.

Ensure `prisma/schema.prisma` defines compound indexes covering the filtering and grouping columns:

```prisma
model Booking {
  id        String        @id @default(uuid())
  userId    String
  venueId   String
  status    BookingStatus
  createdAt DateTime      @default(now())
  
  // Composite index for fast filtering and grouping by userId + status
  @@index([userId, status, createdAt])
}

model Speedtest {
  id            String   @id @default(uuid())
  venueId       String
  downloadSpeed Float
  wifiSpeed     Float
  createdAt     DateTime @default(now())

  // Composite index for venue-level speed aggregations
  @@index([venueId, wifiSpeed])
}

model VenueRating {
  id            String   @id @default(uuid())
  venueId       String
  userId        String
  verifiedVisit Boolean  @default(false)
  createdAt     DateTime @default(now())

  // Composite index for user review counts and verified status
  @@index([userId, verifiedVisit])
}
```

---

## Key Rules & Guidelines

1. **Never load full entities for counts**: Use `prisma.<model>.count()`, never `(await prisma.<model>.findMany()).length`.
2. **Combine queries with `Promise.all`**: Keep overall connection wait times low.
3. **Filter early in `where`**: Avoid large group sets by placing strict date bounds or status predicates in the query.
4. **Verify execution plans**: Use `EXPLAIN (ANALYZE, BUFFERS)` to verify index utilization on production datasets.
