# Meet Halfway Optimization API Reference

API reference for WorkSphere's Meet Halfway geometric optimization endpoint (`POST /api/routing/meet-halfway`). This endpoint determines an equitable meeting location for distributed team members by calculating the geometric median centroid, retrieving candidate workspaces within an approximate bounding box, evaluating multi-modal commute times and fairness, and ranking venues by composite suitability.

---

## 1. Endpoint Overview

- **HTTP Method:** `POST`
- **Route Path:** `/api/routing/meet-halfway`
- **Content-Type:** `application/json`
- **Runtime:** Node.js
- **OpenAPI Specification:** [`docs/openapi.yaml`](../openapi.yaml)
- **Source Route Handler:** [`src/app/api/routing/meet-halfway/route.ts`](../../src/app/api/routing/meet-halfway/route.ts)
- **Core Optimization Engine:** [`src/core/routing/MeetHalfwayOptimizer.ts`](../../src/core/routing/MeetHalfwayOptimizer.ts)

> [!NOTE]
> **Route Path Clarification:**
> The actual route path is `/api/routing/meet-halfway`. Earlier documentation or issue descriptions may refer to `/api/venues/meet-halfway`, which does not exist in the implementation.

---

## 2. Authentication and Middleware Behavior

WorkSphere protects API routes at the Next.js edge middleware boundary ([`src/middleware.ts`](../../src/middleware.ts)):

- **Middleware Enforcement:** The endpoint matches `/(api|trpc)(.*)` and is **not** included in the `isPublicRoute` allowlist.
- **Session Requirement:** Calls require an active authenticated Clerk session (cookie-based session in browser clients).
- **Unauthenticated Handling:** Requests lacking a valid session are intercepted at the middleware layer and redirected via **HTTP 307 Temporary Redirect** to `/sign-in?redirect_url=...` preserving the original request path.
- **Route Layer Execution:** The route handler assumes authentication has already been verified by middleware and does not emit a JSON `401 Unauthorized` body.

---

## 3. Request Headers

| Header         | Type     |       Required       | Description                                |
| :------------- | :------- | :------------------: | :----------------------------------------- |
| `Content-Type` | `string` |       **Yes**        | Must be set to `application/json`.         |
| `Cookie`       | `string` | **Yes** (in browser) | Active Clerk session cookie (`__session`). |

---

## 4. Request Schema

The request body must be a JSON object conforming to `MeetHalfwayRequestSchema`:

```typescript
{
  members: TeamMemberLocation[];
  category?: string;
  minWifiSpeed?: number;
  minSeats?: number;
  searchRadiusKm?: number;
  hasOutlets?: boolean;
  transitPreference?: "transit" | "walking" | "balanced";
}
```

### Top-Level Fields

| Field               | Type      | Required |     Default      | Validation Constraints                                        | Description                                                                                                                                      |
| :------------------ | :-------- | :------: | :--------------: | :------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------- |
| `members`           | `array`   | **Yes**  |        —         | Minimum 1 item (`min(1)`). Array of `MemberLocation` objects. | Geographic locations and preferred transit modes of team members.                                                                                |
| `category`          | `string`  |    No    |   `undefined`    | String identifier.                                            | Workspace category filter (e.g., `"coworking"`, `"cafe"`, `"library"`). The literal `"all"` is treated as a wildcard and does not filter venues. |
| `minWifiSpeed`      | `number`  |    No    |       `0`        | Finite number $\ge 0$.                                        | Minimum download speed in Mbps (`wifiSpeed >= minWifiSpeed`).                                                                                    |
| `minSeats`          | `integer` |    No    | `members.length` | Finite integer $\ge 1$.                                       | Minimum contiguous available seats required. If omitted, defaults to the size of `members`.                                                      |
| `searchRadiusKm`    | `number`  |    No    |       `25`       | Finite positive number $\le 100$.                             | Spatial search radius in kilometers around the computed geometric median centroid. Maximum is 100 km (`MAX_SEARCH_RADIUS_KM`).                   |
| `hasOutlets`        | `boolean` |    No    |   `undefined`    | Boolean.                                                      | When `true`, filters exclusively for workspaces that provide power outlets (`hasOutlets: true`).                                                 |
| `transitPreference` | `string`  |    No    |   `"transit"`    | Enum: `"transit"`, `"walking"`, `"balanced"`.                 | Global transport resolution policy governing team member commute calculations.                                                                   |

