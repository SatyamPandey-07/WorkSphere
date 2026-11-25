/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findFirst: jest.fn(),
    },
    venueCheckInNullifier: {
      create: jest.fn(),
    },
  },
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn(),
}));

jest.mock("@/lib/crypto/zkNullifierVerifier", () => {
  const actual = jest.requireActual("@/lib/crypto/zkNullifierVerifier");
  return {
    ...actual,
    verifyZkNullifierProofs: jest.fn(),
  };
});

import { POST } from "@/app/api/venues/batch-zkp-verify/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { verifyZkNullifierProofs } from "@/lib/crypto/zkNullifierVerifier";

const mockAuth = auth as unknown as jest.Mock;
const mockRateLimit = rateLimit as jest.Mock;
const mockVerifyZkNullifierProofs = verifyZkNullifierProofs as jest.Mock;

function makeRequest(body: unknown, ip = "127.0.0.1"): NextRequest {
  return new NextRequest("http://localhost:3000/api/venues/batch-zkp-verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

const SAMPLE_PROOF = {
  pi_a: ["100", "200", "1"],
  pi_b: [
    ["300", "400"],
    ["500", "600"],
    ["1", "0"],
  ],
  pi_c: ["700", "800", "1"],
  protocol: "groth16",
  curve: "bn128",
};

describe("POST /api/venues/batch-zkp-verify (Issue #8915)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRateLimit.mockResolvedValue(true);
    mockAuth.mockResolvedValue({
      userId: "user-mgr-1",
      sessionClaims: { metadata: { role: "venue_manager" } },
    });
    (prisma.venue.findFirst as jest.Mock).mockResolvedValue({
      id: "venue-101",
      name: "Coworking Space Alpha",
      ownerId: "user-mgr-1",
      creatorId: "user-mgr-1",
    });
  });

  describe("1. Authentication & Venue Authorization", () => {
    it("returns 401 Unauthorized when unauthenticated", async () => {
      mockAuth.mockResolvedValue({ userId: null });
      const req = makeRequest({ venueId: "venue-101", proofs: [] });
      const res = await POST(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 404 Venue not found when venue does not exist", async () => {
      (prisma.venue.findFirst as jest.Mock).mockResolvedValue(null);
      const req = makeRequest({
        venueId: "nonexistent-venue",
        proofs: [
          {
            ticketId: "t-1",
            proof: SAMPLE_PROOF,
            publicSignals: ["root-1", "null-1", "nonexistent-venue", "2026"],
          },
        ],
      });
      const res = await POST(req);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("Venue not found.");
    });

    it("returns 403 Forbidden when caller is not owner or venue manager", async () => {
      mockAuth.mockResolvedValue({
        userId: "unauthorized-user",
        sessionClaims: { metadata: { role: "member" } },
      });
      (prisma.venue.findFirst as jest.Mock).mockResolvedValue({
        id: "venue-101",
        name: "Coworking Space Alpha",
        ownerId: "other-user",
        creatorId: "other-user",
      });
      const req = makeRequest({
        venueId: "venue-101",
        proofs: [
          {
            ticketId: "t-1",
            proof: SAMPLE_PROOF,
            publicSignals: ["root-1", "null-1", "venue-101", "2026"],
          },
        ],
      });
      const res = await POST(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Forbidden");
    });
  });

  describe("2. Rate Limiting", () => {
    it("returns 429 when rate limit is exceeded", async () => {
      mockRateLimit.mockResolvedValue(false);
      const req = makeRequest({
        venueId: "venue-101",
        proofs: [
          {
            ticketId: "t-1",
            proof: SAMPLE_PROOF,
            publicSignals: ["root-1", "null-1", "venue-101", "2026"],
          },
        ],
      });
      const res = await POST(req);
      expect(res.status).toBe(429);
      const data = await res.json();
      expect(data.error).toBe("Too many requests. Please try again later.");
    });
  });

  describe("3. Batch Size Limits (1 to 20)", () => {
    it("rejects empty proofs array with 400", async () => {
      const req = makeRequest({ venueId: "venue-101", proofs: [] });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Validation failed.");
    });

    it("rejects batch exceeding 20 proofs with 400", async () => {
      const proofs = Array.from({ length: 21 }, (_, i) => ({
        ticketId: `ticket-${i + 1}`,
        proof: SAMPLE_PROOF,
        publicSignals: ["root-1", `null-${i + 1}`, "venue-101", "2026"],
      }));
      const req = makeRequest({ venueId: "venue-101", proofs });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Validation failed.");
    });

    it("accepts a batch of exactly 20 proofs", async () => {
      const proofs = Array.from({ length: 20 }, (_, i) => ({
        ticketId: `ticket-${i + 1}`,
        proof: SAMPLE_PROOF,
        publicSignals: ["root-1", `null-${i + 1}`, "venue-101", "2026"],
      }));
      mockVerifyZkNullifierProofs.mockResolvedValue(
        proofs.map(() => ({ valid: true })),
      );
      (prisma.venueCheckInNullifier.create as jest.Mock).mockResolvedValue({
        id: "cuid-1",
      });

      const req = makeRequest({ venueId: "venue-101", proofs });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.summary.total).toBe(20);
      expect(data.summary.verified).toBe(20);
      expect(data.summary.consumed).toBe(20);
      expect(data.results).toHaveLength(20);
    });
  });

  describe("4. Partial Success & Per-Ticket Outcomes", () => {
    it("handles mixed valid, invalid, duplicate, and replayed proofs with per-ticket status", async () => {
      const proofs = [
        // 0: Valid proof, unconsumed -> should be verified & consumed
        {
          ticketId: "ticket-valid",
          proof: SAMPLE_PROOF,
          publicSignals: ["root-1", "null-valid-1", "venue-101", "2026"],
        },
        // 1: Invalid cryptographic proof -> invalid_proof
        {
          ticketId: "ticket-crypto-fail",
          proof: SAMPLE_PROOF,
          publicSignals: ["root-1", "null-bad-crypto", "venue-101", "2026"],
        },
        // 2: Duplicate nullifier in same batch -> duplicate_in_batch
        {
          ticketId: "ticket-dup-in-batch",
          proof: SAMPLE_PROOF,
          publicSignals: ["root-1", "null-valid-1", "venue-101", "2026"],
        },
        // 3: Invalid public signals (wrong venue) -> invalid_payload
        {
          ticketId: "ticket-wrong-venue",
          proof: SAMPLE_PROOF,
          publicSignals: ["root-1", "null-wrong-venue", "other-venue", "2026"],
        },
        // 4: Already consumed in DB (unique constraint error) -> already_consumed
        {
          ticketId: "ticket-already-spent",
          proof: SAMPLE_PROOF,
          publicSignals: ["root-1", "null-spent", "venue-101", "2026"],
        },
      ];

      // Cryptographic verification result mocks (for items [0, 1, 2, 4] that passed structural validation)
      mockVerifyZkNullifierProofs.mockResolvedValue([
        { valid: true }, // ticket-valid
        { valid: false }, // ticket-crypto-fail
        { valid: true }, // ticket-dup-in-batch
        { valid: true }, // ticket-already-spent
      ]);

      // DB insert mock
      (prisma.venueCheckInNullifier.create as jest.Mock).mockImplementation(
        async ({ data }: { data: { nullifierHash: string } }) => {
          if (data.nullifierHash === "null-spent") {
            const err = new Error("Unique constraint failed");
            (err as any).code = "P2002";
            throw err;
          }
          return { id: "cuid-ok" };
        },
      );

      const req = makeRequest({ venueId: "venue-101", proofs });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.summary).toEqual({
        total: 5,
        verified: 3, // ticket-valid, ticket-dup-in-batch, ticket-already-spent
        consumed: 1, // ticket-valid
        rejected: 4,
      });

      expect(data.results[0]).toMatchObject({
        ticketId: "ticket-valid",
        valid: true,
        consumed: true,
        status: "verified",
      });

      expect(data.results[1]).toMatchObject({
        ticketId: "ticket-crypto-fail",
        valid: false,
        consumed: false,
        status: "invalid_proof",
      });

      expect(data.results[2]).toMatchObject({
        ticketId: "ticket-dup-in-batch",
        valid: true,
        consumed: false,
        status: "duplicate_in_batch",
      });

      expect(data.results[3]).toMatchObject({
        ticketId: "ticket-wrong-venue",
        valid: false,
        consumed: false,
        status: "invalid_payload",
      });

      expect(data.results[4]).toMatchObject({
        ticketId: "ticket-already-spent",
        valid: true,
        consumed: false,
        status: "already_consumed",
      });
    });
  });

  describe("5. Concurrency & Replay Protection", () => {
    it("ensures duplicate concurrent nullifier submissions produce at most one success", async () => {
      mockVerifyZkNullifierProofs.mockResolvedValue([{ valid: true }]);

      let alreadyClaimed = false;
      (prisma.venueCheckInNullifier.create as jest.Mock).mockImplementation(
        async () => {
          if (alreadyClaimed) {
            const err = new Error("Unique constraint failed");
            (err as any).code = "P2002";
            throw err;
          }
          alreadyClaimed = true;
          return { id: "cuid-first" };
        },
      );

      const payload = {
        venueId: "venue-101",
        proofs: [
          {
            ticketId: "race-ticket-1",
            proof: SAMPLE_PROOF,
            publicSignals: ["root-1", "null-race-1", "venue-101", "2026"],
          },
        ],
      };

      const [res1, res2] = await Promise.all([
        POST(makeRequest(payload)),
        POST(makeRequest(payload)),
      ]);

      const data1 = await res1.json();
      const data2 = await res2.json();

      const consumedCount =
        (data1.results[0].consumed ? 1 : 0) +
        (data2.results[0].consumed ? 1 : 0);

      expect(consumedCount).toBe(1);
      const statuses = [data1.results[0].status, data2.results[0].status];
      expect(statuses).toContain("verified");
      expect(statuses).toContain("already_consumed");
    });
  });
});
