# Spatial Venue Bounding-Box Search API Guide

Comprehensive technical API documentation for WorkSphere's spatial venue bounding-box search endpoint (`/api/search`). This endpoint enables clients to query venues within geographic bounding coordinates, filter by category or free text, paginate results, and handle bounding boxes that cross the International Date Line (anti-meridian, 180°/-180°).

---

## 1. Overview

The spatial search service is implemented by [`src/app/api/search/route.ts`](../../src/app/api/search/route.ts) and provides both `GET` and `POST` methods:

- **`GET /api/search`**: URL query-parameter interface for map viewports, quick coordinate lookups, and browser navigation.
- **`POST /api/search`**: JSON request-body interface for programmatic clients, complex filters, and explicit offset-based pagination.

Both methods invoke the shared SQL query generator (`buildBoundingBoxQuery`) to construct parameterized PostgreSQL queries over the `"Venue"` table.

### Key Capabilities

- **Bounding-Box Filtering**: Evaluates latitude and longitude constraints to match venues situated inside the target geographic area.
- **Anti-Meridian Crossover Support**: Detects when `minLongitude > maxLongitude` (crossing the 180° meridian) and splits the longitude predicate into a disjunctive `OR` condition across the Eastern and Western hemispheres.
- **Free-Text Search**: Sanitizes search queries up to 100 characters and applies case-insensitive `ILIKE` wildcard matching across venue name and address fields.
- **Exact Category Matching**: Allows exact-match category filtering while treating `"all"` as a wildcard.
- **Configurable Pagination**: Supports `limit` (clamped 1–100) and `page` controls, with POST supporting direct `offset` overrides.

---

## 2. Distinction from Semantic Search

WorkSphere provides two distinct search routes with different query pipelines and use cases:

| Capability                 | Spatial Bounding-Box Search (`/api/search`)                                       | Semantic Search (`/api/search/semantic`)                                                 |
| :------------------------- | :-------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------- |
| **Methods**                | `GET`, `POST`                                                                     | `POST`                                                                                   |
| **Primary Mechanism**      | SQL bounding-box comparisons (`<`, `<=`, `>`, `>=`) and `ILIKE` text matching     | Vector cosine similarity over PostgreSQL `pgvector` HNSW indexes                         |
| **Text Processing**        | ASCII/C1 control character stripping, 100-character cap, whitespace normalization | WebAssembly Unicode UAX #29 text segmentation and tokenization                           |
| **Search Engine**          | Direct Prisma raw SQL (`$queryRaw`)                                               | High-dimensional embeddings generated via Groq API / LLM                                 |
| **Anti-Meridian Handling** | Disjunctive `OR` splitting across 180°/-180°                                      | Not applicable (separate vector pipeline; does not use bounding-box anti-meridian logic) |
| **Dedicated Guide**        | This document                                                                     | [Semantic Search API Guide](./semantic-search.md)                                        |

The spatial search endpoint documented here does not call embedding models or execute vector similarity queries.

---

## 3. Authentication and Middleware Behavior

WorkSphere protects API routes at the edge middleware layer ([`src/middleware.ts`](../../src/middleware.ts)):

- **Edge Middleware Boundary**: The path `/api/search` is **not** included in the `isPublicRoute` allowlist.
- **Authentication Enforcement**: When an incoming request lacks an active Clerk authentication session, Clerk middleware intercepts the request and issues an **HTTP 307 Temporary Redirect** to `/sign-in` with an encoded `redirect_url` preserving the original search request.
- **Route Execution**: The route handler in `src/app/api/search/route.ts` assumes the request has already been authorized by middleware and does not emit a JSON `401 Unauthorized` response.

---

## 4. Geographic Parameters and Aliases

The query builder accepts geographic coordinates using canonical names or common aliases:

