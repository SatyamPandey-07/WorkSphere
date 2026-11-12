/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venueCheckInNullifier: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("@/lib/redis", () => ({
  getRedis: jest.fn(),
}));

jest.mock("snarkjs", () => ({
  groth16: {
    verify: jest.fn(),
  },
}));

import { POST } from "@/app/api/auth/zkp/verify-nullifier/route";
import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import {
  issueAnonymousCheckInToken,
  verifyAnonymousCheckInToken,
} from "@/lib/zkp/venueAccessToken";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const snarkjs = require("snarkjs");

const VALID_PROOF = {
  pi_a: ["1000", "2000", "1"],
  pi_b: [
    ["3000", "4000"],
    ["5000", "6000"],
    ["1", "0"],
  ],
  pi_c: ["7000", "8000", "1"],
  protocol: "groth16",
  curve: "bn128",
};

const PUBLIC_SIGNALS = [
  "1849102948102938401928401928401928401928401928401928401928401928",
  "9876543210987654321098765432109876543210987654321098765432109876",
  "venue-1",
  "2026",
];

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    "http://localhost/api/auth/zkp/verify-nullifier",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    },
  );
}

describe("POST /api/auth/zkp/verify-nullifier", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getRedis as jest.Mock).mockReturnValue(null);
    (snarkjs.groth16.verify as jest.Mock).mockResolvedValue(true);
    (
      prisma.venueCheckInNullifier.create as jest.Mock
    ).mockResolvedValue({ id: "nullifier-1" });
  });

  it("verifies a valid Groth16 proof, logs the nullifier, and issues a token", async () => {
    const res = await POST(
      makeRequest({ proof: VALID_PROOF, publicSignals: PUBLIC_SIGNALS }),
    );

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.verified).toBe(true);
    expect(data.venueId).toBe("venue-1");
    expect(data.epoch).toBe(2026);
    expect(data.nullifierHash).toBe(PUBLIC_SIGNALS[1]);
    expect(typeof data.accessToken).toBe("string");

    expect(snarkjs.groth16.verify).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: "groth16", nPublic: 1 }),
      PUBLIC_SIGNALS,
      expect.objectContaining({ pi_a: VALID_PROOF.pi_a }),
    );

    expect(prisma.venueCheckInNullifier.create).toHaveBeenCalledWith({
      data: {
        nullifierHash: PUBLIC_SIGNALS[1],
        epoch: 2026,
        venueId: "venue-1",
      },
    });

    const payload = verifyAnonymousCheckInToken(data.accessToken);
    expect(payload).not.toBeNull();
    expect(payload!.scope).toBe("venue-checkin");
    expect(payload!.venueId).toBe("venue-1");
    expect(payload!.nullifierHash).toBe(PUBLIC_SIGNALS[1]);
    expect(payload!.epoch).toBe(2026);
    expect(payload!.expiresAt).toBeGreaterThan(Date.now());
  });

  it("returns 409 when the same nullifier is submitted twice in the same epoch", async () => {
    (
      prisma.venueCheckInNullifier.create as jest.Mock
    ).mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    const res = await POST(
      makeRequest({ proof: VALID_PROOF, publicSignals: PUBLIC_SIGNALS }),
    );

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.code).toBe("NULLIFIER_ALREADY_SPENT");
  });

  it("returns 409 when Redis reports the nullifier as already claimed", async () => {
    const redis = {
      set: jest.fn().mockResolvedValueOnce("OK").mockResolvedValueOnce(null),
      exists: jest.fn(),
    };
    (getRedis as jest.Mock).mockReturnValue(redis);

    const first = await POST(
      makeRequest({ proof: VALID_PROOF, publicSignals: PUBLIC_SIGNALS }),
    );
    expect(first.status).toBe(200);

    const second = await POST(
      makeRequest({ proof: VALID_PROOF, publicSignals: PUBLIC_SIGNALS }),
    );
    expect(second.status).toBe(409);
    const data = await second.json();
    expect(data.code).toBe("NULLIFIER_ALREADY_SPENT");

    expect(redis.set).toHaveBeenCalledTimes(2);
    expect(prisma.venueCheckInNullifier.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid proof with 400 and does not record the nullifier", async () => {
    (snarkjs.groth16.verify as jest.Mock).mockResolvedValue(false);

    const res = await POST(
      makeRequest({ proof: VALID_PROOF, publicSignals: PUBLIC_SIGNALS }),
    );

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(prisma.venueCheckInNullifier.create).not.toHaveBeenCalled();
  });

  it("rejects manipulated public signals with 400", async () => {
    const manipulated = [...PUBLIC_SIGNALS];
    manipulated[1] = "1";
    (snarkjs.groth16.verify as jest.Mock).mockResolvedValue(false);

    const res = await POST(
      makeRequest({ proof: VALID_PROOF, publicSignals: manipulated }),
    );

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(prisma.venueCheckInNullifier.create).not.toHaveBeenCalled();
  });

  it("returns 400 when the proof is malformed", async () => {
    (snarkjs.groth16.verify as jest.Mock).mockRejectedValue(
      new Error("Malformed proof"),
    );

    const res = await POST(
      makeRequest({ proof: VALID_PROOF, publicSignals: PUBLIC_SIGNALS }),
    );

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(prisma.venueCheckInNullifier.create).not.toHaveBeenCalled();
  });

  it("returns 400 when the public signals are incomplete or the epoch is invalid", async () => {
    const incomplete = await POST(
      makeRequest({
        proof: VALID_PROOF,
        publicSignals: PUBLIC_SIGNALS.slice(0, 3),
      }),
    );
    expect(incomplete.status).toBe(400);

    const badEpoch = await POST(
      makeRequest({
        proof: VALID_PROOF,
        publicSignals: [
          PUBLIC_SIGNALS[0],
          PUBLIC_SIGNALS[1],
          PUBLIC_SIGNALS[2],
          "not-a-number",
        ],
      }),
    );
    expect(badEpoch.status).toBe(400);

    expect(snarkjs.groth16.verify).not.toHaveBeenCalled();
  });

  it("returns 400 when proof parameters are missing", async () => {
    const res = await POST(
      makeRequest({ publicSignals: PUBLIC_SIGNALS }),
    );

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
  });

  it("rejects a tampered check-in access token", () => {
    const token = issueAnonymousCheckInToken("venue-1", "nullifier-1", 2026);
    const parts = token.split(".");
    parts[0] = Buffer.from(
      JSON.stringify({
        scope: "venue-checkin",
        venueId: "venue-2",
        nullifierHash: "nullifier-1",
        epoch: 2026,
        issuedAt: Number(parts[1]),
        expiresAt: Date.now() + 60_000,
      }),
    ).toString("base64url");

    expect(verifyAnonymousCheckInToken(parts.join("."))).toBeNull();
  });
});
