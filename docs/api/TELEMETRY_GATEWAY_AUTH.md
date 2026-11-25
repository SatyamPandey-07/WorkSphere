# Telemetry Gateway Fail-Closed Authentication

This guide documents how `POST /api/telemetry/batch` authenticates gateway callers and when it refuses to accept data. Read it before changing `verifyGatewayToken` or the auth block in `POST` in `src/app/api/telemetry/batch/route.ts`.

For the payload schema and ingestion behavior, see section 12 of [telemetry.md](./telemetry.md).

## Principle

The endpoint writes sensor data straight to the database, so it fails closed: if the server cannot prove a caller is a trusted gateway, the request is rejected. The only open path is a local development or test run with no credentials configured and no credentials sent.

## Where the token comes from

The server reads the expected token from the first non-empty variable in this order:

1. `GATEWAY_API_TOKEN`
2. `TELEMETRY_GATEWAY_TOKEN`
3. `WORKER_SECRET`

An empty string counts as unset, because the lookup uses `||`. `WORKER_SECRET` is shared with other worker code, so rotating it also rotates this endpoint's credential. Prefer setting `GATEWAY_API_TOKEN` explicitly.

## Where the caller sends it

| Header                          | Notes                                                                     |
| :------------------------------ | :------------------------------------------------------------------------ |
| `Authorization: Bearer <token>` | Checked first. `Bearer` and `bearer` are accepted. Other casings are not. |
| `x-gateway-token: <token>`      | Used when no bearer token is present.                                     |
| `x-api-key: <token>`            | Used when neither of the above is present.                                |

If a bearer token is present it wins, even when `x-gateway-token` carries a different value.

## Decision table

| Token configured? | `NODE_ENV`              | Caller sent a token? | Result                                                       |
| :---------------- | :---------------------- | :------------------- | :----------------------------------------------------------- |
| No                | `production`            | any                  | `503` (checked before anything else)                         |
| Yes               | any                     | no                   | `401`                                                        |
| Yes               | any                     | wrong value          | `401`                                                        |
| Yes               | any                     | correct value        | continues to rate limiting                                   |
| No                | `development` or `test` | no                   | continues (the only unauthenticated path)                    |
| No                | `development` or `test` | yes                  | `401`, a token is never accepted without a configured secret |
| No                | anything else or unset  | any                  | `401`                                                        |

Notes on the table:

- The `503` check runs before `verifyGatewayToken`, so a misconfigured production server reports a server problem rather than blaming the caller.
- Status codes and messages: `503` returns `"Service Unavailable: Telemetry gateway credentials not configured"`, and `401` returns `"Unauthorized: Invalid or missing gateway API token"`.
- Outside production, an unset or unusual `NODE_ENV` (for example a staging build that never sets it) is also closed. Only the literal values `development` and `test` open the bypass.

## How the comparison works

`verifyGatewayToken` compares the provided and configured tokens with `crypto.timingSafeEqual`. It checks the byte lengths first, because `timingSafeEqual` throws on unequal lengths, so a length mismatch returns `false` without a constant-time comparison. Any exception during comparison also returns `false`.

## Request order

1. Resolve the configured token. If none and `NODE_ENV=production`, return `503`.
2. `verifyGatewayToken`. On failure, return `401`.
3. Per-IP rate limit (60 requests per minute). On failure, return `429`.
4. Parse and validate the body.
5. Insert.

Authentication runs before rate limiting, so unauthenticated traffic is rejected without consuming a caller's rate-limit bucket and does not touch the database.

## Checklist before changing this code

- Does every path with no configured secret in `production` still return `503`?
- Can a request ever succeed when a token was sent but no secret is configured? It must not.
- Does the new code still use `timingSafeEqual` after an explicit length check?
- Is auth still ahead of the body parse and the database call?
- Were the decision table above and `src/__tests__/api/telemetryGatewayAuth.test.ts` updated together?

## Tests

`src/__tests__/api/telemetryGatewayAuth.test.ts` covers each row of the decision table, the header precedence rules, and the guarantee that rejected requests never reach the rate limiter or the database.
