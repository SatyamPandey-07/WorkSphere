# PostGIS Spherical Bounding Box Index Tuning Documentation

This guide provides technical reference and tuning recommendations for geospatial indexing and spatial queries in WorkSphere. It covers Generalized Search Tree (GiST) indexing on WGS84 `geography(Point, 4326)` columns, compares `ST_DWithin` with `ST_DistanceSphere`, documents $k$-Nearest Neighbor ($k$-NN) spatial sorting using the `<->` distance operator, analyzes `EXPLAIN (ANALYZE, BUFFERS)` execution plans, and outlines optimization practices for venue discovery.

---

## 1. Spatial Indexing Fundamentals

### GiST (Generalized Search Tree) for Spatial Data

PostgreSQL's B-tree index structures only order scalar values along a single dimension. Geospatial queries require multi-dimensional range evaluation where locations are evaluated simultaneously along orthogonal latitude and longitude axes.

PostGIS provides Generalized Search Tree (**GiST**) indexing for spatial columns. In PostGIS, GiST constructs a hierarchical R-tree structure:
- **Bounding Boxes (MBR)**: Each index node represents the Minimum Bounding Box (or bounding box on a sphere) enclosing its child geometries.
- **Hierarchical Pruning**: When evaluating a spatial predicate (such as `ST_DWithin` or bounding-box overlap `&&`), PostgreSQL traverses the tree, evaluating overlap against bounding boxes. Branches whose bounding boxes do not intersect the query envelope are pruned immediately, avoiding linear table scans across unrelated candidate rows.

### Considerations for `geography(Point, 4326)`

WorkSphere stores venue geospatial positions using the WGS84 geodetic coordinate system (EPSG:4326):

```sql
-- Schema definition in WorkSphere (migration 20261111000000_postgis_venue_spatial_index)
ALTER TABLE "Venue" ADD COLUMN IF NOT EXISTS "coordinates" geography(Point, 4326);
```

Key characteristics of the `geography` type:
- **Spherical / Spheroidal Math**: Calculations are performed on the WGS84 oblate spheroid (or sphere) rather than a flat Cartesian plane.
- **Native Meter Units**: Distances and tolerances in functions such as `ST_DWithin` are natively specified in **meters**, avoiding planar degree-to-meter distortion that varies by latitude.
- **Index Bounding Boxes**: For `geography`, GiST bounding boxes wrap spherical coordinates. Near the poles and the anti-meridian ($\pm 180^\circ$ longitude), spherical bounding boxes correctly wrap around without Cartesian edge clipping.

### WorkSphere Representative Index Definition

In WorkSphere, the spatial index is defined in `prisma/migrations/20261111000000_postgis_venue_spatial_index/migration.sql`:

```sql
-- WorkSphere production index definition
CREATE INDEX IF NOT EXISTS "venue_coordinates_gist" ON "Venue" USING GIST ("coordinates");
```

### Expression Matching and Candidate Pruning

A spatial index operates strictly when query expressions match the indexed column or expression:

- **Indexed Column Access**:
  ```sql
  -- Index-compatible: Directly queries the indexed "coordinates" column
  WHERE ST_DWithin(v."coordinates", ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography, :radiusMeters)
  ```
- **Expression Mismatch Pitfall**:
  If a query reconstructs the point dynamically on the fly:
  ```sql
  -- Index-incompatible: Evaluates ST_MakePoint dynamically on every row
  WHERE ST_DWithin(
    ST_SetSRID(ST_MakePoint(v."longitude", v."latitude"), 4326)::geography,
    ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
    :radiusMeters
  )
  ```
  PostgreSQL cannot utilize `venue_coordinates_gist` unless a matching functional index on that exact expression exists. To take full advantage of GiST index pruning, queries should reference `v."coordinates"` directly.

---

## 2. `ST_DWithin` vs `ST_DistanceSphere`

When filtering venues by proximity radius, developers frequently compare `ST_DWithin` and `ST_DistanceSphere`. Understanding their mathematical and query-planning differences is critical for high-throughput venue discovery.

### Comparison Matrix

| Property | `ST_DWithin` | `ST_DistanceSphere` |
| :--- | :--- | :--- |
| **Primary Purpose** | Boolean spatial predicate (tests if distance $\le$ radius) | Scalar distance calculation (computes distance on a sphere) |
| **Input Types** | `geography, geography, float8` (or `geometry, geometry, float8`) | `geometry, geometry` (points with lon/lat coordinates) |
| **Distance Unit** | **Meters** (when using `geography`); Cartesian units (when using `geometry`) | **Meters** (assumes WGS84 spherical radius $\approx 6,370,986\,\text{m}$) |
| **Earth Model** | **Spheroid** (WGS84 ellipsoid by default, or sphere if `use_spheroid = false`) | **Sphere** (simplifying spherical approximation) |
| **Index Acceleration** | **Yes**: Native GiST index binding via internal bounding-box expansion (`&&`) | **No**: Cannot directly leverage a GiST index as a boolean search predicate |
| **Typical Query Role** | `WHERE` clause radius filtering | `SELECT` projection for distance display or sorting fallback |
| **Query Planner Impact** | Allows `Bitmap Index Scan` or `Index Scan` to discard non-candidate rows | Requires evaluating distance for every row unless filtered upstream |

