# Spatial Geo-Query Guide

How WorkSphere validates coordinates, filters venues by bounding box, measures distance, and runs PostGIS radius queries. It describes what the code does today and where the pieces disagree.

## Where the code lives

| Concern | File |
| --- | --- |
| Coordinate schema, PostGIS point builders, radius search | [`src/lib/search/spatialVenueSearch.ts`](../../src/lib/search/spatialVenueSearch.ts) |
| Bounding-box SQL builder and `/api/search` route | [`src/app/api/search/route.ts`](../../src/app/api/search/route.ts) |
| Coordinate clamping and Haversine (km) | [`src/lib/utils.ts`](../../src/lib/utils.ts) |
| Distance helpers built on it | [`src/lib/distance.ts`](../../src/lib/distance.ts) |
| Bearings | [`src/lib/geo.ts`](../../src/lib/geo.ts) |
| PostGIS column, trigger and GiST index | [`prisma/migrations/20261111000000_postgis_venue_spatial_index/migration.sql`](../../prisma/migrations/20261111000000_postgis_venue_spatial_index/migration.sql) |
| Radius search route | [`src/app/api/venues/search/route.ts`](../../src/app/api/venues/search/route.ts) |

The bounding-box endpoint has its own API guide: [Spatial Venue Bounding-Box Search API Guide](../api/SPATIAL_VENUE_SEARCH.md). This guide covers the geometry and the radius query.

## Coordinate model

Coordinates are WGS84 decimal degrees.

| Value | Range |
| --- | --- |
| latitude | -90 to 90 |
| longitude | -180 to 180 |

PostGIS uses X for longitude and Y for latitude, so the point is always written `ST_MakePoint(longitude, latitude)`. Swapping them is the most common spatial bug.

### `GeoCoordinateSchema`

`GeoCoordinateSchema` is a Zod object that requires both fields to be finite numbers inside the ranges above. It **rejects** out-of-range values with an error message. It does not clamp.

```typescript
GeoCoordinateSchema.parse({ latitude: 37.77, longitude: -122.42 }); // ok
GeoCoordinateSchema.parse({ latitude: 91, longitude: 0 });          // throws
```

`SpatialVenueSearchInputSchema` extends it:

| Field | Rule | Default |
| --- | --- | --- |
| `radiusMeters` | finite, greater than 0, at most 50,000 | 5,000 |
| `limit` | integer, 1 to 100 | 25 |
| `maxNoiseDb` | 20 to 120, optional | none |
| `minWifiMbps` | 0 or more, optional | none |

`toPostGisLonLatTuple` validates a coordinate and returns `[longitude, latitude]`, so callers cannot pass them in the wrong order. `buildPostGisGeographyPoint` returns the parameterized fragment:

```sql
ST_SetSRID(ST_MakePoint($lon, $lat), 4326)::geography
```

### Clamping helpers

`clampLatitude` and `clampLongitude` in `utils.ts` pull a value into range instead of rejecting it, and return `NaN` for `NaN`, `null` or non-numbers.

```typescript
clampLatitude(120);    // 90
clampLatitude(-999);   // -90
clampLongitude(200);   // 180
clampLatitude(NaN);    // NaN
```

The Haversine helper in `utils.ts` clamps its inputs this way, so a bad latitude gives a distance for the nearest valid latitude and not an error. The Zod path is stricter.

## Distance: Haversine and geodesic

### Haversine (spherical)

The great-circle distance on a sphere:

```text
a = sin²(Δφ / 2) + cos φ1 · cos φ2 · sin²(Δλ / 2)
c = 2 · asin(√a)
d = R · c
```

φ is latitude, λ is longitude, both in radians. The repo has two implementations with slightly different radii:

| Function | File | Radius | Unit |
| --- | --- | --- | --- |
| `calculateSphericalDistanceMeters` | `spatialVenueSearch.ts` | 6,371,008.8 m (IUGG mean radius) | meters |
| `calculateHaversineDistance`, `haversineKm` | `utils.ts`, `distance.ts` | 6,371 km | kilometers |

Worked example, San Francisco (37.7749, -122.4194) to Oakland (37.8044, -122.2712):

- `calculateSphericalDistanceMeters`: about 13,429.6 m.
- The 6,371 km helper gives the same value to within a few centimeters.

At the equator one degree of longitude is about 111.2 km, and at latitude 60 it is about 55.6 km. Because the formula uses the shortest arc, a pair across the anti-meridian also works: (0, 179.5) to (0, -179.5) is about 111.2 km, not 359 degrees of longitude.

### Geodesic (ellipsoidal)

Earth is an oblate ellipsoid, so a sphere is off by up to about 0.5 percent, and the error depends on direction and latitude. An ellipsoidal geodesic (Vincenty or Karney) corrects this.

The application code has **no** ellipsoidal implementation. The only ellipsoidal calculation comes from PostGIS: for the `geography` type, `ST_Distance` and `ST_DWithin` measure on the WGS84 spheroid by default. So:

- In-memory scoring and fallbacks use Haversine.
- The SQL `distanceMeters` and the `ST_DWithin` cutoff use the spheroid.