### `MemberLocation` Object Schema

Each element in `members` represents a team participant:

| Field         | Type     | Required | Constraints                                                 | Description                                                                                          |
| :------------ | :------- | :------: | :---------------------------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| `id`          | `string` | **Yes**  | Non-empty string after trimming (`min(1)`).                 | Unique participant identifier (e.g. `"mem-1"`, `"user_123"`).                                        |
| `name`        | `string` | **Yes**  | Non-empty string after trimming (`min(1)`).                 | Participant display name.                                                                            |
| `latitude`    | `number` | **Yes**  | Finite number, $-90.0 \le \text{lat} \le 90.0$.             | Geographic latitude in decimal degrees.                                                              |
| `longitude`   | `number` | **Yes**  | Finite number, $-180.0 \le \text{lng} \le 180.0$.           | Geographic longitude in decimal degrees.                                                             |
| `transitMode` | `string` |    No    | Enum: `"transit"`, `"driving"`, `"bicycling"`, `"walking"`. | Individual travel mode. Evaluated when `transitPreference` is `"balanced"`. Defaults to `"transit"`. |

### Transit Preferences & Effective Mode Resolution

The endpoint computes commute times according to `transitPreference`:

- **`"transit"` (Default):** Forces all members to use public transit speed ($25\text{ km/h}$), regardless of individual `transitMode`.
- **`"walking"`:** Forces all members to use walking speed ($4.8\text{ km/h}$), regardless of individual `transitMode`.
- **`"balanced"`:** Respects each member's individual `transitMode`. If a member's `transitMode` is missing or undefined, it defaults to `"transit"`.

Unsupported fields such as `coordinates`, `travelModes`, `minRating`, or `amenityFilters` are **not** accepted and will cause validation errors.

---

## 5. Complete Request Examples

### 1. Minimal Multi-Member Request

```http
POST /api/routing/meet-halfway HTTP/1.1
Host: worksphere.example
Content-Type: application/json
Cookie: __session=<clerk-session-token>

{
  "members": [
    {
      "id": "alex",
      "name": "Alex",
      "latitude": 37.7749,
      "longitude": -122.4194
    },
    {
      "id": "jordan",
      "name": "Jordan",
      "latitude": 37.7833,
      "longitude": -122.4167
    }
  ]
}
```

### 2. Multi-Modal Balanced Preference with Amenities

```http
POST /api/routing/meet-halfway HTTP/1.1
Host: worksphere.example
Content-Type: application/json
Cookie: __session=<clerk-session-token>

{
  "members": [
    {
      "id": "mem-1",
      "name": "Alex",
      "latitude": 37.7749,
      "longitude": -122.4194,
      "transitMode": "transit"
    },
    {
      "id": "mem-2",
      "name": "Jordan",
      "latitude": 37.7833,
      "longitude": -122.4167,
      "transitMode": "bicycling"
    },
    {
      "id": "mem-3",
      "name": "Taylor",
      "latitude": 37.7699,
      "longitude": -122.4469,
      "transitMode": "walking"
    }
  ],
  "category": "coworking",
  "minWifiSpeed": 50,
  "minSeats": 4,
  "searchRadiusKm": 15,
  "hasOutlets": true,
  "transitPreference": "balanced"
}
```

---

## 6. Success Response Schema

When optimization succeeds, the endpoint returns **HTTP 200 OK**:

### Response Structure

