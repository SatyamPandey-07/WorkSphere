import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/venues/enrich/route";
import { rateLimit, getRateLimitInfo } from "@/lib/rateLimit";
import { searchAndEnrichVenues } from "@/lib/venues";

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
