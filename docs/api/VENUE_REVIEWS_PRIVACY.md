# Venue Reviews API: Redaction and Privacy Guarantees

`GET /api/venues/[venueId]/reviews` is a public endpoint. This guide describes what it returns to anonymous and signed-in callers, how reviewer identity is redacted, and what developers must do when changing the payload.

- Route: `src/app/api/venues/[venueId]/reviews/route.ts`
- Redaction helper: `redactReviewPayload`
- Tests: `src/__tests__/api/venueReviewsReplyRedaction.test.ts`, `src/__tests__/api/venueReviewsPrivacyGuarantees.test.ts`

## Guarantees

| Caller | `userId` (review and nested replies) | `user` object |
| :-- | :-- | :-- |
| Unauthenticated | Removed at every depth | `null` |
| Authenticated | Present | `{ firstName, lastName }` only |

1. An anonymous response never contains a `userId` key, however deeply replies are nested.
2. An anonymous response never contains a reviewer's name: `user` is `null`.
3. An authenticated response exposes at most `firstName` and `lastName` under `user`. Email, Clerk ID and other user columns are never selected.
4. Redaction does not alter any other field (`id`, `rating`, `comment`, `createdAt`, reply text, `authorName`).

## How redaction works

```ts
export function redactReviewPayload<T>(data: T, shouldRedact = true): T
```

- Arrays are mapped item by item; objects are rebuilt without any key named `userId`, recursing into every value.
- `null`, `undefined` and primitives are returned unchanged.
- The input is not mutated, so objects held by the SWR cache stay intact.
- `shouldRedact = false` returns the input as-is. The route passes `true` only when `auth()` yields no `userId`.

Redaction is a denylist on one key. It does not detect other identifying data, such as a user ID embedded in free text or a differently named field (`authorId`, `reviewerId`). Add any new identifying field to the helper and to the tests before shipping it.

## Request flow

1. `auth()` resolves the Clerk session. A missing session is allowed and selects the anonymous path.
2. The IP-based rate limit (`reviews:<ip>`, 60 requests) is checked. Failure returns `429 RATE_LIMITED`.
3. The venue is resolved by internal `id` or `placeId`. An unknown venue returns an empty page: `{ reviews: [], nextCursor: null, hasMore: false }`.
4. Reviews are read through `swrCache`. The cache holds raw rows, including `userId`.
5. Rows are shaped per caller (table above) after the cache read, so one caller's view is never cached for another.

## Response shape

```json
{
  "reviews": [
    {
      "id": "rev_1",
      "venueId": "ven_1",
      "rating": 5,
      "comment": "Fast WiFi, quiet mornings.",
      "user": null
    }
  ],
  "nextCursor": null,
  "hasMore": false
}
```

Authenticated callers additionally receive `"userId": "..."` on each review and `"user": { "firstName": "Ada", "lastName": "L." }`.

## Query parameters and errors

| Parameter | Default | Notes |
| :-- | :-- | :-- |
| `limit` | `20` | Positive integer, capped at `100`; invalid values fall back to `20` |
| `cursor` | none | Review `id` from the previous `nextCursor` |

| Status | Code | Cause |
| :-- | :-- | :-- |
| `400` | `INVALID_CURSOR` | Cursor does not match a review (Prisma `P2025`) |
| `429` | `RATE_LIMITED` | More than 60 requests per IP |
| `500` | `INTERNAL_ERROR` | Unexpected failure |

## Caching

Non-default pages use keys of the form `<base>:cursor:<cursor|first>:limit:<n>`. Because redaction happens after the cache read, the cache must never be changed to store redacted or per-user output.

## Checklist for changes

- Adding a field to `venueRating` or reply objects? Decide whether it identifies a person; if so, redact it for anonymous callers.
- Changing the `include` or `select` on `user`? Keep it to `firstName` and `lastName`.
- Add or update a test for both anonymous and authenticated callers.
- Run `npx jest src/__tests__/api` and `npx eslint --max-warnings=0` on touched files.
