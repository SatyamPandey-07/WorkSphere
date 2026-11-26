# Venue Flagging API

## Endpoint

`POST /api/venues/{venueId}/flag`

This endpoint submits a venue issue report. Requests require authentication.

## Request body

```json
{
  "reason": "permanently_closed"
}
```

The `reason` field must be a string containing between **10 and 500 characters**,
inclusive.

Valid reasons remain limited to the established venue flagging reason contract:

- `permanently_closed`
- `wrong_hours`
- `no_wifi`
- `wrong_address`
- `duplicate`
- `other`

## Reason length validation

Before a venue flag is created, the API validates the character length of
`reason`.

- Reasons shorter than 10 characters are rejected.
- Reasons longer than 500 characters are rejected.
- The endpoint returns HTTP `400` for either length violation.
- Valid values are at least 10 characters and no more than 500 characters.

The validation occurs before venue lookup and flag persistence, so an
invalid-length reason does not create a `FlaggedItem` record.

## HTTP 400 validation response

Validation failures use the standard API error structure:

```json
{
  "success": false,
  "error": "Reason must be at least 10 characters",
  "code": "VALIDATION_FAILED",
  "details": {
    "reason": ["Reason must be at least 10 characters"]
  }
}
```

For a reason that exceeds the maximum, `error` and the `reason` detail entry
describe the 500-character maximum instead.

## Invalid reason length example

The following request contains fewer than 10 characters:

```bash
curl -X POST "https://<host>/api/venues/venue-123/flag" \
  -H "Authorization: Bearer <access-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Too short"
  }'
```

`Too short` is 9 characters, so the API responds with HTTP `400`:

```json
{
  "success": false,
  "error": "Reason must be at least 10 characters",
  "code": "VALIDATION_FAILED",
  "details": {
    "reason": ["Reason must be at least 10 characters"]
  }
}
```
