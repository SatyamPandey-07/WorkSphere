import { NextRequest } from "next/server";
import { GET, HEAD, STATIC_DISTRICT_BOUNDARIES } from "@/app/api/map/boundaries/route";
import { STATIC_GEOJSON_CACHE_CONTROL } from "@/lib/http/etag";

describe("GET /api/map/boundaries", () => {
  it("returns 200 with FeatureCollection and required Cache-Control and ETag headers", async () => {
    const req = new NextRequest("http://localhost:3000/api/map/boundaries");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(STATIC_GEOJSON_CACHE_CONTROL);
    expect(res.headers.get("Content-Type")).toContain("application/geo+json");
    expect(res.headers.get("ETag")).toMatch(/^"[a-f0-9]{64}"$/);

    const data = await res.json();
    expect(data.type).toBe("FeatureCollection");
    expect(data.features.length).toBe(STATIC_DISTRICT_BOUNDARIES.length);
  });

  it("returns 304 Not Modified immediately with empty body on matching If-None-Match", async () => {
    const initialReq = new NextRequest("http://localhost:3000/api/map/boundaries");
    const initialRes = await GET(initialReq);
    const etag = initialRes.headers.get("ETag")!;

    const conditionalReq = new NextRequest("http://localhost:3000/api/map/boundaries", {
      headers: {
        "If-None-Match": etag,
      },
    });

    const conditionalRes = await GET(conditionalReq);

    expect(conditionalRes.status).toBe(304);
    expect(conditionalRes.headers.get("Cache-Control")).toBe(STATIC_GEOJSON_CACHE_CONTROL);
    expect(conditionalRes.headers.get("ETag")).toBe(etag);

    const bodyText = await conditionalRes.text();
    expect(bodyText).toBe("");
  });

  it("filters features when city or district query parameters are provided", async () => {
    const req = new NextRequest("http://localhost:3000/api/map/boundaries?city=brooklyn");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.features.length).toBeGreaterThan(0);
    data.features.forEach((f: any) => {
      expect(f.properties.city.toLowerCase()).toBe("brooklyn");
    });
  });

  it("handles HEAD requests returning headers and empty body", async () => {
    const req = new NextRequest("http://localhost:3000/api/map/boundaries", {
      method: "HEAD",
    });
    const res = await HEAD(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(STATIC_GEOJSON_CACHE_CONTROL);
    expect(res.headers.get("ETag")).toBeTruthy();
    expect(await res.text()).toBe("");
  });
});