| Dimension             | Canonical Parameter | Supported Aliases        | Precedence Order                     |
| :-------------------- | :------------------ | :----------------------- | :----------------------------------- |
| **Minimum Longitude** | `minLon`            | `minLongitude`, `minLng` | `minLon` → `minLongitude` → `minLng` |
| **Maximum Longitude** | `maxLon`            | `maxLongitude`, `maxLng` | `maxLon` → `maxLongitude` → `maxLng` |
| **Minimum Latitude**  | `minLat`            | `minLatitude`            | `minLat` → `minLatitude`             |
| **Maximum Latitude**  | `maxLat`            | `maxLatitude`            | `maxLat` → `maxLatitude`             |

### Method-Specific Parameter Handling

- **`GET /api/search`**: Parses query-string values using `Number(val)`. Missing, empty (`""`), or non-finite values (such as `NaN` or `Infinity`) evaluate to `undefined` and are ignored.
- **`POST /api/search`**: Extracts properties directly from the JSON body (`body.minLon ?? body.minLongitude ?? body.minLng`). The handler does not run schema validation or convert strings to numbers. Clients must pass numeric values for coordinate properties.

### Geographic Validation Rules and Limitations

> [!IMPORTANT]
> **No Coordinate Range Validation:**
> The route does not validate that latitude falls within `[-90, 90]` or that longitude falls within `[-180, 180]`. It does not normalize coordinates (such as wrapping values around 360°) and does not reject invalid numbers.
>
> **Partial and Omitted Bounds:**
> A complete four-sided bounding box is **not** mandatory:
>
> - Supplying only a minimum bound applies a lower-bound comparison (`>=`).
> - Supplying only a maximum bound applies an upper-bound comparison (`<=`).
> - Omitting all spatial parameters allows the query to execute without geographic constraints, returning venues filtered solely by category, query text, and pagination.

---

## 5. Anti-Meridian (180°/-180°) Crossover Handling

The International Date Line (anti-meridian) lies along the 180° / -180° meridian. A map viewport bounding Pacific island nations (such as Fiji or Tuvalu) has a minimum longitude in the Eastern hemisphere (positive degrees, e.g. `177.0`) and a maximum longitude in the Western hemisphere (negative degrees, e.g. `-178.0`).

### Crossover Detection

The query builder evaluates:

```typescript
export function isAntiMeridianCrossover(
  minLongitude: number,
  maxLongitude: number,
): boolean {
  return minLongitude > maxLongitude;
}
```

### SQL Predicate Generation

When `minLon > maxLon`, standard conjunctive logic (`lon >= 177 AND lon <= -178`) would produce an impossible condition matching zero records. The query generator detects this crossover and emits a disjunctive `OR` expression:

```sql
(v."longitude" >= 177.0 OR v."longitude" <= -178.0)
```

For standard viewports where `minLon <= maxLon`, it generates an inclusive `AND` expression:

```sql
(v."longitude" >= -122.5 AND v."longitude" <= -122.3)
```

All independent filter predicates are combined with `AND`, while the anti-meridian longitude predicate remains isolated inside parentheses:

```sql
WHERE (v."longitude" >= 177.0 OR v."longitude" <= -178.0)
  AND (v."latitude" >= -19.5 AND v."latitude" <= -15.5)
```

The boolean flag `isAntiMeridianCrossover` is included in the top-level response payload to inform the client of the geometry mode used.

---

## 6. Category and Free-Text Filtering

### Category Filtering

- Specified via the `category` parameter.
- Executes an exact SQL equality comparison: `v."category" = ${options.category}`.
- **Wildcard Value**: The literal value `"all"` disables the filter, returning venues from all categories.
- Matching uses exact equality comparison without partial or fuzzy matching; comma-separated values are not supported.

### Free-Text Search

Clients must pass the `query` (or `q`) parameter as a string.

