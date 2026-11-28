# Zero-Downtime Web and Mobile API Versioning

This document describes the current WorkSphere API compatibility surface and
the recommended policy for evolving it while Next.js web releases and pinned
Flutter mobile releases are active at the same time.

## 1. Current implementation inventory

### API route structure

The Next.js API is implemented with App Router handlers under
`src/app/api/**/route.ts`. The repository currently uses unversioned paths such
as `/api/venues`, `/api/reservations/book`, and `/api/auth/passkey/...`; no
parallel `/api/v1`/`/api/v2` route tree or version-negotiation middleware was
found.

Individual handlers own their request and response schemas. Authentication is
centralized in the middleware pipeline, while handlers commonly call Clerk's
`auth()` for an additional user check. See
[`src/lib/middleware/chain.ts`](../../src/lib/middleware/chain.ts),
[`src/lib/middleware/handlers/authHandler.ts`](../../src/lib/middleware/handlers/authHandler.ts),
and [`src/app/api/venues/amenity-vote/route.ts`](../../src/app/api/venues/amenity-vote/route.ts).

### Existing response headers

The implemented cross-cutting response behavior includes rate-limit headers
for throttled requests, including `X-RateLimit-Limit`,
`X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `Retry-After`. The shared
rate-limit implementation is in
[`src/lib/rateLimit/index.ts`](../../src/lib/rateLimit/index.ts), and the
middleware integration is in
[`src/lib/middleware/handlers/rateLimitHandler.ts`](../../src/lib/middleware/handlers/rateLimitHandler.ts).

The security middleware also adds security headers. These are not API version
headers.

### Client versions

The Flutter package declares `version: 0.1.0+1` in
[`apps/flutter/pubspec.yaml`](../../apps/flutter/pubspec.yaml), with Dart
`>=3.14.0 <4.0.0`, Flutter `>=3.50.0 <4.0.0`, and the `http` package. The
repository does not currently contain a Flutter API client that adds a client
version header, nor does the web client add one.

## 2. `X-WorkSphere-Client-Version`

### Current behavior

`X-WorkSphere-Client-Version` is not currently read or written by the
repository. There is no documented parser, supported format, response policy,
or compatibility branch associated with this header. Requests with the header,
requests without it, malformed values, and unknown values therefore have no
special version-negotiation behavior in the current implementation.

The examples in this section are proposed policy examples, not current API
responses.

### Recommended policy

If version negotiation is introduced, use a stable client release identifier,
not an API path or a free-form build description. Recommended examples are:

```http
X-WorkSphere-Client-Version: web-2026.11.28
X-WorkSphere-Client-Version: flutter-0.1.0+1
```

The server should initially treat this header as observability and rollout
metadata. It should not use an unknown client version to reject an otherwise
valid request unless a separately published compatibility policy requires it.

Recommended handling:

| Header state | Recommended behavior | Current WorkSphere behavior |
| --- | --- | --- |
| Missing | Accept the request; classify the client as unknown/legacy in telemetry | No special handling found |
| Well-formed known value | Accept and record client family/release | No special handling found |
| Malformed value | Accept or return a documented `400` only after an explicit rollout; never guess a version | No special handling found |
| Older supported Flutter release | Serve the compatibility contract for that release | No version-specific contract found |
| Unsupported/retired release | Return a documented error only after a migration window and client notice | No retirement behavior found |

Recommended request example:

```http
GET /api/venues HTTP/1.1
Host: api.example.invalid
X-WorkSphere-Client-Version: flutter-0.1.0+1
Authorization: Bearer <Clerk-session-token>
```

Recommended response metadata, if implemented:

```http
HTTP/1.1 200 OK
X-WorkSphere-Client-Version: flutter-0.1.0+1
```

Echoing the value is optional and should only be done after defining whether it
represents the request's client, the selected API contract, or both. The
current server does not emit this header.

## 3. Deprecation and sunset headers

### Current behavior

No API route or shared response utility in the repository currently emits the
HTTP `Deprecation` or `Sunset` headers, and no API deprecation registry or
sunset calendar was found. The repository therefore cannot claim that clients
will receive migration links or removal dates from live responses.

### Recommended policy

For a response whose behavior or field is being retired, the server may publish
the standard `Deprecation` response header. The header identifies that the
behavior is deprecated; it does not itself remove the behavior. A recommended
example is:

```http
Deprecation: @1782864000
Sunset: Tue, 30 Jun 2026 00:00:00 GMT
Link: <https://docs.example.invalid/api/migrations/venue-search-v2>; rel="deprecation"; type="text/html"
```

The date values above are illustrative only. They are not WorkSphere dates or
current response headers. A production policy should choose one precise syntax
for `Deprecation`, publish a timezone-unambiguous `Sunset` date, and link to a
stable migration document. The `Sunset` header communicates an intended
removal time; it should not be treated as proof that removal has already
occurred.

Client recommendations:

- Treat `Deprecation` as an actionable migration signal, not an immediate
  failure.
- Surface or record the `Link` documentation target when present.
- Migrate before `Sunset`; do not wait for a `410 Gone` response.
- Continue handling the existing response schema until the published removal
  policy takes effect.
- Treat an actual `4xx`/`5xx` response according to its documented contract;
  do not infer a deprecation date from an arbitrary error.

## 4. Zero-downtime compatibility strategy

The following is the recommended rollout policy. It is not an assertion that a
versioned API or deprecation scheduler is already implemented.

### Prefer additive changes

Changes compatible with both current Next.js web code and older Flutter builds
include adding optional response fields, accepting additional optional request
fields, adding new endpoints, and preserving existing enum meanings. Existing
fields should not change type, units, nullability, authorization requirements,
or meaning without a migration plan.

When adding response fields, clients must ignore unknown fields. When adding
request fields, the server should provide defaults that preserve old-client
behavior.

### Breaking changes

Changing a required field, removing a field, changing a field's type or
meaning, changing error semantics, or tightening authorization is breaking for
an installed mobile client. Use one of these approaches:

1. Introduce a new endpoint or explicit API contract version while retaining
   the old behavior.
2. Deploy the server in a form that accepts both old and new request shapes.
3. Release the Next.js web change and the Flutter migration separately, with
   the old contract still available for the pinned Flutter population.
4. Add deprecation metadata and a migration link only after the replacement is
   usable by every supported client.
5. Remove the old contract only after the published sunset criteria are met.

Do not use the client-version header as a substitute for request validation or
as a hidden breaking-change switch.

### Expand-and-contract sequencing

For changes that also affect persistence, use an expand-and-contract sequence:

1. **Expand:** add nullable/new storage or fields and deploy server code that
   can read old and new representations.
2. **Backfill/observe:** migrate existing data and measure old-client usage.
3. **Adopt:** deploy web and mobile clients that write/read the new contract,
   while retaining the old read path.
4. **Contract:** after the support window and sunset criteria, stop writing the
   old representation and remove obsolete compatibility code/schema in a
   separately reviewed change.

The current documentation scope does not authorize or implement database
changes; this sequence is guidance for future changes.

### Deployment, rollback, and pinned mobile releases

For a zero-downtime release:

1. Publish the compatibility/migration contract first.
2. Deploy server support for both old and new clients before shipping a client
   that depends on the new behavior.
3. Release the Next.js web change, which can usually update immediately.
4. Release the Flutter build and allow installed older versions to continue
   using the old contract during the support window.
5. Monitor request/client versions and deprecation usage.
6. Roll back the web or server release without removing the old contract if
   error rates rise.
7. Retire the old behavior only after migration communication and the sunset
   policy are complete.

Never roll back by deleting or rewriting a published release tag; the existing
release guidance recommends a forward patch release and redeployment. See
[`docs/RELEASE_GUIDE.md`](../RELEASE_GUIDE.md) and
[`docs/contributing/RELEASE_PROCESS.md`](../contributing/RELEASE_PROCESS.md).

## 5. Compatibility matrix

Because the repository has no API-version negotiation or client-version header
implementation, the compatibility results below are deliberately explicit
about what is known and unknown.

| Client | Version | API compatibility | Deprecation handling |
| --- | --- | --- | --- |
| Next.js Web | Current repository release | Uses the current unversioned `/api/**` route contracts and shared middleware. Exact release identifier is not declared in the inspected client source. | No `Deprecation`/`Sunset` handling found; web code follows each route's existing response behavior. |
| Flutter Mobile | Older pinned version | `apps/flutter` currently exposes a scaffold with `http`, but no implemented API client or pinned API contract. Compatibility with the unversioned API is therefore unknown. | No client-version header or deprecation handling found. |
| Flutter Mobile | Newer release | No newer Flutter release or version-negotiation implementation is present in the repository. Compatibility is unsupported/unknown rather than assumed. | No client-version header or deprecation handling found. |

## 6. Team responsibilities and implementation gaps

### Current gaps

- No `/v1`/`/v2` route convention or API version resolver.
- No `X-WorkSphere-Client-Version` parser, validator, telemetry field, or
  response behavior.
- No `Deprecation` or `Sunset` response headers.
- No published API support window tied to Flutter versions.
- No implemented Flutter API client that pins or advertises a compatibility
  contract.
- No automated deprecation registry or migration-link catalog.

### Recommended responsibilities

- **API/backend team:** preserve additive contracts, publish migration notes,
  implement any version/deprecation headers consistently, and keep old and new
  request shapes available during the migration window.
- **Web team:** update against the new contract, tolerate additive fields, and
  ship web changes only after the server can serve installed mobile clients.
- **Mobile team:** advertise the actual app release once the header is
  implemented, tolerate additive response fields, and release migrations before
  the published sunset date.
- **Release/operations team:** sequence deployments, monitor client-version
  usage and deprecation signals, communicate timelines, and retain a rollback
  path that does not strand older Flutter builds.

Any future implementation should update this document with the actual header
format, supported-version table, response examples, and removal dates. Until
then, the recommendation sections above must not be read as live API behavior.
