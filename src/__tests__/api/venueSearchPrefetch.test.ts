import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/venues/route";
import { trackEvent } from "@/lib/analytics";
import { rateLimit } from "@/lib/rateLimit";
import {
  scheduleTrendingVenueSearchPrefetch,
  searchVenuesWithRrf,
} from "@/lib/search/hybridVenueSearch";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/analytics", () => ({
  trackEvent: jest.fn(),
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockResolvedValue(true),
  getRateLimitInfo: jest
    .fn()
    .mockResolvedValue({ resetTime: Date.now() + 60_000 }),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
}));

jest.mock("@/lib/search/hybridVenueSearch", () => ({
  indexVenueSearchEmbedding: jest.fn(),
  labelFuzzySuggestions: jest.fn((venues) => venues),
  scheduleTrendingVenueSearchPrefetch: jest.fn(),
  searchVenuesWithRrf: jest
    .fn()
    .mockResolvedValue(Object.assign([], { fuzzyMatched: false })),
}));

jest.mock("@/lib/agents/VisionAgent", () => ({
  analyzeVenueImage: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  ensureUserExists: jest.fn(),
}));

jest.mock("@/lib/webhooks/deliver", () => ({
  emitWebhookEvent: jest.fn(),
}));

describe("GET /api/venues search prefetch and cache policy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth as jest.Mock).mockResolvedValue({ userId: null });
    (rateLimit as jest.Mock).mockResolvedValue(true);
    (searchVenuesWithRrf as jest.Mock).mockResolvedValue(
      Object.assign([], { fuzzyMatched: false }),
    );
  });

  it("sets the public CDN cache policy for anonymous text-only searches", async () => {
    const request = new NextRequest(
      "http://localhost/api/venues?q=Quiet%20Cafe",
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=300");
  });

  it("keeps authenticated and location-specific searches private", async () => {
    (auth as jest.Mock).mockResolvedValueOnce({ userId: "user-1" });
    const authenticated = await GET(
      new NextRequest("http://localhost/api/venues?q=coffee"),
    );
    expect(authenticated.headers.get("Cache-Control")).toBe(
      "private, no-store, max-age=0, must-revalidate",
    );

    (auth as jest.Mock).mockResolvedValueOnce({ userId: null });
    const locationSearch = await GET(
      new NextRequest(
        "http://localhost/api/venues?lat=37.7&lng=-122.4&radius=1000&query=coffee",
      ),
    );
    expect(locationSearch.headers.get("Cache-Control")).toBe(
      "private, no-store, max-age=0, must-revalidate",
    );

    const cookieSearch = await GET(
      new NextRequest("http://localhost/api/venues?q=coffee", {
        headers: { cookie: "user_location=37.7%2C-122.4" },
      }),
    );
    expect(cookieSearch.headers.get("Cache-Control")).toBe(
      "private, no-store, max-age=0, must-revalidate",
    );

    const unrelatedCookieSearch = await GET(
      new NextRequest("http://localhost/api/venues?q=coffee", {
        headers: { cookie: "worksphere-theme=dark" },
      }),
    );
    expect(unrelatedCookieSearch.headers.get("Cache-Control")).toBe(
      "private, no-store, max-age=0, must-revalidate",
    );

    const authorizationSearch = await GET(
      new NextRequest("http://localhost/api/venues?q=coffee", {
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(authorizationSearch.headers.get("Cache-Control")).toBe(
      "private, no-store, max-age=0, must-revalidate",
    );
  });

  it("records normalized real queries and requests asynchronous cache warming", async () => {
    await GET(
      new NextRequest("http://localhost/api/venues?q=%20Quiet%20%20Cafe%20"),
    );

    expect(trackEvent).toHaveBeenCalledWith("search_performed", {
      query: "quiet cafe",
    });
    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(scheduleTrendingVenueSearchPrefetch).toHaveBeenCalledTimes(1);
    expect(searchVenuesWithRrf).toHaveBeenCalledTimes(1);
  });

  it("records the validated coordinate search once, including the q alias", async () => {
    await GET(
      new NextRequest(
        "http://localhost/api/venues?lat=37.7&lng=-122.4&radius=1000&q=Coffee",
      ),
    );

    expect(trackEvent).toHaveBeenCalledWith("search_performed", {
      query: "coffee",
    });
    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(scheduleTrendingVenueSearchPrefetch).toHaveBeenCalledTimes(1);
    expect(searchVenuesWithRrf).toHaveBeenCalledTimes(1);
  });

  it("keeps pagination in the public cache key and response policy", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/venues?q=coffee&page=2&limit=5"),
    );

    expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=300");
  });

  it("does not apply a public search cache policy when no query is present", async () => {
    const response = await GET(new NextRequest("http://localhost/api/venues"));

    expect(response.headers.get("Cache-Control")).toBeNull();
    expect(trackEvent).not.toHaveBeenCalled();
    expect(scheduleTrendingVenueSearchPrefetch).not.toHaveBeenCalled();
  });
});
