# ADR-004: Dual PostGIS Spatial and Trigram Venue Search

- **Status:** Accepted
- **Date:** 2026-11-12
- **Decision owners:** WorkSphere platform team

## Context

Venue discovery combines two different lookup problems:

1. **Spatial proximity:** return venues within a radius of a latitude/longitude
   and order them by distance.
2. **Name tolerance:** find the intended venue when a user misspells, omits
   punctuation, or uses a close spelling of its name.

A naive query such as `WHERE name ILIKE '%query%'` is insufficient for
misspellings because it only matches literal substrings. It also becomes
increasingly expensive as the venue table grows because a leading wildcard
prevents a normal B-tree name index from narrowing the scan. Applying the same
text query and spatial calculation without purpose-built indexes causes
latency spikes for map searches and autocomplete.

The database already uses PostgreSQL with the `postgis` and `pg_trgm`
extensions enabled. The `Venue.coordinates` field is a PostGIS
`geography(Point, 4326)` value, while `Venue.name` is the canonical display
name and search field.

## Decision

Use native PostgreSQL extensions and maintain two complementary indexes:

```sql
CREATE INDEX "Venue_coordinates_gist_idx"
  ON "Venue"
  USING GIST ("coordinates");

CREATE INDEX "Venue_name_trgm_gin_idx"
  ON "Venue"
  USING GIN ("name" gin_trgm_ops);
```

The spatial index supports radius and nearest-neighbor operations through
`ST_DWithin` and the distance operator. The trigram index supports tolerant
name matching through the `%` similarity operator and `similarity()`.

The search service should:

1. Normalize the user query (trim whitespace, normalize case, and preserve the
   original value for display).
2. Apply the spatial predicate when coordinates and a radius are available.
3. Use trigram similarity for non-empty name queries, with a configurable
   minimum similarity threshold.
4. Rank exact/prefix matches ahead of fuzzy matches, then rank by distance.
5. Use parameterized SQL through the existing database access layer.

Representative query shape:

```sql
SELECT
  v.id,
  v.name,
  v.address,
  ST_Distance(v.coordinates, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)
    AS distance_meters,
  similarity(lower(v.name), lower($3)) AS name_similarity
FROM "Venue" AS v
WHERE v.coordinates IS NOT NULL
  AND ST_DWithin(
    v.coordinates,
    ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
    $4
  )
  AND lower(v.name) % lower($3)
ORDER BY
  name_similarity DESC,
  distance_meters ASC
LIMIT $5;
```

The exact query plan must be checked with `EXPLAIN (ANALYZE, BUFFERS)` during
benchmarking. Query parameters must remain bound values; user input must never
be interpolated into SQL.

## Consequences

### Positive

- Spatial searches use the PostGIS GiST index instead of scanning every venue.
- Trigram matching handles common typos and near-spellings without an external
  search service.
- Search ranking can combine name similarity and physical distance in one
  transactionally consistent query.
- The target response time is **less than 25 ms at p95** for a warmed
  production-like index and a typical radius search.
- Search data remains in PostgreSQL, avoiding synchronization lag between venue
  writes and a separate search index.

### Negative

- GiST and GIN indexes consume additional storage and require maintenance.
- Venue creation and name/coordinate updates have higher write latency because
  both indexes must be updated. The operational target is to keep the added
  index-maintenance cost below **10 ms at p95** for a single venue write.
- Trigram similarity is approximate and requires threshold tuning to avoid
  unrelated results for short queries.
- PostGIS and `pg_trgm` become required database capabilities for the indexed
  search path.

## Alternatives considered

### External Elasticsearch or MeiliSearch

Rejected as the primary path. These systems provide richer analyzers,
phonetic tokenization, typo tolerance, and faceting, but introduce another
service, operational cost, index synchronization, and eventual-consistency
failure modes. They may become appropriate if search requirements expand to
large-scale multilingual relevance, complex faceting, or independent search
scaling.

### Native PostgreSQL extensions

Selected. PostGIS and `pg_trgm` provide the required spatial and typo-tolerant
name behavior while preserving transactional consistency and a single
operational system. They also allow incremental tuning through thresholds,
query plans, and index maintenance rather than requiring a platform migration.

### Naive `LIKE`/`ILIKE` matching

Rejected. It is acceptable only as a compatibility fallback for exact
substring behavior. It does not rank or discover misspellings reliably, and a
leading wildcard generally prevents efficient use of a conventional B-tree
index.

## Benchmark targets

Benchmark data must represent production-like distributions, including:

- At least 100,000 venues spread across multiple geographic regions.
- Queries from short inputs (`"ca"`) through longer misspellings
  (`"wewrk shibuya"`).
- Radii of 500 m, 5 km, and 25 km.
- Empty, exact, prefix, and typo-heavy name searches.
- Cold-cache and warmed-cache runs.
- Concurrent venue writes while reads are executing.

Measure:

| Metric | Target |
| --- | ---: |
| Combined spatial + name search, warmed cache, p95 | < 25 ms |
| Combined spatial + name search, p99 | < 75 ms |
| Venue create/update added index-maintenance cost, p95 | < 10 ms |
| Search result correctness for curated typo cases | >= 95% top-5 recall |
| Search result limit | Enforced server-side |

Capture query plans with `EXPLAIN (ANALYZE, BUFFERS)` and record index hit
rates, rows removed by filters, planning time, execution time, and lock
contention. Re-run the benchmark after changing the similarity threshold,
radius logic, or index definition.

## Fallback mechanisms

Fallbacks must preserve safe behavior rather than silently presenting an
unbounded result set:

1. **Missing coordinates:** run the name-only trigram query and omit distance
   ordering. Results must still use a server-side limit.
2. **Empty or very short query:** use the spatial index only when a location is
   available; otherwise require additional filters instead of scanning all
   venues.
3. **Unavailable PostGIS or trigram capability:** use a bounded, parameterized
   `ILIKE` substring query with a strict limit and emit an operational warning.
   This fallback is for degraded operation and does not claim typo tolerance.
4. **Slow query or index degradation:** apply the configured timeout, return a
   user-safe degraded-search response, and record the query shape and latency
   for remediation.
5. **Future external search migration:** keep PostgreSQL as the authoritative
   venue store and use an outbox/rebuild job to populate an external index.
   During lag or outage, route requests back to the bounded native PostgreSQL
   implementation.

Fallback activation and benchmark regressions should be observable through
database metrics and application logs; they must not be hidden behind a
success-shaped empty response.