> [!IMPORTANT]
> **String Requirement and Exception Handling:**
> In `src/app/api/search/route.ts`, the query builder evaluates `if (options.query && options.query.trim())` before calling `sanitizeSearchQuery`. If a client supplies a truthy non-string value (such as a number, boolean, array, or object in a JSON POST payload), `.trim()` throws a runtime `TypeError`. The route catches this exception and returns an HTTP 500 error (`"Internal server error during spatial search"`). The endpoint does not safely convert non-string values to `""`.

When a string query is provided, it is sanitized using [`src/lib/searchSanitizer.ts`](../../src/lib/searchSanitizer.ts):

1. **Control Character Stripping**: ASCII control characters (`\u0000`–`\u001f`, `\u007f`) and C1 control characters (`\u0080`–`\u009f`), including NUL (`\0`) and ESC (`\x1b`), are removed.
2. **Trimming**: Leading and trailing whitespace is stripped.
3. **Length Ceiling**: The string is truncated to `MAX_SEARCH_QUERY_LENGTH = 100` characters.
4. **Whitespace Normalization**: Multiple consecutive whitespace characters are collapsed into a single space (`\s+` → `" "`).
5. **Case Normalization**: The sanitized string is trimmed and converted to lowercase using `toLowerCase()`.
6. **Predicate Construction**: If the sanitized string is non-empty, the query wraps it in SQL wildcards (`%${sanitized}%`) and matches against both `name` and `address`:
   ```sql
   (v."name" ILIKE '%quiet cafe%' OR v."address" ILIKE '%quiet cafe%')
   ```

> [!NOTE]
> Free-text matching searches only `v."name"` and `v."address"`. It does not search `description`, amenities, or user notes. It is distinct from the comma-separated `splitSearchList` utility used by city-filter endpoints.

---

## 7. Pagination and Sorting

### Pagination Parameters

| Parameter | Type     | Default | Allowed Range | Description                                                                                 | Supported On  |
| :-------- | :------- | :-----: | :-----------: | :------------------------------------------------------------------------------------------ | :------------ |
| `limit`   | `number` |  `50`   | `1` to `100`  | Maximum number of venue records to return. Clamped via `Math.min(Math.max(1, limit), 100)`. | GET, POST     |
| `page`    | `number` |   `1`   |    $\ge 1$    | 1-based page index. Clamped via `Math.max(1, page)`.                                        | GET, POST     |
| `offset`  | `number` | Derived |    $\ge 0$    | Direct row offset for SQL `OFFSET`. Clamped via `Math.max(0, offset)`.                      | **POST only** |

### Parameter Clamping and Validation Limitations

The route applies numeric boundary clamping to pagination parameters:

- `limit`: Clamped to `[1, 100]` via `Math.min(Math.max(1, limit), 100)`. Default is `50`.
- `page`: Clamped to a minimum of `1` via `Math.max(1, page)`. Default is `1`.
- `offset`: Clamped to a minimum of `0` via `Math.max(0, offset)` when explicitly provided in POST requests.

> [!NOTE]
> **No Integer Validation or Schema Enforcement:**
> The route applies numeric boundary clamping without integer truncation or rounding (`Math.floor` is not called). Non-integer values (e.g. `limit=10.5`) pass through the clamping expressions directly. Additionally, the POST route does not validate request bodies against a formal schema; callers are expected to pass valid numeric values.

### Offset Resolution

1. If `offset` is explicitly provided in a POST request, it overrides the page-derived offset:
   $$\text{offset} = \max(0, \text{options.offset})$$
2. If `offset` is not provided (or on GET requests), offset is calculated from `page` and `limit`:
   $$\text{offset} = (\text{page} - 1) \times \text{limit}$$

> [!WARNING]
> **No Database-Wide Total Count:**
> The query does not perform a `SELECT COUNT(*)` across the database. The returned `total` field indicates only the number of venues returned in the current page (`venues.length`). The response does not include `hasMore`, `totalPages`, or remaining record counts.

### Result Ordering

Results are always ordered alphabetically by venue name in ascending order:

