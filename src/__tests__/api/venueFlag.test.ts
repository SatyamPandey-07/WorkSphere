import { POST } from "@/app/api/venues/[venueId]/flag/route";
import { NextRequest } from "next/server";

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

function makeRequest(venueId: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(
    `http://localhost/api/venues/${venueId}/flag`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /api/venues/[venueId]/flag", () => {
  it("returns 200 when a valid flag is submitted", async () => {
    const response = await POST(
      makeRequest("venue-123", { reason: "permanently_closed" }),
      { params: Promise.resolve({ venueId: "venue-123" }) },
    );
    expect(response.status).toBe(200);
  });

  it("returns 400 for an invalid reason", async () => {
    const response = await POST(
      makeRequest("venue-123", { reason: "invalid_reason" }),
      { params: Promise.resolve({ venueId: "venue-123" }) },
    );
    expect(response.status).toBe(400);
  });

  it("returns 401 when user is not authenticated", async () => {
    const { auth } = require("@clerk/nextjs/server");
    auth.mockResolvedValueOnce({ userId: null });

    const response = await POST(
      makeRequest("venue-123", { reason: "wrong_hours" }),
      { params: Promise.resolve({ venueId: "venue-123" }) },
    );
    expect(response.status).toBe(401);
  });

  it("returns 429 when rate limit is exceeded", async () => {
    const { rateLimit } = require("@/lib/rateLimit");
    rateLimit.mockResolvedValueOnce(false);

    const response = await POST(
      makeRequest("venue-123", { reason: "no_wifi" }),
      { params: Promise.resolve({ venueId: "venue-123" }) },
    );
    expect(response.status).toBe(429);
  });

  it("returns 404 when venue does not exist", async () => {
    const { prisma } = require("@/lib/prisma");
    prisma.venue.findUnique.mockResolvedValueOnce(null);

    const response = await POST(
      makeRequest("nonexistent", { reason: "permanently_closed" }),
      { params: Promise.resolve({ venueId: "nonexistent" }) },
    );
    expect(response.status).toBe(404);
  });

  it("returns 200 (deduplicated) when flag already exists", async () => {
    const { prisma } = require("@/lib/prisma");
    prisma.flaggedItem.findFirst.mockResolvedValueOnce({ id: "existing-flag" });

    const response = await POST(
      makeRequest("venue-123", { reason: "permanently_closed" }),
      { params: Promise.resolve({ venueId: "venue-123" }) },
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.message).toMatch(/already reported/i);
  });
});