### Why `ST_DWithin` is Preferred for Radius Filtering

1. **Automatic Bounding Box Filter**: When `ST_DWithin(a, b, r)` is executed against an indexed `geography` column, PostGIS automatically prepends an internal bounding box overlap condition (`a && ST_Expand(b, r)`). This allows the PostgreSQL query planner to perform an index lookup, reducing millions of database rows to a handful of candidate pages.
2. **True Spheroidal Precision**: `ST_DWithin` on `geography` accounts for the Earth's oblateness (0.5% flattening across equator vs poles), ensuring boundary consistency with international geodesic standards.
3. **Execution Cost**: Evaluating `ST_DistanceSphere(a, b) <= r` in the `WHERE` clause forces a full table scan (`Seq Scan`) unless a separate bounding box index or rectangular latitude/longitude filter isolates candidate rows beforehand.

---

## 3. $k$-Nearest Neighbor ($k$-NN) Spatial Search

For venue discovery, users commonly request the closest 10 or 25 venues ordered strictly by proximity. PostGIS provides the `<->` operator for index-assisted nearest-neighbor searching.

### Representative SQL Query

```sql
-- Executable query for WorkSphere Venue discovery
SELECT
  v."id",
  v."name",
  v."address",
  v."latitude",
  v."longitude",
  ST_Distance(
    v."coordinates",
    ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography
  ) AS "distanceMeters"
FROM "Venue" v
WHERE ST_DWithin(
  v."coordinates",
  ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography,
  :radiusMeters
)
ORDER BY
  v."coordinates" <-> ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography ASC
LIMIT :limit;
```

### The `<->` Operator and Operator Classes

1. **$k$-NN Index Traversal**:
   When used in an `ORDER BY` clause with a GiST-indexed `geography` column, the `<->` operator computes the spherical distance between the geometry and the query point.
2. **Priority Queue Scan**:
   Instead of calculating distances for all venues in the table and running a sort operation, PostgreSQL traverses the GiST index using a bounding-box priority queue. It visits the nearest bounding boxes first, returning matches as soon as the `LIMIT` threshold is met.
3. **GiST Operator Class**:
   On PostgreSQL with PostGIS, the default GiST operator class for `geography` (`gist_geography_ops`) includes support for the `<->` distance operator.
4. **Combining Radius Filtering with `<->`**:
   Combining `WHERE ST_DWithin(...)` with `ORDER BY ... <-> ... LIMIT N` ensures:
   - **Boundary Safety**: Venues beyond the maximum search radius (e.g. 5,000 meters) are excluded, even if fewer than $N$ venues exist.
   - **Optimal Execution**: The planner uses the GiST index for both the bounding-box radius cut and the nearest-neighbor priority queue.

---

## 4. `EXPLAIN ANALYZE` Comparisons

The PostgreSQL query planner evaluates table statistics, available indexes, and cost formulas to select the optimal execution path. Below are illustrative query plans contrasting an indexed spatial lookup against an unindexed sequential scan.

> **Note**: The query plans below are illustrative examples demonstrating PostgreSQL plan node structures and buffer metrics. They do not represent measured benchmarks of specific customer datasets.

### A. Indexed Spatial Search Plan (`EXPLAIN (ANALYZE, BUFFERS)`)

```text
QUERY PLAN
---------------------------------------------------------------------------------------------------------------------------------------------
Limit  (cost=0.28..12.45 rows=20 width=148) (actual time=0.082..0.312 rows=20 loops=1)
  Buffers: shared hit=28
  ->  Index Scan using venue_coordinates_gist on "Venue" v  (cost=0.28..152.10 rows=250 width=148) (actual time=0.080..0.306 rows=20 loops=1)
        Order By: (v."coordinates" <-> '0101000020E6100000...'::geography)
        Filter: ST_DWithin(v."coordinates", '0101000020E6100000...'::geography, 5000::double precision)
        Buffers: shared hit=28
Planning Time: 0.185 ms
Execution Time: 0.358 ms
```

#### Interpretation
- **`Index Scan using venue_coordinates_gist`**: PostgreSQL directly uses the GiST index to order rows by distance and prune venues outside the 5,000-meter radius.
- **`Buffers: shared hit=28`**: All required index and table pages were already present in PostgreSQL shared buffers. Zero disk reads were required.
- **`actual time=0.080..0.306 rows=20`**: The query stopped scanning immediately after retrieving 20 rows satisfying the limit, achieving sub-millisecond execution.

---

### B. Unindexed Sequential Scan Plan (`EXPLAIN (ANALYZE, BUFFERS)`)

When an unindexed expression is queried (e.g., dynamic `ST_MakePoint(v.longitude, v.latitude)` without a functional index):