```sql
ORDER BY v."name" ASC
```

---

## 8. Selected Venue Fields

The SQL query selects the following columns from the `"Venue"` table (`prisma/schema.prisma`):

| Field         | Type              | Description                                                                     |
| :------------ | :---------------- | :------------------------------------------------------------------------------ |
| `id`          | `string`          | Unique venue identifier (uses Prisma CUID default: `@id @default(cuid())`).     |
| `name`        | `string`          | Display name of the workspace venue.                                            |
| `category`    | `string`          | Venue classification (e.g., `"coworking"`, `"cafe"`, `"library"`).              |
| `address`     | `string \| null`  | Physical street address.                                                        |
| `latitude`    | `number`          | Geographic latitude in decimal degrees (non-null in schema).                    |
| `longitude`   | `number`          | Geographic longitude in decimal degrees (non-null in schema).                   |
| `rating`      | `number \| null`  | User rating score.                                                              |
| `wifiQuality` | `integer \| null` | Wi-Fi rating score (1–5 scale per schema comment).                              |
| `hasOutlets`  | `boolean`         | Indicates power outlet availability (defaults to `false`, non-null in schema).  |
| `noiseLevel`  | `string \| null`  | Acoustic noise level (`"quiet"`, `"moderate"`, or `"loud"` per schema comment). |
| `imageUrl`    | `string \| null`  | Primary image URL.                                                              |

---

## 9. Success and Error Responses

### Success Response (`200 OK`)

Both `GET` and `POST` return an identical JSON response structure:

```json
{
  "success": true,
  "venues": [
    {
      "id": "venue_cuid_101",
      "name": "Downtown Central Workspace",
      "category": "coworking",
      "address": "100 Market St, San Francisco, CA",
      "latitude": 37.7892,
      "longitude": -122.4018,
      "rating": 4.8,
      "wifiQuality": 5,
      "hasOutlets": true,
      "noiseLevel": "quiet",
      "imageUrl": "https://images.example.com/venues/downtown.jpg"
    }
  ],
  "total": 1,
  "isAntiMeridianCrossover": false,
  "bounds": {
    "minLongitude": -122.5,
    "maxLongitude": -122.3,
    "minLatitude": 37.7,
    "maxLatitude": 37.9
  }
}
```

#### Response Properties

- `success` (`boolean`): Always `true` on successful query execution.
- `venues` (`array`): Array of venue objects matching the criteria.
- `total` (`number`): **Array length of the returned `venues`** (`venues.length`), representing items in the current page.
- `isAntiMeridianCrossover` (`boolean`): `true` if `minLongitude > maxLongitude`.
- `bounds` (`object`): Canonical bounds passed to the query builder:
  - `minLongitude` (`number | undefined`): Canonical minimum longitude.
  - `maxLongitude` (`number | undefined`): Canonical maximum longitude.
  - `minLatitude` (`number | undefined`): Canonical minimum latitude.
  - `maxLatitude` (`number | undefined`): Canonical maximum latitude.

### Error Response (`500 Internal Server Error`)

If query execution fails, the database connection drops, or malformed JSON is passed to POST, the route catches the exception and returns:

```http
HTTP/1.1 500 Internal Server Error
Content-Type: application/json

{
  "error": "Internal server error during spatial search"
}
```

---

## 10. Request Examples

### 1. Standard Bounding-Box Search (GET)

```http
GET /api/search?minLon=-122.5&maxLon=-122.3&minLat=37.7&maxLat=37.9&limit=20&page=1 HTTP/1.1
Host: worksphere.example
Cookie: __session=<clerk-session-token>
Accept: application/json
```

### 2. Category Filtered Search (GET)

```http
GET /api/search?minLon=-122.5&maxLon=-122.3&minLat=37.7&maxLat=37.9&category=coworking HTTP/1.1
Host: worksphere.example
Cookie: __session=<clerk-session-token>
Accept: application/json
```

