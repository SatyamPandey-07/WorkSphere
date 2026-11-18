# Venue flagging API

Reports an issue with a venue so the moderation team can review it.

## Endpoint

`POST /api/venues/{venueId}/flag`

Authentication is required. The route uses the shared `apiHandler`
middleware, so requests without a Clerk-authenticated user are rejected before
the handler runs.

### Request

Content type: `application/json`

```json
{
  "reason": "no_wifi",
  "details": "The advertised guest network is no longer available."
}
```

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| `reason` | string | yes | Trimmed and must be one of the values below. |
| `details` | string | no | Trimmed string. |

Allowed `reason` values:

- `permanently_closed`
- `wrong_hours`
- `no_wifi`
- `wrong_address`
- `duplicate`
- `other`

The selected reason must contain at least five non-whitespace characters
before it can be accepted as a known reason. Because the server validates the
reason against the enum as well, arbitrary free-form reasons are rejected.
The optional details field is trimmed before persistence.

### Example

```bash
curl -X POST "https://<host>/api/venues/<venueId>/flag" \
  -H "Content-Type: application/json" \
  -H "Cookie: <authenticated-session-cookie>" \
  --data '{"reason":"wrong_hours","details":"The posted closing time is incorrect."}'
```

A successful request returns:

```json
{
  "message": "Report submitted. Thank you for your feedback!"
}
```

The response is HTTP 200. If the same authenticated user has already
submitted a pending flag for the same venue and reason, the request is
idempotently acknowledged with HTTP 200:

```json
{
  "message": "You have already reported this issue."
}
```

## Rate limiting

The current implementation enforces **5 reports per authenticated user per
hour** using the key `venue-flag:{userId}` and a 3,600,000 ms window. A
request over the limit receives HTTP 429:

```json
{
  "success": false,
  "error": "Too many reports. Please try again later.",
  "code": "RATE_LIMITED"
}
```

This is the implemented limit in
`src/app/api/venues/[venueId]/flag/route.ts`. Do not substitute a different
limit in client copy or external API documentation without changing the
server policy and its tests together.

## Response codes

| HTTP | Code | Meaning |
| ---: | --- | --- |
| 200 | — | Flag accepted, or an existing pending flag was found. |
| 400 | `VALIDATION_FAILED` | Invalid JSON or invalid/missing reason. |
| 401 | `UNAUTHORIZED` | No authenticated session. |
| 404 | `VENUE_NOT_FOUND` | No venue matches the supplied ID. |
| 429 | `RATE_LIMITED` | The user's hourly flagging quota is exhausted. |
| 500 | `INTERNAL_ERROR` | Unexpected route or persistence failure. |

Errors use the shared `apiError` format:

```json
{
  "success": false,
  "error": "Unauthorized",
  "code": "UNAUTHORIZED"
}
```

For validation failures, the middleware may also include a `details` object
containing field-level messages.

## Persistence and moderation notifications

The current handler writes a `FlaggedItem` row with `type: "VENUE"`,
`itemId`, `reason`, `reportedById`, optional `details`, and the model's
default pending status. It then invalidates the venue reviews cache.

**No moderator webhook is dispatched by this route today.** There is therefore
no truthful outbound webhook payload schema to document yet. A webhook
contract should be added alongside an actual delivery mechanism (including
retry/idempotency behavior) before clients or moderators rely on it.

## Implementation references

- `src/app/api/venues/[venueId]/flag/route.ts`
- `src/lib/apiHandler.ts`
- `src/lib/apiResponse.ts`
- `src/lib/rateLimit.ts`
- `src/__tests__/api/venueFlag.test.ts`
