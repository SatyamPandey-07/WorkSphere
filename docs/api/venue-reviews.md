# Venue Reviews API

## Overview

Retrieve reviews for a venue using cursor-based pagination.

The endpoint supports both authenticated and guest requests. Results are returned in a deterministic order, making it possible to retrieve subsequent pages without relying on offset-based pagination.

**Endpoint:** `GET /api/venues/{venueId}/reviews`

The `venueId` path parameter accepts either the venue's database ID or its external `placeId`.

## Query Parameters

| Parameter | Type    | Required | Default | Description                                                                                                                                      |
| --------- | ------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `limit`   | Integer | No       | `20`    | Number of reviews to return. Positive safe integers are accepted, with values capped at `100`. Invalid or non-positive values fall back to `20`. |
| `cursor`  | String  | No       | `null`  | ID of the review from which to continue pagination. Use the `nextCursor` returned by the preceding response.                                     |

### Pagination behavior

- The default page size is `20` reviews.
- The maximum page size is `100` reviews.
- When `limit` is omitted, the endpoint returns up to 20 reviews.
- Values above 100 are capped at 100.
- Invalid, non-integer, non-positive, or unsafe integer values fall back to the default of 20. They do not produce a validation error.
- An omitted or empty cursor starts pagination from the first page.
- When a cursor is supplied, the endpoint starts after the review identified by that cursor. The cursor review itself is excluded from the next page.

### Deterministic ordering

Reviews are sorted using two fields:

1. `createdAt` in descending order.
2. `id` in descending order as a tie-breaker.

This ordering ensures consistent results when multiple reviews have the same creation timestamp.

The endpoint fetches one additional review beyond the requested page size to determine whether another page exists.

When additional results are available, `nextCursor` contains the ID of the last review in the current response. Otherwise, it is `null`.

## Response Format

A successful request returns HTTP `200` with the following structure:

```json
{
  "reviews": [
    {
      "id": "review_123",
      "userId": "user_456",
      "venueId": "venue_789",
      "wifiQuality": 4,
      "noiseLevel": 2,
      "downloadMbps": 85.5,
      "uploadMbps": 32.1,
      "comment": "Good workspace with reliable Wi-Fi.",
      "createdAt": "2026-11-20T10:30:00.000Z",
      "updatedAt": "2026-11-20T10:30:00.000Z",
      "user": {
        "firstName": "Alex",
        "lastName": "Morgan"
      }
    }
  ],
  "nextCursor": "review_123",
  "hasMore": true
}
```

The review object above is illustrative and contains representative fields. Actual review objects include the scalar fields defined by the `VenueRating` model, along with the viewer-dependent `user` property.

### Response fields

| Field        | Type             | Description                                                                      |
| ------------ | ---------------- | -------------------------------------------------------------------------------- |
| `reviews`    | Array            | Reviews returned for the requested page.                                         |
| `nextCursor` | String or `null` | ID of the last returned review when another page is available; otherwise `null`. |
| `hasMore`    | Boolean          | Indicates whether additional reviews are available.                              |

### Reviewer information

The `user` property depends on the requester's authentication state:

- **Authenticated request:** The reviewer information contains the reviewer's `firstName` and `lastName`.
- **Guest request:** The `user` property is `null`.

The endpoint can therefore return reviews to guests without exposing the associated reviewer information.

## Request Examples

### 1. Retrieve the first page

Omit the cursor to retrieve the latest reviews.

```http
GET /api/venues/venue_789/reviews?limit=20
```

Example response:

```json
{
  "reviews": [
    {
      "id": "review_123",
      "venueId": "venue_789",
      "comment": "Good workspace with reliable Wi-Fi.",
      "createdAt": "2026-11-20T10:30:00.000Z",
      "user": {
        "firstName": "Alex",
        "lastName": "Morgan"
      }
    }
  ],
  "nextCursor": "review_123",
  "hasMore": true
}
```

The example shows one review for readability. The actual response can contain up to the requested page size.

### 2. Retrieve the next page

Use the `nextCursor` value from the previous response:

```http
GET /api/venues/venue_789/reviews?limit=20&cursor=review_123
```

The endpoint continues after `review_123`, excluding the cursor review itself.

Continue requesting pages with the returned `nextCursor` until `hasMore` is `false` or `nextCursor` is `null`.

### 3. Retrieve a smaller page

Specify a lower limit when fewer reviews are needed:

```http
GET /api/venues/venue_789/reviews?limit=5
```

The endpoint returns up to five reviews. The same cursor-based pagination behavior applies.

## Empty Results

If the supplied venue ID or `placeId` does not resolve to an existing venue, the endpoint returns HTTP `200` with an empty result:

```json
{
  "reviews": [],
  "nextCursor": null,
  "hasMore": false
}
```

The same response structure is used when a valid venue has no reviews to return.

## Error Responses

Errors use the API's standard error response structure.

| HTTP Status | Error Code       | Description                                                       |
| ----------- | ---------------- | ----------------------------------------------------------------- |
| `400`       | `INVALID_CURSOR` | The supplied cursor does not identify an available review record. |
| `429`       | `RATE_LIMITED`   | The request exceeds the endpoint's rate limit.                    |
| `500`       | `INTERNAL_ERROR` | An unexpected error occurred while retrieving reviews.            |

### 400 — Invalid cursor

Returned when the supplied cursor cannot be resolved during pagination.

```json
{
  "success": false,
  "error": "Invalid reviews cursor",
  "code": "INVALID_CURSOR"
}
```

Use a valid review ID, preferably the `nextCursor` from the preceding response.

### 429 — Rate limit exceeded

The endpoint applies a route-specific sliding-window limit of **60 requests per minute per IP address**.

```json
{
  "success": false,
  "error": "Too many requests",
  "code": "RATE_LIMITED"
}
```

Reduce request frequency before retrying. For broader API rate-limiting behavior and guidance, see the [API Rate Limiting Guide](./RATE_LIMITING.md).

### 500 — Internal server error

Returned when an unexpected failure prevents the endpoint from retrieving reviews.

```json
{
  "success": false,
  "error": "Failed to fetch reviews",
  "code": "INTERNAL_ERROR"
}
```

## Client Integration Notes

- Start pagination without a cursor.
- Use the returned `nextCursor` to request the next page.
- Do not construct cursors from timestamps or offsets; use the review ID returned by the API.
- Append subsequent page results to the existing review list rather than replacing the entire list.
- Stop requesting pages when `hasMore` is `false` or `nextCursor` is `null`.
- Handle `400`, `429`, and `500` responses according to their error codes.
- Both authenticated and guest clients can retrieve reviews, but reviewer information differs based on authentication state.

## Related Documentation

- [API Rate Limiting Guide](./RATE_LIMITING.md) — rate-limit behavior and client guidance.
- [API Documentation Index](./README.md) — other endpoint-specific API guides.
- [REST API Reference](../API_REFERENCE.md) — project-wide endpoint reference.
