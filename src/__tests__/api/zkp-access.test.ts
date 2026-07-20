/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/venues/[venueId]/zkp-access/route";
import { prisma } from "@/lib/prisma";
import { proveMembership } from "@/lib/zkp/verify";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findUnique: jest.fn(),
    },
  },
}));

afterAll(async () => {
  const g = globalThis as typeof globalThis & {
    curve_bn128?: { terminate: () => Promise<void> };
  };
  if (g.curve_bn128) await g.curve_bn128.terminate();
});

describe("POST /api/venues/[venueId]/zkp-access", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("allows access when the proof verifies and commit is known", async () => {
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: "venue-1",
      category: "coworking_space",
      rating: 4.9,
    });

    const { proof, publicSignals } = await proveMembership(42);
    const req = new NextRequest("http://localhost/api/venues/venue-1/zkp-access", {
      method: "POST",
      body: JSON.stringify({ proof, publicSignals }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req, { params: Promise.resolve({ venueId: "venue-1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.allowed).toBe(true);
  }, 30000);

  it("does not accept identity tokens in the body schema", async () => {
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: "venue-1",
      category: "coworking_space",
      rating: 4.9,
    });

    const req = new NextRequest("http://localhost/api/venues/venue-1/zkp-access", {
      method: "POST",
      body: JSON.stringify({ identityToken: "42" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req, { params: Promise.resolve({ venueId: "venue-1" }) });
    expect(res.status).toBe(400);
  });
});