The two can differ slightly for the same pair of points. Near a radius boundary, a venue can pass one check and fail the other. For venue search at city scale this is not significant, but do not compare the two values for equality in tests.

## Bounding-box filtering

`buildBoundingBoxQuery` in `src/app/api/search/route.ts` turns four optional bounds into SQL predicates on the `latitude` and `longitude` columns.

| Case | Predicate |
| --- | --- |
| `minLon <= maxLon` | `(lon >= minLon AND lon <= maxLon)` |
| `minLon > maxLon` (crosses 180) | `(lon >= minLon OR lon <= maxLon)` |
| only one longitude bound | single `>=` or `<=` |
| both latitude bounds | `(lat >= minLat AND lat <= maxLat)` |

Result paging is clamped: `limit` is forced into 1 to 100 (default 50), `page` is at least 1, and `offset` is at least 0.

```typescript
const { sql, isAntiMeridian } = buildBoundingBoxQuery({
  minLon: 170,
  maxLon: -170,   // minLon > maxLon, so the box wraps the date line
  minLat: -20,
  maxLat: -10,
  limit: 500,     // becomes 100
});
// isAntiMeridian === true
// WHERE (v."longitude" >= 170 OR v."longitude" <= -170)
//   AND (v."latitude" >= -20 AND v."latitude" <= -10)
// LIMIT 100 OFFSET 0
```

Note that the builder does **not** validate or clamp the bound values themselves. `minLat: 200` is passed to SQL as is and simply matches nothing. If a caller needs strict validation, run each corner through `GeoCoordinateSchema` or the clamp helpers first.

The bounding box compares plain `double precision` columns, and the migration below indexes the `coordinates` geography column, not these. See [Index notes](#index-notes).

## PostGIS radius search

`searchVenuesWithinRadius` runs one parameterized query:

```sql
SELECT v."id", v."name", ..., ST_Distance(venue_point, origin) AS "distanceMeters"
FROM "Venue" v
WHERE ST_DWithin(venue_point, origin, $radiusMeters)
  [AND (v."noiseDb" IS NULL OR v."noiseDb" <= $maxNoiseDb)]
  [AND (v."wifiSpeedMbps" IS NOT NULL AND v."wifiSpeedMbps" >= $minWifiMbps)]
ORDER BY venue_point <-> origin ASC
LIMIT $limit
```

`venue_point` is `ST_SetSRID(ST_MakePoint(v."longitude", v."latitude"), 4326)::geography` and `origin` is the same expression built from the validated input. All values are bound parameters, so there is no string concatenation.

- `ST_DWithin` keeps venues within `radiusMeters` meters.
- `<->` orders by distance (nearest first).
- The noise filter keeps venues with no noise reading. The Wi-Fi filter drops venues with no Wi-Fi reading.
- Rows come back with `distanceMeters` converted to a `number`.

```typescript
const venues = await searchVenuesWithinRadius({
  latitude: 37.7749,
  longitude: -122.4194,
  radiusMeters: 2000,
  limit: 10,
  maxNoiseDb: 60,
});
```

Invalid input (for example `radiusMeters: 60000`) throws a `ZodError` before any SQL runs.

## Spatial index

The migration `20261111000000_postgis_venue_spatial_index` does the following:

1. Enables the `postgis` extension.
2. Adds `"coordinates" geography(Point, 4326)` to `"Venue"` and backfills it from `longitude` and `latitude`.
3. Adds a trigger, `venue_coordinates_sync`, that recomputes `coordinates` on insert or when `latitude` or `longitude` changes.
4. Creates a GiST index: `venue_coordinates_gist` on `"Venue"("coordinates")`.

A GiST index stores bounding boxes in an R-tree, so `ST_DWithin` can skip far-away rows and `<->` can walk the nearest rows first.

### Index notes

- **The radius query as written does not reference the `coordinates` column.** It rebuilds the point from `longitude` and `latitude` on every row. A GiST index on the column cannot serve an expression that does not use it, so PostgreSQL will most likely scan the table. Switching the query to `v."coordinates"` would let the index apply. This guide documents the current behavior and does not change code.
- The bounding-box query filters on the raw `latitude` and `longitude` columns. Use `EXPLAIN` to check what it uses, since the migration adds no index on those columns.
- Keep the trigger in mind when writing `Venue` rows with raw SQL: `coordinates` is filled by the trigger, and Prisma cannot write the `Unsupported` geography column directly.

Check a plan with:

```sql
EXPLAIN ANALYZE
SELECT id FROM "Venue" v
WHERE ST_DWithin(v."coordinates", ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326)::geography, 2000);
```

Look for `Index Scan using venue_coordinates_gist`. A `Seq Scan` means the index is not in use.

## Pitfalls

- Pass longitude first to `ST_MakePoint`.
- `ST_DWithin` on `geography` takes meters. On `geometry` with SRID 4326 it would take degrees.
- Validate with `GeoCoordinateSchema` for an error, or clamp for a silent fix. Do not mix the two in one flow without deciding which you want.
- A box that wraps the date line must have `minLon > maxLon`.
- Do not compare Haversine and PostGIS distances for equality.