| Property                   | Type                  | Description                                                                                  |
| :------------------------- | :-------------------- | :------------------------------------------------------------------------------------------- |
| `success`                  | `boolean`             | Always `true` on successful execution.                                                       |
| `centroid`                 | `object`              | Computed geometric median coordinates: `{ latitude: number, longitude: number }`.            |
| `totalCandidatesEvaluated` | `integer`             | Total number of candidate workspaces retrieved from the database (up to 50).                 |
| `recommendations`          | `array`               | Top 10 ranked workspace recommendations, ordered descending by `compositeRankScore`.         |
| `isCoLocated`              | `boolean`             | `true` if all team members are within 150 meters of one another (or if only 1 member).       |
| `fallbackApplied`          | `boolean`             | `true` if no candidate venues met `requiredSeats`, causing capacity filtering to be relaxed. |
| `message`                  | `string \| undefined` | Informational status message explaining co-location or fallback relaxation.                  |
| `teamSummary`              | `object`              | Summary of optimization input parameters: `{ memberCount, requiredSeats, searchRadiusKm }`.  |

### Recommendation Object (`recommendations[]`)

Each item in the `recommendations` array represents a scored venue:

| Property                   | Type      | Description                                                                                                                                                                                            |
| :------------------------- | :-------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `venue`                    | `object`  | Venue details: `id`, `name`, `latitude`, `longitude`, `category`, `address`, `rating`, `wifiSpeed`, `wifiQuality`, `hasOutlets`, `maxCapacity`, `currentOccupancy`, `availableSeatsCount`, `imageUrl`. |
| `centroidDistanceMeters`   | `integer` | Haversine distance in meters from the theoretical geometric median centroid to the venue.                                                                                                              |
| `aggregateDurationMinutes` | `integer` | Sum of estimated commute times across all participants.                                                                                                                                                |
| `averageDurationMinutes`   | `integer` | Mean commute time in minutes across all participants.                                                                                                                                                  |
| `maxDurationMinutes`       | `integer` | Worst-case commute time among all participants.                                                                                                                                                        |
| `fairnessScore`            | `integer` | Commute equity score from 0 to 100 ($100 = \text{identical commute durations}$).                                                                                                                       |
| `compositeRankScore`       | `integer` | Overall suitability score incorporating commute times, fairness, ratings, and amenities.                                                                                                               |
| `availableCapacity`        | `integer` | Seating capacity currently available at the venue.                                                                                                                                                     |
| `memberEstimates`          | `array`   | Individual commute estimates for each team member.                                                                                                                                                     |

### `MemberTravelEstimate` Object Schema

| Property          | Type      | Description                                                                                              |
| :---------------- | :-------- | :------------------------------------------------------------------------------------------------------- |
| `memberId`        | `string`  | Identifier matching the submitted member `id`.                                                           |
| `memberName`      | `string`  | Name matching the submitted member `name`.                                                               |
| `distanceMeters`  | `integer` | Rounded Haversine distance from the member's location to the venue.                                      |
| `durationMinutes` | `integer` | Estimated door-to-door commute duration in minutes (minimum 1 minute).                                   |
| `transitMode`     | `string`  | Effective transit mode evaluated for this member (`"transit"`, `"driving"`, `"bicycling"`, `"walking"`). |

---

## 7. Realistic Success Response Example

