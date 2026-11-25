import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/venues/enrich/route";
import { rateLimit, getRateLimitInfo } from "@/lib/rateLimit";
import { getVenueDetails, searchAndEnrichVenues } from "@/lib/venues";

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn(),
  getRateLimitInfo: jest.fn(),
}));

jest.mock("@/lib/venues", () => ({
  searchAndEnrichVenues: jest.fn(),
  getVenueDetails: jest.fn(),
}));

const mockedRateLimit = rateLimit as jest.MockedFunction<typeof rateLimit>;
const mockedInfo = getRateLimitInfo as jest.MockedFunction<
  typeof getRateLimitInfo
>;
const mockedSearch = searchAndEnrichVenues as jest.MockedFunction<
  typeof searchAndEnrichVenues
>;
const mockedGetVenueDetails = getVenueDetails as jest.MockedFunction<
  typeof getVenueDetails
>;

describe("/api/venues/enrich rate limiting", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedInfo.mockResolvedValue({
      count: 31,
      remaining: 0,
      resetTime: Date.now() + 60_000,
      isLimited: true,
    });
  });

  it("returns 429 and skips upstream work when the GET limit is exceeded", async () => {
    mockedRateLimit.mockResolvedValue(false);
    const req = new NextRequest(
      "https://app.test/api/venues/enrich?name=cafe&lat=1&lng=2",
    );

    const res = await GET(req);

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it("returns 429 and skips upstream work when the bulk POST limit is exceeded", async () => {
    mockedRateLimit.mockResolvedValue(false);
    const req = new NextRequest("https://app.test/api/venues/enrich", {
      method: "POST",
      body: JSON.stringify({ venues: [{ name: "cafe", lat: 1, lng: 2 }] }),
    });

    const res = await POST(req);

    expect(res.status).toBe(429);
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it("proceeds when under the limit", async () => {
    mockedRateLimit.mockResolvedValue(true);
    mockedSearch.mockResolvedValue([]);
    const req = new NextRequest(
      "https://app.test/api/venues/enrich?name=cafe&lat=1&lng=2",
    );

    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockedSearch).toHaveBeenCalled();
  });
});

describe("/api/venues/enrich coordinate and input validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRateLimit.mockResolvedValue(true);
    mockedSearch.mockResolvedValue([]);
    mockedGetVenueDetails.mockResolvedValue(null);
  });

  it.each([
    ["missing all query params", "https://app.test/api/venues/enrich"],
    [
      "empty name",
      "https://app.test/api/venues/enrich?name=%20%20&lat=10&lng=20",
    ],
    [
      "oversized name",
      `https://app.test/api/venues/enrich?name=${"a".repeat(201)}&lat=10&lng=20`,
    ],
    [
      "non-numeric coordinates",
      "https://app.test/api/venues/enrich?name=cafe&lat=invalid&lng=invalid",
    ],
    [
      "partially numeric coordinates (parseFloat trap)",
      "https://app.test/api/venues/enrich?name=cafe&lat=12.34abc&lng=20",
    ],
    [
      "hexadecimal literal",
      "https://app.test/api/venues/enrich?name=cafe&lat=0x10&lng=20",
    ],
    [
      "Infinity coordinate",
      "https://app.test/api/venues/enrich?name=cafe&lat=Infinity&lng=20",
    ],
    [
      "NaN coordinate",
      "https://app.test/api/venues/enrich?name=cafe&lat=10&lng=NaN",
    ],
    [
      "latitude above 90",
      "https://app.test/api/venues/enrich?name=cafe&lat=91&lng=0",
    ],
    [
      "latitude below -90",
      "https://app.test/api/venues/enrich?name=cafe&lat=-90.0001&lng=0",
    ],
    [
      "longitude above 180",
      "https://app.test/api/venues/enrich?name=cafe&lat=0&lng=181",
    ],
    [
      "longitude below -180",
      "https://app.test/api/venues/enrich?name=cafe&lat=0&lng=-180.0001",
    ],
  ])("GET returns 400 and skips enrichment for %s", async (_label, url) => {
    const res = await GET(new NextRequest(url));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(typeof json.error).toBe("string");
    expect(Array.isArray(json.details)).toBe(true);
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it.each([
    [-90, -180],
    [90, 180],
    [0, 0],
    [37.7749, -122.4194],
  ])(
    "GET accepts valid boundary coordinates (%s, %s)",
    async (expectedLat, expectedLng) => {
      const req = new NextRequest(
        `https://app.test/api/venues/enrich?name=Blue%20Bottle&lat=${expectedLat}&lng=${expectedLng}`,
      );

      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(mockedSearch).toHaveBeenCalledWith(expectedLat, expectedLng, {
        query: "Blue Bottle",
        radius: 2000,
        limit: 10,
      });
    },
  );

  it("GET validates oversized venueId before querying details", async () => {
    const res = await GET(
      new NextRequest(
        `https://app.test/api/venues/enrich?venueId=${"x".repeat(129)}`,
      ),
    );

    expect(res.status).toBe(400);
    expect(mockedGetVenueDetails).not.toHaveBeenCalled();
  });

  it("GET preserves direct venueId lookup when valid", async () => {
    mockedGetVenueDetails.mockResolvedValue({
      id: "osm-123",
      name: "Work Cafe",
      location: { lat: 12.9, lng: 77.5, formatted_address: "123 St" },
      categories: [{ name: "Café" }],
      photos: ["https://example.com/photo.jpg"],
    });

    const res = await GET(
      new NextRequest("https://app.test/api/venues/enrich?venueId=osm-123"),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.venueId).toBe("osm-123");
    expect(mockedGetVenueDetails).toHaveBeenCalledWith("osm-123");
  });

  it("POST rejects malformed JSON with 400", async () => {
    const req = new NextRequest("https://app.test/api/venues/enrich", {
      method: "POST",
      body: "{bad-json",
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it.each([
    ["empty array", { venues: [] }],
    ["missing venues field", {}],
    [
      "oversized batch over 10 venues",
      {
        venues: Array.from({ length: 11 }, (_, i) => ({
          name: `Cafe ${i}`,
          lat: 10,
          lng: 20,
        })),
      },
    ],
    ["null entry", { venues: [null] }],
    ["missing name", { venues: [{ name: "  ", lat: 10, lng: 20 }] }],
    ["string latitude", { venues: [{ name: "Cafe", lat: "10", lng: 20 }] }],
    [
      "out-of-range latitude",
      {
        venues: [
          { name: "Valid Cafe", lat: 10, lng: 20 },
          { name: "Bad Cafe", lat: 95, lng: 20 },
        ],
      },
    ],
    [
      "out-of-range longitude",
      { venues: [{ name: "Bad Cafe", lat: 10, lng: -185 }] },
    ],
  ])("POST returns 400 and skips enrichment for %s", async (_label, body) => {
    const req = new NextRequest("https://app.test/api/venues/enrich", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(typeof json.error).toBe("string");
    expect(Array.isArray(json.details)).toBe(true);
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it("POST rejects non-finite numeric coordinates before external calls", async () => {
    const req = {
      headers: new Headers(),
      json: async () => ({
        venues: [
          { name: "Cafe", lat: Number.NaN, lng: Number.POSITIVE_INFINITY },
        ],
      }),
    } as unknown as NextRequest;

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it("POST enriches valid bulk entries and preserves custom fields", async () => {
    mockedSearch.mockResolvedValue([
      {
        id: "osm-999",
        name: "Third Wave Coffee",
        location: { lat: 12.9716, lng: 77.5946 },
        categories: [{ name: "Café" }],
        photos: ["https://example.com/1.jpg"],
        amenities: { wifi: true },
        opening_hours: "08:00-22:00",
      },
    ]);

    const req = new NextRequest("https://app.test/api/venues/enrich", {
      method: "POST",
      body: JSON.stringify({
        venues: [
          {
            id: "client-1",
            name: "Third Wave Coffee",
            lat: 12.9716,
            lng: 77.5946,
          },
        ],
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockedSearch).toHaveBeenCalledTimes(1);
    expect(json.venues).toHaveLength(1);
    expect(json.venues[0]).toMatchObject({
      id: "client-1",
      name: "Third Wave Coffee",
      enriched: true,
      venueId: "osm-999",
    });
  });
});
