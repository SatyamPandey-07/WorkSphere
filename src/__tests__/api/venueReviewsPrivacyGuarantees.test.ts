import { NextRequest } from "next/server";
import { GET, redactReviewPayload } from "@/app/api/venues/[venueId]/reviews/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

jest.mock("@clerk/nextjs/server", () => ({ auth: jest.fn() }));
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn().mockResolvedValue(true) }));
jest.mock("@/lib/prisma", () => ({
  prisma: { venue: { findFirst: jest.fn() }, venueRating: { findMany: jest.fn() } },
}));
jest.mock("@/lib/cache/swrCache", () => ({
  swrCache: jest.fn().mockImplementation((_k, fetcher) => fetcher()),
  getVenueReviewsCacheKey: jest.fn().mockReturnValue("k"),
}));

const row = (id: string) => ({
  id,
  userId: `u-${id}`,
  rating: 4,
  comment: "ok",
  user: { firstName: "Ada", lastName: "L" },
  replies: [{ id: `r-${id}`, userId: `ru-${id}`, text: "thanks" }],
});

const call = async (qs = "") => {
  const req = new NextRequest(`http://localhost:3000/api/venues/v1/reviews${qs}`);
  return GET(req, { params: Promise.resolve({ venueId: "v1" }) });
};

describe("Venue reviews privacy guarantees (#10424)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.venue.findFirst as jest.Mock).mockResolvedValue({ id: "v1" });
  });

  it("anonymous: no userId anywhere and user is null", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: null });
    (prisma.venueRating.findMany as jest.Mock).mockResolvedValue([row("a")]);
    const json = await (await call()).json();
    expect(JSON.stringify(json)).not.toContain("userId");
    expect(json.reviews[0].user).toBeNull();
    expect(json.reviews[0].replies[0].text).toBe("thanks");
  });

  it("authenticated: keeps userId and exposes only first and last name", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "me" });
    (prisma.venueRating.findMany as jest.Mock).mockResolvedValue([row("a")]);
    const json = await (await call()).json();
    expect(json.reviews[0].userId).toBe("u-a");
    expect(json.reviews[0].user).toEqual({ firstName: "Ada", lastName: "L" });
  });

  it("paginates with limit+1 and sets nextCursor/hasMore", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: null });
    (prisma.venueRating.findMany as jest.Mock).mockResolvedValue([row("a"), row("b"), row("c")]);
    const json = await (await call("?limit=2")).json();
    expect(json.reviews).toHaveLength(2);
    expect(json.hasMore).toBe(true);
    expect(json.nextCursor).toBe("b");
  });

  it("redactReviewPayload does not mutate its input", () => {
    const input = row("a");
    redactReviewPayload(input, true);
    expect(input.userId).toBe("u-a");
    expect(input.replies[0].userId).toBe("ru-a");
  });
});