```json
{
  "success": true,
  "centroid": {
    "latitude": 37.7777,
    "longitude": -122.4181
  },
  "totalCandidatesEvaluated": 4,
  "recommendations": [
    {
      "venue": {
        "id": "venue_sf_101",
        "name": "Downtown Central Workspace",
        "latitude": 37.7812,
        "longitude": -122.4155,
        "category": "coworking",
        "address": "456 Market St, San Francisco, CA",
        "rating": 4.8,
        "wifiSpeed": 150,
        "wifiQuality": 5,
        "hasOutlets": true,
        "maxCapacity": 40,
        "currentOccupancy": 12,
        "availableSeatsCount": 28,
        "imageUrl": "https://images.example.com/venues/downtown.jpg"
      },
      "centroidDistanceMeters": 452,
      "aggregateDurationMinutes": 24,
      "averageDurationMinutes": 12,
      "maxDurationMinutes": 14,
      "fairnessScore": 94,
      "compositeRankScore": 126,
      "availableCapacity": 28,
      "memberEstimates": [
        {
          "memberId": "alex",
          "memberName": "Alex",
          "distanceMeters": 768,
          "durationMinutes": 10,
          "transitMode": "transit"
        },
        {
          "memberId": "jordan",
          "memberName": "Jordan",
          "distanceMeters": 1025,
          "durationMinutes": 14,
          "transitMode": "transit"
        }
      ]
    }
  ],
  "isCoLocated": false,
  "fallbackApplied": false,
  "teamSummary": {
    "memberCount": 2,
    "requiredSeats": 2,
    "searchRadiusKm": 25
  }
}
```

---

## 8. Error Responses

The endpoint produces standardized JSON error responses on client validation failure or unexpected server exceptions:

### 1. Malformed JSON Body (`400 Bad Request`)

Triggered when the request body cannot be parsed as valid JSON:

```json
{
  "error": "Invalid JSON body"
}
```

### 2. Invalid Root Body Type (`400 Bad Request`)

Triggered when the root JSON body is an array, primitive value, or `null`:

```json
{
  "error": "Request body must be an object"
}
```

### 3. Schema Validation Failure (`400 Bad Request`)

Triggered when fields fail Zod validation (e.g. empty `members`, invalid coordinates, radius $> 100\text{ km}$):

```json
{
  "error": "Invalid request parameters",
  "details": {
    "formErrors": [],
    "fieldErrors": {
      "members": ["At least one team member coordinate is required"],
      "searchRadiusKm": ["Number must be less than or equal to 100"]
    }
  }
}
```

### 4. Internal Server Error (`500 Internal Server Error`)

Triggered if an unhandled exception or database connection failure occurs during optimization:

```json
{
  "error": "Failed to compute meet-halfway optimization",
  "details": "Specific internal error message"
}
```

---

## 9. Geometric Optimization Algorithm

The endpoint utilizes a four-stage algorithmic pipeline implemented in [`MeetHalfwayOptimizer`](../../src/core/routing/MeetHalfwayOptimizer.ts):

### 1. Geometric Median via Weiszfeld's Algorithm

Rather than an arithmetic average (which is pulled disproportionately by geographic outliers), the centroid is calculated as the **$L_1$ Geometric Median** (Fermat-Weber point) minimizing aggregate Euclidean distance:

$$\mathbf{y}^* = \arg\min_{\mathbf{y}} \sum_{i=1}^N \|\mathbf{x}_i - \mathbf{y}\|_2$$

- **Co-location Check:** If all members are within $150\text{ meters}$ of each other, the arithmetic mean is returned immediately to prevent division-by-zero oscillations.
- **Weiszfeld Iteration:**
  $$\mathbf{y}^{(t+1)} = \frac{\sum_{i=1}^N \frac{\mathbf{x}_i}{\max\left(\|\mathbf{x}_i - \mathbf{y}^{(t)}\|_2, \; 10^{-8}\right)}}{\sum_{i=1}^N \frac{1}{\max\left(\|\mathbf{x}_i - \mathbf{y}^{(t)}\|_2, \; 10^{-8}\right)}}$$
  The algorithm iterates up to 100 times or until the coordinate shift is $< 10^{-6}$.

### 2. Candidate Bounding Box Retrieval

The centroid anchors an approximate spatial bounding box over the `"Venue"` table:

$$\Delta\text{lat} = \frac{\text{searchRadiusKm}}{111}, \quad \Delta\text{lng} = \frac{\text{searchRadiusKm}}{111 \cdot \cos\left(\frac{\text{lat} \cdot \pi}{180}\right)}$$

