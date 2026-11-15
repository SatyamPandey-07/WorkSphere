import { NextRequest, NextResponse } from "next/server";
import {
  generateETag,
  isETagMatch,
  normalizeETag,
  create304Response,
  createGeoJsonResponse,
  handleConditionalGet,
  withGeoJsonCache,
  STATIC_GEOJSON_CACHE_CONTROL,
  GEOJSON_CONTENT_TYPE,
} from "@/lib/http/etag";

describe("HTTP ETag & Cache-Control Middleware Utility", () => {
  describe("generateETag", () => {
    const samplePayload = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "Financial District" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-122.404, 37.791],
                [-122.398, 37.795],
                [-122.393, 37.793],
                [-122.404, 37.791],
              ],
            ],
          },
        },
      ],
    };

    it("generates deterministic SHA-256 ETag by default formatted with quotes", () => {
      const etag1 = generateETag(samplePayload);
      const etag2 = generateETag(samplePayload);

      expect(etag1).toBe(etag2);
      expect(etag1).toMatch(/^"[a-f0-9]{64}"$/);
    });

    it("generates MD5 ETag when requested", () => {
      const md5Etag = generateETag("test-content", { algorithm: "md5" });
      expect(md5Etag).toMatch(/^"[a-f0-9]{32}"$/);
      // MD5 of "test-content" is 9473fdd0d880a43c21b7778d34872157
      expect(md5Etag).toBe('"9473fdd0d880a43c21b7778d34872157"');
    });

    it("generates weak ETag when weak option is enabled", () => {
      const weakEtag = generateETag("sample data", { weak: true });
      expect(weakEtag).toMatch(/^W\/"[a-f0-9]{64}"$/);
    });

    it("handles Buffer and Uint8Array payloads", () => {
      const buffer = Buffer.from("workplace boundaries");
      const uint8 = new Uint8Array(buffer);

      const etagBuffer = generateETag(buffer);
      const etagUint8 = generateETag(uint8);

      expect(etagBuffer).toBe(etagUint8);
    });
  });

  describe("normalizeETag & isETagMatch", () => {
    it("normalizes quotes, weak prefixes, and whitespace", () => {
      expect(normalizeETag('"abc123"')).toBe("abc123");
      expect(normalizeETag('W/"abc123"')).toBe("abc123");
      expect(normalizeETag('  W/"xyz789"  ')).toBe("xyz789");
    });

    it("matches identical strong ETags", () => {
      const current = '"6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b"';
      expect(isETagMatch(current, current)).toBe(true);
    });

    it("matches weak against strong ETags per RFC 7232 weak comparison rule", () => {
      const current = '"hash123"';
      expect(isETagMatch('W/"hash123"', current)).toBe(true);
    });

    it("matches when client supplies multiple comma-separated ETags", () => {
      const current = '"hash-target"';
      const header = '"hash-other", W/"hash-target", "hash-old"';
      expect(isETagMatch(header, current)).toBe(true);
    });

    it("matches wildcard asterisk (*)", () => {
      expect(isETagMatch("*", '"any-etag"')).toBe(true);
    });

    it("returns false on mismatch or missing header", () => {
      expect(isETagMatch('"different-hash"', '"current-hash"')).toBe(false);
      expect(isETagMatch(null, '"current-hash"')).toBe(false);
      expect(isETagMatch(undefined, '"current-hash"')).toBe(false);
      expect(isETagMatch("", '"current-hash"')).toBe(false);
    });
  });

  describe("create304Response & createGeoJsonResponse", () => {
    it("create304Response returns 304 with empty body and specified Cache-Control header", async () => {
      const etag = '"sample-etag"';
      const response = create304Response(etag);

      expect(response.status).toBe(304);
      expect(response.statusText).toBe("Not Modified");
      expect(response.headers.get("Cache-Control")).toBe(STATIC_GEOJSON_CACHE_CONTROL);
      expect(response.headers.get("ETag")).toBe(etag);
      expect(response.headers.get("Vary")).toBe("Accept-Encoding");

      const text = await response.text();
      expect(text).toBe("");
    });

    it("createGeoJsonResponse returns 200 with GeoJSON Content-Type and Cache-Control", async () => {
      const etag = '"sample-etag"';
      const data = { type: "FeatureCollection", features: [] };
      const response = createGeoJsonResponse(data, etag);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe(GEOJSON_CONTENT_TYPE);
      expect(response.headers.get("Cache-Control")).toBe(STATIC_GEOJSON_CACHE_CONTROL);
      expect(response.headers.get("ETag")).toBe(etag);

      const json = await response.json();
      expect(json).toEqual(data);
    });
  });

  describe("handleConditionalGet", () => {
    const geoData = { type: "FeatureCollection", features: [] };
    const expectedETag = generateETag(geoData);

    it("returns 304 Not Modified when If-None-Match matches", async () => {
      const req = new NextRequest("http://localhost:3000/api/map/boundaries", {
        headers: { "If-None-Match": expectedETag },
      });

      const res = handleConditionalGet(req, geoData);
      expect(res.status).toBe(304);
      expect(res.headers.get("Cache-Control")).toBe(STATIC_GEOJSON_CACHE_CONTROL);
      expect(res.headers.get("ETag")).toBe(expectedETag);
      expect(await res.text()).toBe("");
    });

    it("returns 200 with full body when If-None-Match does not match", async () => {
      const req = new NextRequest("http://localhost:3000/api/map/boundaries", {
        headers: { "If-None-Match": '"stale-etag"' },
      });

      const res = handleConditionalGet(req, geoData);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe(STATIC_GEOJSON_CACHE_CONTROL);
      expect(res.headers.get("ETag")).toBe(expectedETag);
      expect(await res.json()).toEqual(geoData);
    });
  });

  describe("withGeoJsonCache Route Handler wrapper", () => {
    it("wraps handler, injects Cache-Control, and returns 304 on matching ETag", async () => {
      const payload = { type: "FeatureCollection", message: "district assets" };
      const innerHandler = jest.fn(async () => NextResponse.json(payload));

      const wrappedHandler = withGeoJsonCache(innerHandler);

      // First request without If-None-Match
      const initialReq = new NextRequest("http://localhost:3000/api/map/boundaries");
      const initialRes = await wrappedHandler(initialReq);

      expect(initialRes.status).toBe(200);
      expect(initialRes.headers.get("Cache-Control")).toBe(STATIC_GEOJSON_CACHE_CONTROL);
      const etag = initialRes.headers.get("ETag");
      expect(etag).toBeTruthy();

      // Second request with matching If-None-Match
      const cachedReq = new NextRequest("http://localhost:3000/api/map/boundaries", {
        headers: { "If-None-Match": etag! },
      });
      const cachedRes = await wrappedHandler(cachedReq);

      expect(cachedRes.status).toBe(304);
      expect(cachedRes.headers.get("Cache-Control")).toBe(STATIC_GEOJSON_CACHE_CONTROL);
      expect(cachedRes.headers.get("ETag")).toBe(etag);
      expect(await cachedRes.text()).toBe("");
    });

    it("supports HEAD requests returning 200 with headers and empty body", async () => {
      const payload = { boundary: "zone-1" };
      const innerHandler = jest.fn(async () => NextResponse.json(payload));
      const wrappedHandler = withGeoJsonCache(innerHandler);

      const headReq = new NextRequest("http://localhost:3000/api/map/boundaries", {
        method: "HEAD",
      });
      const headRes = await wrappedHandler(headReq);

      expect(headRes.status).toBe(200);
      expect(headRes.headers.get("Cache-Control")).toBe(STATIC_GEOJSON_CACHE_CONTROL);
      expect(headRes.headers.get("ETag")).toBeTruthy();
      expect(await headRes.text()).toBe("");
    });
  });
});