### 3. Free-Text Search Using `query` (GET)

```http
GET /api/search?minLon=-122.5&maxLon=-122.3&minLat=37.7&maxLat=37.9&query=quiet%20cafe HTTP/1.1
Host: worksphere.example
Cookie: __session=<clerk-session-token>
Accept: application/json
```

### 4. Free-Text Search Using `q` Alias (GET)

```http
GET /api/search?minLon=-122.5&maxLon=-122.3&minLat=37.7&maxLat=37.9&q=library HTTP/1.1
Host: worksphere.example
Cookie: __session=<clerk-session-token>
Accept: application/json
```

> [!NOTE]
> If both `query` and `q` are present in a GET request, `query` takes precedence (`searchParams.get("query") ?? searchParams.get("q")`).

### 5. Anti-Meridian Search (GET)

Search across Fiji and Pacific island territories crossing the 180° meridian:

```http
GET /api/search?minLon=177&maxLon=-178&minLat=-19.5&maxLat=-15.5 HTTP/1.1
Host: worksphere.example
Cookie: __session=<clerk-session-token>
Accept: application/json
```

**Response:**

```json
{
  "success": true,
  "venues": [
    {
      "id": "venue_fiji_suva",
      "name": "Suva Nomad Co-Working",
      "category": "coworking",
      "address": "Victoria Parade, Suva, Fiji",
      "latitude": -18.1416,
      "longitude": 178.4419,
      "rating": 4.8,
      "wifiQuality": 5,
      "hasOutlets": true,
      "noiseLevel": "moderate",
      "imageUrl": "https://images.example.com/venues/suva.jpg"
    }
  ],
  "total": 1,
  "isAntiMeridianCrossover": true,
  "bounds": {
    "minLongitude": 177,
    "maxLongitude": -178,
    "minLatitude": -19.5,
    "maxLatitude": -15.5
  }
}
```

### 6. Standard JSON Body Search (POST)

```http
POST /api/search HTTP/1.1
Host: worksphere.example
Cookie: __session=<clerk-session-token>
Content-Type: application/json
Accept: application/json

{
  "minLon": -122.5,
  "maxLon": -122.3,
  "minLat": 37.7,
  "maxLat": 37.9,
  "category": "coworking",
  "query": "quiet cafe",
  "limit": 20,
  "page": 1
}
```

### 7. Explicit Offset Pagination (POST)

Using `offset` directly to bypass `page` calculation:

```http
POST /api/search HTTP/1.1
Host: worksphere.example
Cookie: __session=<clerk-session-token>
Content-Type: application/json
Accept: application/json

{
  "minLon": -122.5,
  "maxLon": -122.3,
  "minLat": 37.7,
  "maxLat": 37.9,
  "limit": 10,
  "offset": 40
}
```

---

## 11. Implementation References

- Route Implementation: [`src/app/api/search/route.ts`](../../src/app/api/search/route.ts)
- Query Sanitization: [`src/lib/searchSanitizer.ts`](../../src/lib/searchSanitizer.ts)
- Anti-Meridian Tests: [`src/__tests__/api/searchAntiMeridian.test.ts`](../../src/__tests__/api/searchAntiMeridian.test.ts)
- Sanitizer Tests: [`src/__tests__/lib/searchSanitizer.test.ts`](../../src/__tests__/lib/searchSanitizer.test.ts)
- Edge Middleware: [`src/middleware.ts`](../../src/middleware.ts)

---

## 12. Related Documentation

- [WorkSphere API Reference](../API_REFERENCE.md) — Summary of all REST and RPC endpoints.
- [API Documentation Index](./README.md) — Index of endpoint specifications and operational guides.
- [Semantic Search API Guide](./semantic-search.md) — Vector-based semantic search service.
- [REST API Reference](../API.md) — Project-wide API guidelines, authentication, and error standards.
