import { NextRequest } from "next/server";
import { GET } from "@/app/api/venues/search/route";
import { searchVenuesPhonetic } from "@/lib/search/phoneticVenueSearch";
import { searchVenuesNearby } from "@/lib/search/spatialVenueSearch";

jest.mock("@/lib/cache/venueCache", () => ({
  getLatestVenueTimestamp: jest.fn().mockResolvedValue(1700000000000),
  generateETag: jest.fn().mockReturnValue('"1700000000000"'),
}));

jest.mock("@/lib/search/phoneticVenueSearch", () => ({
  searchVenuesPhonetic: jest.fn(),
}));

jest.mock("@/lib/search/spatialVenueSearch", () => ({
  DEFAULT_SEARCH_RADIUS_METERS: 5000,
  MAX_SEARCH_RADIUS_METERS: 100000,
  MAX_SPATIAL_RESULT_LIMIT: 50,
  searchVenuesNearby: jest.fn().mockResolvedValue([]),
}));

describe("GET /api/venues/search fuzzy name matching", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns a did-you-mean suggestion for a single-character venue typo", async () => {
    (searchVenuesPhonetic as jest.Mock).mockResolvedValue([
      {
        id: "venue-wework",
        name: "WeWork",
        description: "Coworking space",
        category: "COWORKING",
        score: 0.86,
      },
    ]);

    const request = new NextRequest(
      "https://example.test/api/venues/search?q=Wewrk",
    );
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results[0].name).toBe("WeWork");
    expect(body.suggestedQuery).toBe("WeWork");
    expect(body.notice).toBe("Did you mean: WeWork?");
  });

  it("suggests a correction for a misspelled multi-word venue name", async () => {
    (searchVenuesPhonetic as jest.Mock).mockResolvedValue([
      {
        id: "venue-spaces",
        name: "Spaces Coworking",
        description: "Flexible office",
        category: "COWORKING",
        score: 0.91,
      },
    ]);

    const request = new NextRequest(
      "https://example.test/api/venues/search?q=Spaces%20Cowrking",
    );
    const response = await GET(request);
    const body = await response.json();

    expect(body.suggestedQuery).toBe("Spaces Coworking");
  });

  it("does not return a correction when the query already matches a venue name", async () => {
    (searchVenuesPhonetic as jest.Mock).mockResolvedValue([
      {
        id: "venue-wework",
        name: "WeWork Downtown",
        description: "Coworking space",
        category: "COWORKING",
        score: 0.95,
      },
    ]);

    const request = new NextRequest(
      "https://example.test/api/venues/search?q=WeWork",
    );
    const response = await GET(request);
    const body = await response.json();

    expect(body.suggestedQuery).toBeUndefined();
  });

  it("rejects out-of-range coordinates before running spatial search", async () => {
    const request = new NextRequest(
      "https://example.test/api/venues/search?lat=91&lng=10",
    );
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(searchVenuesNearby).not.toHaveBeenCalled();
  });

  it("clamps oversized result limits to the spatial API maximum", async () => {
    (searchVenuesPhonetic as jest.Mock).mockResolvedValue([]);
    const request = new NextRequest(
      "https://example.test/api/venues/search?q=cafe&limit=500",
    );

    await GET(request);

    expect(searchVenuesPhonetic).toHaveBeenCalledWith("cafe", 50);
  });
});