Up to 50 candidate venues matching spatial bounds, optional `category`, `minWifiSpeed`, and `hasOutlets` are retrieved from PostgreSQL with enabled seat counts.

### 3. Commute Duration & Fairness Estimation

For each candidate venue and each participant, the engine computes:

1. **Haversine Distance:** Great-circle distance $d$ in meters ($R = 6,371,000\text{ m}$).
2. **Deterministic Speed Profile:**
   - `"driving"`: $35\text{ km/h} \approx 583.3\text{ m/min}$
   - `"bicycling"`: $16\text{ km/h} \approx 266.7\text{ m/min}$
   - `"walking"`: $4.8\text{ km/h} = 80\text{ m/min}$
   - `"transit"`: $25\text{ km/h} \approx 416.7\text{ m/min}$
3. **Commute Duration Formula:**
   $$\text{durationMinutes} = \max\left(1, \; \text{round}\left(\frac{\text{distance}}{\text{speed}} \times 1.2 + 2\right)\right)$$
   Includes a $20\%$ routing tortuosity penalty and a $2\text{-minute}$ terminal buffer.
4. **Commute Fairness Score ($0 \le F \le 100$):**
   $$F = \max\left(0, \; \text{round}\left(100 - \sigma \times 3\right)\right)$$
   Where $\sigma$ is the sample standard deviation of member durations. Co-located teams receive $F = 100$.

### 4. Composite Ranking Score

Venues are scored using a multi-factor objective function:

$$\text{score} = \max\left(0, \; \text{round}\left(100 - 1.5 \cdot \bar{d} + 0.4 \cdot F + \text{ratingBonus} + \text{wifiBonus} + \text{outletBonus}\right)\right)$$

Where:

- $\bar{d}$ = Average commute duration in minutes.
- $\text{ratingBonus} = (\text{rating} \mathbin{??} 3.5) \times 5$ (up to 25 points).
- $\text{wifiBonus} = \min\left(15, \; \frac{\text{wifiSpeed} \mathbin{??} 50}{100} \times 15\right)$ (up to 15 points).
- $\text{outletBonus} = 5$ if `hasOutlets` is true, else 0.

### 5. Capacity Filtering & Fallback Semantics

- **Primary Pass:** Venues where `availableCapacity < requiredSeats` are filtered out.
- **Fallback Relaxation:** If no candidate venues satisfy `requiredSeats`, capacity filtering is relaxed, `fallbackApplied` is set to `true`, and all retrieved venues within the radius are scored so teams always receive actionable nearby suggestions.

---

## 10. Implementation Boundaries and Limitations

1. **No External Routing or Geocoding APIs:** The endpoint does not call external routing services (such as Google Maps Directions, Mapbox Directions, or OpenStreetMap OSRM). Distances and durations are estimated via Haversine geometry and fixed speed approximations.
2. **Fixed Bounding Box Limit:** The database query fetches at most 50 venues (`take: 50`), and the response returns at most 10 ranked recommendations (`slice(0, 10)`).
3. **Maximum Search Radius:** `searchRadiusKm` is bounded at a maximum of 100 km (`MAX_SEARCH_RADIUS_KM`).
4. **No Live Transit Schedule Verification:** Commute times represent statistical door-to-door estimates and do not account for live train cancellations, road construction, or real-time traffic congestion.

---

## 11. Related Documentation

- [Meet Halfway Algorithmic Architecture](../routing/meet-halfway-optimizer.md) — Comprehensive mathematical formulation of Weiszfeld's algorithm, proof of convergence, and numerical stability.
- [Meet Halfway Routing Guide](./MEET_HALFWAY_ROUTING.md) — Integration overview and operational guide.
- [WorkSphere API Reference](../API_REFERENCE.md) — Complete inventory of REST API endpoints.
- [API Documentation Index](./README.md) — Directory of all API specifications.
- [OpenAPI 3.1.0 Specification](../openapi.yaml) — Machine-readable OpenAPI contract.