```text
QUERY PLAN
---------------------------------------------------------------------------------------------------------------------------------------------
Limit  (cost=1845.20..1845.25 rows=20 width=148) (actual time=42.115..42.122 rows=20 loops=1)
  Buffers: shared hit=142 read=512
  ->  Sort  (cost=1845.20..1845.82 rows=250 width=148) (actual time=42.113..42.117 rows=20 loops=1)
        Sort Key: ((ST_SetSRID(ST_MakePoint(v."longitude", v."latitude"), 4326)::geography <-> '...'::geography))
        Sort Method: top-N heapsort  Memory: 30kB
        Buffers: shared hit=142 read=512
        ->  Seq Scan on "Venue" v  (cost=0.00..1832.00 rows=250 width=148) (actual time=0.125..40.210 rows=48 loops=1)
              Filter: ST_DWithin(ST_SetSRID(ST_MakePoint(v."longitude", v."latitude"), 4326)::geography, '...'::geography, 5000::double precision)
              Rows Removed by Filter: 49952
              Buffers: shared hit=142 read=512
Planning Time: 0.210 ms
Execution Time: 42.195 ms
```

#### Interpretation
- **`Seq Scan on "Venue"`**: PostgreSQL had to read all 50,000 rows in the table because the dynamic expression could not use `venue_coordinates_gist`.
- **`Rows Removed by Filter: 49952`**: PostGIS computed the full geodetic distance for 50,000 rows, discarding nearly all of them.
- **`Buffers: shared hit=142 read=512`**: Required reading 512 pages from disk, introducing I/O latency.
- **`Sort Method: top-N heapsort`**: All matching rows had to be gathered into memory and sorted before returning the top 20.
- **Execution Duration**: 42.2 ms vs 0.36 ms (over 100x slower due to unindexed spatial evaluation).

---

## 5. Query Optimization Recommendations

### 1. Ensure Query Predicates Match Indexed Columns
Ensure queries reference the indexed `coordinates` column rather than dynamically rebuilding the point:
```sql
-- Recommended:
WHERE ST_DWithin(v."coordinates", ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography, :radius)
```
If queries must use `(v."longitude", v."latitude")`, consider creating a functional index:
```sql
CREATE INDEX venue_expr_coordinates_gist ON "Venue" 
USING GIST ((ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)::geography));
```

### 2. Maintain Realistic Search Radii
- Limit maximum search radius to reasonable boundaries (e.g., WorkSphere caps radius at 50,000 meters in `SpatialVenueSearchInputSchema`).
- Extremely large radii (e.g. covering an entire hemisphere) degrade GiST index selectivity; if nearly every venue matches, the query planner may deliberately choose a sequential scan over an index scan.

### 3. Order Coordinates as Longitude, Latitude (X, Y)
In standard GIS convention and PostGIS:
$$\text{Point}(X, Y) \iff \text{Point}(\text{Longitude}, \text{Latitude})$$
Inverting coordinates into `ST_MakePoint(lat, lon)` generates nonsensical coordinates (e.g., latitude outside $[-90, 90]$ or flipped hemispheres). WorkSphere enforces this via `toPostGisLonLatTuple` in `src/lib/search/spatialVenueSearch.ts`.

### 4. Parameterize Dynamic Values
Always bind parameters (`$1`, `$2`, `:radius`) to allow PostgreSQL to reuse prepared execution plans and prevent SQL injection:
```typescript
Prisma.sql`WHERE ST_DWithin(v."coordinates", ${originPoint}, ${radiusMeters})`
```

### 5. Maintain Table Statistics with `ANALYZE`
GiST index cost estimations rely on up-to-date spatial statistics stored in `pg_statistic`. Run periodic maintenance on spatial tables:
```sql
ANALYZE "Venue";
```

### 6. Avoid `EXPLAIN ANALYZE` in Production APIs
`EXPLAIN ANALYZE` **executes** the query to collect actual timings and buffer counts. It should only be run in staging, administrative scripts, or read-only diagnostic sessions, never inside customer-facing API routes.

---

## 6. Practical Troubleshooting Checklist

When diagnosing slow venue discovery queries:

- [ ] **Verify Index Presence**: Run `\d "Venue"` in `psql` and confirm `venue_coordinates_gist` is present with status `USING GIST (coordinates)`.
- [ ] **Inspect the Query Plan**: Execute `EXPLAIN (ANALYZE, BUFFERS)` on the exact parameterized query with realistic coordinates.
- [ ] **Check Scan Node**: Does the plan show `Index Scan using venue_coordinates_gist` or `Seq Scan`?
- [ ] **Verify Predicate Expression**: Is the query filtering on `v."coordinates"`, or is it reconstructing points from `longitude` and `latitude`?
- [ ] **Check Rows Removed by Filter**: A high number of rows removed by filter during a `Seq Scan` indicates index non-participation.
- [ ] **Check Table Statistics**: Run `ANALYZE "Venue"` if the planner chooses a sequential scan despite index availability.
- [ ] **Verify Coordinate Axis Order**: Ensure the query passes `[longitude, latitude]` to `ST_MakePoint`.
- [ ] **Check Pagination Bounds**: Confirm `LIMIT` and `OFFSET` values are reasonable (e.g. limit $\le 100$).
