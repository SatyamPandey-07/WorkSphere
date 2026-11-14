# Live accessibility routing

The accessibility route and distance-matrix APIs use OpenRouteService's wheelchair profile instead of mock segments.

## Server configuration

Set `ORS_API_KEY` in the server environment. Do not expose this key through a `NEXT_PUBLIC_` variable or send it from the browser. The route provider is called server-side.

The provider requests GeoJSON directions with elevation and the `steepness`, `suitability`, and `surface` extras. Successful route evaluations are cached in Upstash Redis for five minutes when Redis is configured; cache failures are non-fatal and routing continues through the provider. For wheelchair routing it also asks ORS to avoid ferries and steps and applies wheelchair profile restrictions for surface, track quality, smoothness, sloped kerbs, and maximum incline. These values are mapped to the existing `RouteSegment` contract and evaluated by `AccessibleRouter`.

## Route request

`POST /api/accessibility/route` accepts:

```json
{
  "venueId": "venue-id",
  "startCoords": { "lat": 40.73, "lng": -73.99 },
  "endCoords": { "lat": 40.731, "lng": -73.989 },
  "mobilityProfile": {
    "wheelchairMode": true,
    "maxInclinePercent": 8.33
  }
}
```

Coordinates may also be supplied as `[latitude, longitude]` pairs. The response contains provider geometry, distance, duration, an accessibility score, route warnings, and mapped navigation cues.

## Distance matrix

`POST /api/accessibility/matrix` accepts 2–6 coordinates. The API requests each directed pair with a maximum of three concurrent provider requests; direction is significant because elevation and accessibility penalties can differ uphill and downhill.

## Data quality

A route is never fabricated when the provider is unavailable or has no route. Missing suitability metadata remains unknown and is treated conservatively by the existing accessibility scoring engine. Provider errors return a non-success response so callers can distinguish unavailable routing from a valid route.
