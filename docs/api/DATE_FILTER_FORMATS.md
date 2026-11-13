# Date Filter Formats

This reference describes the date and time query formats used by WorkSphere
API endpoints. Unless an endpoint documents a narrower format, date filters
are parsed by the shared date-filter validation helpers.

## Calendar dates

Use an ISO 8601 date-only value for a calendar-day boundary:

```http
GET /api/bookings/history?startDate=2026-11-01&endDate=2026-11-12
```

| Parameter | Meaning |
| --- | --- |
| `startDate` | Inclusive lower bound |
| `endDate` | Inclusive upper bound |
| `date` | A single date filter where supported |

Date-only values are interpreted as midnight UTC (`00:00:00.000Z`) before
comparison. The calendar date must be real; values such as `2026-02-30` are
rejected.

## Range queries and aliases

`startDate` and `endDate` can be supplied independently or together:

```http
GET /api/bookings/history?startDate=2026-11-01
GET /api/bookings/history?endDate=2026-11-12
GET /api/bookings/history?startDate=2026-11-01&endDate=2026-11-12
```

For endpoints using the shared range parser, `from` is an alias for
`startDate` and `to` is an alias for `endDate`:

```http
GET /api/bookings/history?from=2026-11-01&to=2026-11-12
```

When both boundaries are supplied, the interval is inclusive and
`startDate` must be earlier than or equal to `endDate`.

## RFC 3339 timestamps

Date filters also accept RFC 3339-compatible ISO 8601 timestamps with seconds,
optional fractional seconds, and either UTC (`Z`) or a numeric offset:

```http
GET /api/bookings/history?startDate=2026-11-01T09:00:00Z&endDate=2026-11-12T17:30:00Z
GET /api/bookings/history?startDate=2026-11-01T09:00:00+05:30&endDate=2026-11-12T17:30:00-04:00
GET /api/bookings/history?startDate=2026-11-01T09:00:00.000Z&endDate=2026-11-12T17:30:00.000Z
```

Accepted timestamp components are:

- `YYYY-MM-DDTHH:mm:ss`
- `YYYY-MM-DDTHH:mm:ss.sss`
- An optional `Z` or numeric offset (`+05:30`, `-04:00`, `+0530`)

An omitted timezone is treated as UTC. Valid timestamps are normalized to
canonical UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`) before comparison.

## Relative windows

Endpoints that expose an aggregation window use a relative value on their
`range` or `timeframe` parameter. These values represent a window ending at
the current server time; they are not valid values for `startDate` or
`endDate`.

```http
GET /api/admin/vitals?range=7d
GET /api/admin/vitals?range=30d
GET /api/telemetry?timeframe=7d
```

Common supported windows include:

| Value | Meaning |
| --- | --- |
| `today` | Current calendar day |
| `24h` | Previous 24 hours |
| `7d` | Previous 7 days |
| `30d` | Previous 30 days |

Individual endpoints may support only a subset of these values. Consult the
endpoint-specific reference before sending a relative window.

## 400 Bad Request responses

Invalid date values, malformed timestamps, invalid calendar dates, and reversed
intervals return HTTP `400 Bad Request` with
`Content-Type: application/problem+json`.

### Invalid date or timestamp

```json
{
  "type": "https://api.worksphere.com/errors/bad-request",
  "title": "Bad Request",
  "status": 400,
  "code": "BAD_REQUEST",
  "error": "startDate must be a valid ISO 8601 date string (e.g. YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.sssZ)",
  "detail": "startDate must be a valid ISO 8601 date string (e.g. YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.sssZ)",
  "errors": [
    {
      "field": "startDate",
      "issue": "startDate must be a valid ISO 8601 date string (e.g. YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.sssZ)"
    }
  ],
  "fieldErrors": [
    {
      "field": "startDate",
      "message": "startDate must be a valid ISO 8601 date string (e.g. YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.sssZ)"
    }
  ]
}
```

### Reversed interval

If `startDate` is later than `endDate`, the response identifies the boundary
that violates the ordering rule:

```json
{
  "type": "https://api.worksphere.com/errors/bad-request",
  "title": "Bad Request",
  "status": 400,
  "code": "BAD_REQUEST",
  "error": "startDate must be before or equal to endDate",
  "detail": "startDate must be before or equal to endDate",
  "errors": [
    {
      "field": "startDate",
      "issue": "startDate must be before or equal to endDate"
    }
  ],
  "fieldErrors": [
    {
      "field": "startDate",
      "message": "startDate must be before or equal to endDate"
    }
  ]
}
```

Clients should correct the supplied values before retrying. Do not retry the
same invalid date filter unchanged.
