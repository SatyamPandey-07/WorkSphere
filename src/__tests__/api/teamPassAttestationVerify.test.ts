import { NextRequest } from "next/server";
import { POST } from "@/app/api/venues/[venueId]/team-pass/attestations/verify/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import {
  createTeamPassAttestationSignature,
  type TeamPassAttestationPayload,
} from "@/lib/security/teamPassAttestation";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: { findFirst: jest.fn() },
    teamPassAttestationNonce: { create: jest.fn() },
  },
}));

const mockedAuth = auth as jest.Mock;
const mockedPrisma = prisma as unknown as {
  venue: { findFirst: jest.Mock };
  teamPassAttestationNonce: { create: jest.Mock };
};

const SECRET = "test-secret-that-is-at-least-32-characters";
const NOW = Date.now();

function makeAttestation(overrides: Partial<TeamPassAttestationPayload> = {}) {
  const payload: TeamPassAttestationPayload = {
    attestationId: "att-1",
    venueId: "venue-1",
    memberId: "member-1",
    nonce: "nonce-" + Math.random(),
    issuedAt: new Date(NOW - 60_000).toISOString(),
    expiresAt: new Date(NOW + 60_000).toISOString(),
    ...overrides,
  };

  return {
    payload,
    signature: createTeamPassAttestationSignature(payload, SECRET),
  };
}

function makeRequest(attestations: unknown[]) {
  return new NextRequest(
    "https://app.test/api/venues/venue-1/team-pass/attestations/verify",
    {
      method: "POST",
      body: JSON.stringify({ attestations }),
    },
  );
}

async function verify(attestations: unknown[]) {
  return POST(makeRequest(attestations), {
    params: Promise.resolve({ venueId: "venue-1" }),
  });
}

describe("Batch team-pass attestation verification (#10241)", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    process.env.TEAM_PASS_ATTESTATION_SECRET = SECRET;

    mockedAuth.mockResolvedValue({
      userId: "user-1",
      sessionClaims: { metadata: { role: "manager" } },
    });

    mockedPrisma.venue.findFirst.mockResolvedValue({
      id: "venue-1",
      ownerId: "user-1",
      creatorId: null,
    });

    mockedPrisma.teamPassAttestationNonce.create.mockResolvedValue({
      id: "nonce-record-1",
    });
  });

  afterAll(() => {
    delete process.env.TEAM_PASS_ATTESTATION_SECRET;
  });

  it("accepts a valid signed attestation", async () => {
    const res = await verify([makeAttestation()]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.verified).toBe(1);
    expect(json.verifiedCount).toBe(1);
    expect(json.failedCount).toBe(0);
    expect(json.total).toBe(1);
    expect(json.results[0].status).toBe("verified");
  });

  it("returns verified and failed counts for mixed batch results", async () => {
    const valid = makeAttestation();
    const expired = makeAttestation({
      expiresAt: new Date(NOW - 1000).toISOString(),
    });

    const tampered = makeAttestation();
    tampered.signature = "invalid-signature";

    const res = await verify([valid, expired, tampered]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.total).toBe(3);
    expect(json.verifiedCount).toBe(1);
    expect(json.failedCount).toBe(2);
    expect(json.verified).toBe(1);
    expect(json.results).toHaveLength(3);
  });

  it("rejects an expired attestation", async () => {
    const attestation = makeAttestation({
      expiresAt: new Date(NOW - 1000).toISOString(),
    });

    const res = await verify([attestation]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.results[0].status).toBe("expired");
    expect(mockedPrisma.teamPassAttestationNonce.create).not.toHaveBeenCalled();
  });

  it("rejects a tampered attestation signature", async () => {
    const attestation = makeAttestation();

    attestation.payload.memberId = "tampered-member";

    const res = await verify([attestation]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.results[0].status).toBe("invalid_signature");
  });

  it("rejects a replayed nonce", async () => {
    mockedPrisma.teamPassAttestationNonce.create.mockRejectedValue({
      code: "P2002",
    });

    const res = await verify([makeAttestation()]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.results[0].status).toBe("replayed");
  });

  it("rejects batches containing more than 50 attestations", async () => {
    const attestations = Array.from({ length: 51 }, () => makeAttestation());

    const res = await verify(attestations);

    expect(res.status).toBe(400);
  });
});
