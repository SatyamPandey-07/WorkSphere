# Venue Photos: Pexels and Local Testing

## 1. Overview

WorkSphere can search Pexels for one landscape photo matching a venue name.
The server-side helper requests the large Pexels image size and the photo API
route streams the image to the browser. The Pexels API key is read on the
server and is not sent to the browser.

Pexels search results are stock photos selected by a text query; they are not
verified photographs of the named venue. Treat them as illustrative venue
imagery.

The Pexels-backed image is requested by the venue detail dialog on the `/ai`
venue-discovery page. The general venue results/cards use a separate OSM plus
Unsplash/Picsum enrichment path. These paths can therefore show different
images for the same venue.

## 2. Get a free Pexels API key

1. Open the [Pexels API page](https://www.pexels.com/api/).
2. Create a Pexels account or sign in to an existing account.
3. Use the API page's request flow to request an API key.
4. After the key is issued, copy it from the Pexels API/developer dashboard.
   Keep it private and use it only in the server-side environment described
   below.

Pexels currently documents default limits of **200 requests per hour** and
**20,000 requests per month** per API key. These are the published default
limits, not a guarantee that every account has the same limit. Check the
limits shown for your key and the latest
[Pexels API documentation](https://www.pexels.com/api/documentation/).
Pexels says higher limits may be requested; acceptable attribution can qualify
an application for increased limits, but an increase is not automatic.

## 3. Local environment setup

Add your key to the repository-root `.env.local` file:

```dotenv
PEXELS_API_KEY=replace_with_your_pexels_api_key
```

Replace the placeholder with your own key. Do not add a `NEXT_PUBLIC_` prefix:
the helper reads `process.env.PEXELS_API_KEY` on the server. Do not commit the
key or put it in a client-side file.

The key is captured when the server module loads. Stop and restart the
development server after adding, removing, or changing the value:

```bash
npm run dev
```

The application also needs its normal local database configuration for the
Pexels photo route, which reads and writes a venue photo record.

## 4. Test with Pexels enabled

1. Configure `PEXELS_API_KEY` in `.env.local` and restart `npm run dev`.
2. Open `http://localhost:3000/ai`.
3. Select a venue from the venue results or map and open its details dialog.
   The dialog requests the photo endpoint using that venue's ID, name, and
   coordinates.
4. In the browser's developer tools, inspect the request shaped like:

   ```text
   /api/venues/<venueId>/photo?name=<venue-name>&lat=<latitude>&lng=<longitude>
   ```

   A successful Pexels result is returned as an image (`200` response). The
   dialog displays that image in its cover area. The API key is used only by
   the server; it is not part of this browser request.

5. To distinguish an API lookup from a previously saved result, use a venue
   whose `placeId` has no non-empty `photoReference` in the local database.
   The server reuses a saved value before making another Pexels request. The
   response body is proxied, so the browser's image URL is the WorkSphere API
   route rather than the original `images.pexels.com` URL.

**Attribution check:** The current Pexels path does not provide a successful
photographer-name or photographer-link check in the UI. The helper keeps only
the image URL from Pexels, and the detail dialog does not receive photographer
metadata. See [Attribution requirements](#7-attribution-requirements) for the
current behavior and limitation. Do not mistake a missing attribution label
for an invalid API key.

## 5. Test without a Pexels API key

1. Remove or comment out `PEXELS_API_KEY` in `.env.local`.
2. Restart `npm run dev` so the server reloads its environment.
3. Open `/ai` and open a venue's details dialog.
4. The Pexels helper returns no URL when the key is absent. The
   `/api/venues/<venueId>/photo` request therefore returns `404`, and the
   dialog uses a category-specific static Unsplash image for its cover.

The dialog also requests `/api/venues/enrich` for its photo list. This is a
separate provider path:

- If `UNSPLASH_ACCESS_KEY` or `NEXT_PUBLIC_UNSPLASH_ACCESS_KEY` is configured,
  the enrichment helper searches Unsplash.
- If neither Unsplash key is configured, or the Unsplash request fails, the
  helper returns deterministic `picsum.photos/seed/...` URLs.
- If the enrichment route finds no matching venue, it returns a small
  hard-coded set of Picsum URLs.

There is no dedicated class named “mock photo provider” in this flow. The
fallback consists of these seeded Picsum and static Unsplash URLs; they are
not Pexels results.

The general venue cards continue using the enrichment photo list and their
own image-error placeholder. They do not require `PEXELS_API_KEY`. In the
browser's Network panel, fallback image URLs use `images.unsplash.com` or
`picsum.photos`; a successful Pexels detail image is returned through the
WorkSphere photo route. The Pexels API key being absent does not by itself
prevent a card from rendering.

## 6. Photo caching

There are several distinct caching layers:

| Layer                     | What it caches                                                                   | Behavior                                                                                                                                                                                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database                  | The Pexels image URL in `Venue.photoReference`, looked up by `placeId`           | No TTL or automatic invalidation is implemented in `getVenuePhotoUrl`. A non-empty value is reused indefinitely while `PEXELS_API_KEY` is configured. Despite the schema's legacy Google Places comment, this helper currently writes a Pexels URL to the field.                       |
| Photo API response        | The proxied image bytes                                                          | The route sets `Cache-Control: public, s-maxage=86400, stale-while-revalidate=3600` (24-hour shared-cache freshness with a one-hour stale-while-revalidate window). This is a response policy; a local development server does not necessarily have a shared edge cache.               |
| Production service worker | Successful `/api/venues` responses and direct `images.pexels.com` image requests | The registered `public/sw.js` uses network-first caching for venue API requests and stale-while-revalidate for direct Pexels image URLs. Those branches have no explicit TTL or entry limit in that worker. The service worker is registered only in production, not by `npm run dev`. |

For a local database-cache check, use a test venue with no existing
`photoReference`, open its details once, and inspect its `Venue` row in your
development database (for example, with `npx prisma studio`). The first
successful lookup should save an `images.pexels.com` URL. Repeating the lookup
for the same `placeId` should return the saved URL without searching Pexels
again. Use another uncached test venue to exercise a fresh lookup; do not
delete or modify production venue data to test cache behavior.

The database URL cache has no automatic expiry, so changing the API key or
waiting does not refresh an existing photo. To investigate a stale result,
inspect the local `photoReference` value and use a different uncached test
venue. When testing the production service worker, use browser developer tools
to inspect or clear only the relevant local Cache Storage entries.

`src/sw.ts` contains a separately tested helper with a 100-entry/14-day
expiration policy, but `useServiceWorker` registers `public/sw.js`, whose
venue-photo cache branch does not enforce that policy. Do not assume the
helper's limits apply to the production service worker.

## 7. Attribution requirements

Pexels asks API users to show a prominent link to Pexels and to credit
photographers when possible. Its guidance recommends a credit such as
“Photo by [photographer] on Pexels” linking to the photo page. If a full photo
credit cannot be provided, Pexels asks for a text link such as
[Photos provided by Pexels](https://www.pexels.com). See the
[official API guidelines](https://www.pexels.com/api/documentation/#guidelines)
and [Pexels API FAQ](https://www.pexels.com/api/).

The current UI has generic attribution support, but it is not connected to the
Pexels lookup:

- `VenueCard` and `VenueGallery` can render a supplied photographer name and
  `photographerUrl`. A provided link opens in a new tab with
  `noopener noreferrer`.
- Those components show attribution only when their caller passes an
  `attribution` object. If a link is absent, they render the name as plain
  text; if the name is blank, the generic fallback label is “Verified
  Contributor.” That label is not a Pexels credit.
- `getVenuePhotoUrl` parses only the Pexels image `src` URL and returns a
  string. It does not retain `photographer`, `photographer_url`, or the photo
  page URL. The photo route then returns image bytes, not attribution data.
- The `/ai` detail dialog does not display a Pexels photographer name or a
  Pexels link.

Therefore a contributor can verify whether the image request succeeded, but
cannot currently verify Pexels photographer attribution in that UI. The
generic component behavior is not evidence that the Pexels flow meets Pexels'
attribution guidance; wiring attribution through the provider and UI would
require a separate application change.

## 8. Troubleshooting

- **Missing key:** Confirm the variable is exactly `PEXELS_API_KEY` in the
  root `.env.local`, then restart the server. With no key, the Pexels helper
  returns `null` without checking the database cache; the photo route returns
  `404` and the dialog uses its fallback image.
- **Invalid key or rate limit:** Check the server terminal for a
  `[Pexels] search failed` message and status. The helper logs the Pexels
  error and returns `null`; the route then returns `404`. Pexels documents
  `429` for exceeded limits. Repeated lookups for the same cached venue
  normally do not consume another Pexels search request.
- **No photos returned:** The Pexels query uses the venue name, landscape
  orientation, and one result. A successful response with no photos also
  produces no Pexels URL, so the dialog falls back to its category image.
- **Broken image URL:** The route returns `502` if the upstream image fetch
  is not successful, or `500` for an unexpected server error. The dialog's
  image error handler switches to its static category fallback. Check the
  server log and the request's status in developer tools.
- **Missing photographer attribution:** This is a current integration
  limitation, not a Pexels key setting. The helper discards Pexels photographer
  metadata and the detail dialog has no attribution display. See the previous
  section.
- **Stale photo:** A non-empty `Venue.photoReference` is reused without a
  database TTL. Test with an uncached development venue or inspect that
  development row. The route's shared-cache headers and production service
  worker may also serve cached responses outside local development.

## 9. Related implementation files and tests

### Provider and UI

- `src/lib/googlePlaces.ts` — Pexels search, API-key check, and database URL
  lookup/write.
- `src/app/api/venues/[venueId]/photo/route.ts` — photo proxy and response
  cache headers.
- `src/components/chat/VenueDetailDialog.tsx` — requests the Pexels photo,
  loads the separate enrichment photos, and selects the category fallback.
- `src/app/ai/page.tsx` — opens the venue detail dialog from the venue
  discovery flow.
- `src/app/api/venues/enrich/route.ts` and `src/lib/venues.ts` — OSM,
  Unsplash, and Picsum enrichment path used separately from Pexels.
- `src/components/VenueCard.tsx` and `src/components/venues/VenueList.tsx` —
  general venue list card and its enriched photo data.
- `src/components/venue/VenueCard.tsx` and
  `src/components/venue/VenueGallery.tsx` — generic optional attribution
  rendering.
- `src/hooks/usePWA.tsx` and `public/sw.js` — production service-worker
  registration and runtime caching.
- `src/sw.ts` — separate TypeScript cache helper covered by its own tests;
  it is not the worker registered at `/sw.js`.
- `prisma/schema.prisma` — `Venue.photoReference` field.

### Existing relevant tests

- `src/__tests__/sw/imageCaching.test.ts` — tests the TypeScript service-worker
  photo URL/cache helper.
- `src/__tests__/lib/picsumReplacement.test.ts` — tests a test-local copy of
  the deterministic Picsum URL format; it does not call the enrichment helper.
- `src/__tests__/lib/venuePhotoUrlValidation.test.ts` — tests a self-contained
  HTTPS URL-validation helper rather than the Pexels API route.

There is no existing test that exercises the Pexels API helper, photo API
route, or Pexels attribution end to end.
