import { POST } from "@/app/api/venues/[venueId]/flag/route";
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { rateLimit } from "@/lib/rateLimit";
import { prisma } from "@/lib/prisma";

// Mock Clerk auth
jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn().mockResolvedValue({ userId: "user-123" }),
}));

// Mock rateLimit — returns true (allowed) by default
jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockResolvedValue(true),
}));

// Mock Prisma
jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findUnique: jest.fn().mockResolvedValue({ id: "venue-123" }),
    },
    flaggedItem: {
      findFirst: jest.fn().mockResolvedValue(null), // no duplicate
      create: jest.fn().mockResolvedValue({ id: "flag-1" }),
    },
  },
}));

function makeRequest(
  venueId: string,
  body: Record<string, unknown>,
): NextRequest {
  return new NextRequest(`http://localhost/api/venues/${venueId}/flag`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/venues/[venueId]/flag", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 200 when a valid flag is submitted", async () => {
    const response = await POST(
      makeRequest("venue-123", { reason: "permanently_closed" }),
      { params: Promise.resolve({ venueId: "venue-123" }) },
    );
    expect(response.status).toBe(200);
  });

  it("returns 400 when reason is whitespace-only or fewer than 5 non-whitespace characters", async () => {
    for (const badReason of ["", "     ", "\t\n  ", "  a b  "]) {
      const response = await POST(
        makeRequest("venue-123", { reason: badReason, details: "   " }),
        { params: Promise.resolve({ venueId: "venue-123" }) },
      );
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe(
        "Reason must contain at least 5 non-whitespace characters",
      );
    }
    expect(prisma.flaggedItem.create).not.toHaveBeenCalled();
  });

  it("trims leading and trailing whitespace from reason and details before database insertion", async () => {
    const response = await POST(
      makeRequest("venue-123", {
        reason: "  permanently_closed  ",
        details: "   Doors locked with notice on window   ",
      }),
      { params: Promise.resolve({ venueId: "venue-123" }) },
    );
    expect(response.status).toBe(200);
    expect(prisma.flaggedItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "VENUE",
        itemId: "venue-123",
        reason: "permanently_closed",
        details: "Doors locked with notice on window",
        reportedById: "user-123",
      }),
    });
  });

  it("returns 400 for an invalid reason", async () => {
    const response = await POST(
      makeRequest("venue-123", { reason: "invalid_reason" }),
      { params: Promise.resolve({ venueId: "venue-123" }) },
    );
    expect(response.status).toBe(400);
  });

  it("returns 401 when user is not authenticated", async () => {
    (auth as unknown as jest.Mock).mockResolvedValueOnce({ userId: null });

    const response = await POST(
      makeRequest("venue-123", { reason: "wrong_hours" }),
      { params: Promise.resolve({ venueId: "venue-123" }) },
    );
    expect(response.status).toBe(401);
  });

  it("returns 429 when rate limit is exceeded", async () => {
    (rateLimit as unknown as jest.Mock).mockResolvedValueOnce(false);

    const response = await POST(
      makeRequest("venue-123", { reason: "no_wifi" }),
      { params: Promise.resolve({ venueId: "venue-123" }) },
    );
    expect(response.status).toBe(429);
  });

  it("returns 404 when venue does not exist", async () => {
    (prisma.venue.findUnique as unknown as jest.Mock).mockResolvedValueOnce(
      null,
    );

    const response = await POST(
      makeRequest("nonexistent", { reason: "permanently_closed" }),
      { params: Promise.resolve({ venueId: "nonexistent" }) },
    );
    expect(response.status).toBe(404);
  });

  it("returns 200 (deduplicated) when flag already exists", async () => {
    (
      prisma.flaggedItem.findFirst as unknown as jest.Mock
    ).mockResolvedValueOnce({ id: "existing-flag" });

    const response = await POST(
      makeRequest("venue-123", { reason: "permanently_closed" }),
      { params: Promise.resolve({ venueId: "venue-123" }) },
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.message).toMatch(/already reported/i);
  });
});
