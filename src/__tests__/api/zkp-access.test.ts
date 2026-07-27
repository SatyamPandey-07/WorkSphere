/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/venues/[venueId]/zkp-access/route";
import { prisma } from "@/lib/prisma";
import { proveMembership } from "@/lib/zkp/verify";
import {
  issueVenueAccessToken,
  verifyVenueAccessToken,
} from "@/lib/zkp/venueAccessToken";

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

  it("allows access and returns a signed token when proof verifies", async () => {
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: "venue-1",
      category: "coworking_space",
      rating: 4.9,
    });

    const { proof, publicSignals } = await proveMembership(42);
    const req = new NextRequest(
      "http://localhost/api/venues/venue-1/zkp-access",
      {
        method: "POST",
        body: JSON.stringify({ proof, publicSignals }),
        headers: { "Content-Type": "application/json" },
      },
    );

    const res = await POST(req, {
      params: Promise.resolve({ venueId: "venue-1" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.allowed).toBe(true);
    expect(data.accessToken).toBeDefined();
    expect(typeof data.accessToken).toBe("string");

    const decoded = verifyVenueAccessToken(data.accessToken);
    expect(decoded).not.toBeNull();
    expect(decoded!.venueId).toBe("venue-1");
    expect(decoded!.commitment).toBe(publicSignals[0]);
  }, 30000);

  it("does not accept identity tokens in the body schema", async () => {
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: "venue-1",
      category: "coworking_space",
      rating: 4.9,
    });

    const req = new NextRequest(
      "http://localhost/api/venues/venue-1/zkp-access",
      {
        method: "POST",
        body: JSON.stringify({ identityToken: "42" }),
        headers: { "Content-Type": "application/json" },
      },
    );

    const res = await POST(req, {
      params: Promise.resolve({ venueId: "venue-1" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent venue", async () => {
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest(
      "http://localhost/api/venues/nonexistent/zkp-access",
      {
        method: "POST",
        body: JSON.stringify({
          proof: { pi_a: ["1", "2"], pi_b: [["3", "4"], ["5", "6"]], pi_c: ["7", "8"] },
          publicSignals: ["999"],
        }),
        headers: { "Content-Type": "application/json" },
      },
    );

    const res = await POST(req, {
      params: Promise.resolve({ venueId: "nonexistent" }),
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Venue not found.");
  });

  it("returns 400 for non-premium venue", async () => {
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: "venue-cafe",
      category: "cafe",
      rating: 3.0,
    });

    const req = new NextRequest(
      "http://localhost/api/venues/venue-cafe/zkp-access",
      {
        method: "POST",
        body: JSON.stringify({
          proof: { pi_a: ["1", "2"], pi_b: [["3", "4"], ["5", "6"]], pi_c: ["7", "8"] },
          publicSignals: ["999"],
        }),
        headers: { "Content-Type": "application/json" },
      },
    );

    const res = await POST(req, {
      params: Promise.resolve({ venueId: "venue-cafe" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("does not require premium ZKP access");
  });

  it("returns 403 for unknown commitment", async () => {
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: "venue-1",
      category: "coworking_space",
      rating: 4.9,
    });

    const req = new NextRequest(
      "http://localhost/api/venues/venue-1/zkp-access",
      {
        method: "POST",
        body: JSON.stringify({
          proof: { pi_a: ["1", "2"], pi_b: [["3", "4"], ["5", "6"]], pi_c: ["7", "8"] },
          publicSignals: ["999999"],
        }),
        headers: { "Content-Type": "application/json" },
      },
    );

    const res = await POST(req, {
      params: Promise.resolve({ venueId: "venue-1" }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.allowed).toBe(false);
    expect(data.error).toContain("not a known member");
  });

  it("denies access when the commitment has been revoked (with witness)", async () => {
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: "venue-1",
      category: "coworking_space",
      rating: 4.9,
    });

    const { proof, publicSignals } = await proveMembership(12345678);
    const { generateWitness } = await import("@/lib/zkp/revocation");
    const commit = publicSignals[0];
    const witness = generateWitness(commit);

    const req = new NextRequest(
      "http://localhost/api/venues/venue-1/zkp-access",
      {
        method: "POST",
        body: JSON.stringify({ proof, publicSignals, witness }),
        headers: { "Content-Type": "application/json" },
      },
    );

    const res = await POST(req, {
      params: Promise.resolve({ venueId: "venue-1" }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.allowed).toBe(false);
    expect(data.error).toBe("Commitment has been revoked.");
  }, 30000);

  it("denies access for revoked commitment without witness (server-side check)", async () => {
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: "venue-1",
      category: "coworking_space",
      rating: 4.9,
    });

    // Token 12345678 has commitment 152415827008091 which is in REVOKED_CREDENTIAL_HASHES
    const { proof, publicSignals } = await proveMembership(12345678);

    const req = new NextRequest(
      "http://localhost/api/venues/venue-1/zkp-access",
      {
        method: "POST",
        body: JSON.stringify({ proof, publicSignals }),
        headers: { "Content-Type": "application/json" },
      },
    );

    const res = await POST(req, {
      params: Promise.resolve({ venueId: "venue-1" }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.allowed).toBe(false);
    expect(data.error).toBe("Commitment has been revoked.");
  }, 30000);
});

describe("venueAccessToken", () => {
  it("issues and verifies a valid token", () => {
    const token = issueVenueAccessToken("venue-abc", "commit123");
    const payload = verifyVenueAccessToken(token);

    expect(payload).not.toBeNull();
    expect(payload!.venueId).toBe("venue-abc");
    expect(payload!.commitment).toBe("commit123");
    expect(payload!.expiresAt).toBeGreaterThan(Date.now());
  });

  it("rejects a tampered token", () => {
    const token = issueVenueAccessToken("venue-abc", "commit123");
    const parts = token.split(".");
    parts[0] = Buffer.from(
      JSON.stringify({ venueId: "hacked", commitment: "x" }),
    ).toString("base64url");
    const tampered = parts.join(".");

    expect(verifyVenueAccessToken(tampered)).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = issueVenueAccessToken("venue-abc", "commit123");
    const parts = token.split(".");
    const payload = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf-8"),
    );
    payload.expiresAt = Date.now() - 1000;
    parts[0] = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const expired = parts.join(".");

    expect(verifyVenueAccessToken(expired)).toBeNull();
  });

  it("rejects a malformed token", () => {
    expect(verifyVenueAccessToken("not-a-token")).toBeNull();
    expect(verifyVenueAccessToken("a.b")).toBeNull();
    expect(verifyVenueAccessToken("")).toBeNull();
  });

  it("rejects a token with a short signature (no timingSafeEqual crash)", () => {
    const token = issueVenueAccessToken("venue-abc", "commit123");
    const parts = token.split(".");
    parts[2] = "short";
    const tampered = parts.join(".");
    expect(verifyVenueAccessToken(tampered)).toBeNull();
  });
});
