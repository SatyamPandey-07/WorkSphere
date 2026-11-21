/** @jest-environment node */

import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/auth/zkp/nomad-proof/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import {
  createNomadProofChallenge,
  verifyAndMintNomadPassportStamp,
} from "@/lib/zkp/nomadProofVerification";
import { invalidateXpLeaderboard } from "@/lib/leaderboards/xpLeaderboard";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    userBadge: {
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

jest.mock("@/lib/zkp/nomadProofVerification", () => ({
  createNomadProofChallenge: jest.fn(),
  verifyAndMintNomadPassportStamp: jest.fn(),
}));

jest.mock("@/lib/leaderboards/xpLeaderboard", () => ({
  invalidateXpLeaderboard: jest.fn(),
}));

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/auth/zkp/nomad-proof", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

const activity = {
  currentStreak: 30,
  totalDeepWorkMinutes: 6000,
};

const validStamp = {
  stampId: "STAMP-NOMAD_100_HOURS-2026-ABCD1234",
  badgeType: "NOMAD_100_HOURS",
  tierTitle: "100-Hour Deep Work Focus Master",
  epoch: 2026,
  issuedAt: "2026-11-20T00:00:00.000Z",
  nullifierHash: "123456",
  verificationSignature: "signature",
  svgMarkup: "<svg />",
};

describe("POST /api/auth/zkp/nomad-proof", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (auth as jest.Mock).mockResolvedValue({
      userId: "user-a",
    });

    (prisma.user.findUnique as jest.Mock).mockResolvedValue(activity);

    (prisma.userBadge.upsert as jest.Mock).mockResolvedValue({
      id: "badge-1",
    });
    (prisma.userBadge.findMany as jest.Mock).mockResolvedValue([]);

    (invalidateXpLeaderboard as jest.Mock).mockResolvedValue(undefined);

    (createNomadProofChallenge as jest.Mock).mockReturnValue({
      ok: true,
      challenge: {
        statement: {
          badgeType: "NOMAD_100_HOURS",
          tierTitle: "100-Hour Deep Work Focus Master",
          minThresholdStreak: 14,
          minThresholdHours: 100,
          epoch: 2026,
        },
        input: {},
      },
    });

    (verifyAndMintNomadPassportStamp as jest.Mock).mockResolvedValue({
      isValid: true,
      stamp: validStamp,
    });
  });

  describe("GET /api/auth/zkp/nomad-proof", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it.each(["NOMAD_100_HOURS", "STREAK_30_DAYS"])(
      "returns verified for the persisted %s proof badge",
      async (badgeType) => {
        (auth as jest.Mock).mockResolvedValue({ userId: "user-a" });
        (prisma.userBadge.findMany as jest.Mock).mockResolvedValue([
          { badgeType },
        ]);

        const response = await GET();
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
          success: true,
          verified: true,
        });
        expect(prisma.userBadge.findMany).toHaveBeenCalledWith({
          where: {
            userId: "user-a",
            badgeType: { in: ["NOMAD_100_HOURS", "STREAK_30_DAYS"] },
          },
          select: { badgeType: true },
          take: 1,
        });
      },
    );

    it("returns 401 for an unauthenticated user without querying badges", async () => {
      (auth as jest.Mock).mockResolvedValue({ userId: null });

      const unauthenticated = await GET();
      expect(unauthenticated.status).toBe(401);
      await expect(unauthenticated.json()).resolves.toMatchObject({
        success: false,
        verified: false,
      });
      expect(prisma.userBadge.findMany).not.toHaveBeenCalled();
    });

    it("returns false when the authenticated user has no Nomad proof badge", async () => {
      (auth as jest.Mock).mockResolvedValue({ userId: "user-a" });
      (prisma.userBadge.findMany as jest.Mock).mockResolvedValue([]);

      const unverified = await GET();
      expect(unverified.status).toBe(200);
      await expect(unverified.json()).resolves.toMatchObject({
        success: true,
        verified: false,
      });
      expect(prisma.userBadge.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: "user-a" }),
        }),
      );
    });

    it.each([
      "verified_explorer",
      "accurate_venue-123",
      "NOMAD_50_HOURS",
      "MULTI_CITY_EXPLORER",
    ])(
      "does not qualify persisted non-claimable badge %s",
      async (badgeType) => {
        (auth as jest.Mock).mockResolvedValue({ userId: "user-a" });
        (prisma.userBadge.findMany as jest.Mock).mockImplementation(
          async (args) =>
            args.where.badgeType.in.includes(badgeType)
              ? [{ badgeType }]
              : [],
        );

        const response = await GET();
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
          success: true,
          verified: false,
        });
        expect(prisma.userBadge.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              userId: "user-a",
              badgeType: {
                in: ["NOMAD_100_HOURS", "STREAK_30_DAYS"],
              },
            },
          }),
        );
      },
    );

    it("does not count a Nomad proof badge owned by another user", async () => {
      (auth as jest.Mock).mockResolvedValue({ userId: "user-a" });
      (prisma.userBadge.findMany as jest.Mock).mockImplementation(
        async (args) =>
          args.where.userId === "user-b"
            ? [{ badgeType: "NOMAD_100_HOURS" }]
            : [],
      );

      const response = await GET();
      await expect(response.json()).resolves.toMatchObject({
        success: true,
        verified: false,
      });
      expect(prisma.userBadge.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: "user-a" }),
        }),
      );
    });

    it("fails closed with a safe response when the database query fails", async () => {
      (auth as jest.Mock).mockResolvedValue({ userId: "user-a" });
      (prisma.userBadge.findMany as jest.Mock).mockRejectedValue(
        new Error("sensitive database detail"),
      );
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      try {
        const response = await GET();
        expect(response.status).toBe(500);
        const body = await response.json();
        expect(body).toMatchObject({ success: false, verified: false });
        expect(body.error).not.toContain("sensitive database detail");
      } finally {
        consoleError.mockRestore();
      }
    });
  });

  it("returns a challenge without minting a badge", async () => {
    const response = await POST(
      makeRequest({
        action: "challenge",
        badgeType: "NOMAD_100_HOURS",
      }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).challenge).toBeDefined();

    expect(prisma.userBadge.upsert).not.toHaveBeenCalled();
    expect(verifyAndMintNomadPassportStamp).not.toHaveBeenCalled();
  });

  it("assigns a verified badge to the authenticated user, ignoring spoofed identity fields", async () => {
    const proof = { protocol: "groth16" };
    const publicSignals = ["1", "14", "100", "2026", "2"];

    const response = await POST(
      makeRequest({
        action: "verify",
        badgeType: "NOMAD_100_HOURS",
        proof,
        publicSignals,
        userId: "user-b",
        actualStreak: 999999,
        actualHours: 999999,
      }),
    );

    expect(response.status).toBe(200);

    expect(verifyAndMintNomadPassportStamp).toHaveBeenCalledWith(
      "user-a",
      "NOMAD_100_HOURS",
      { proof, publicSignals },
      activity,
    );

    expect(prisma.userBadge.upsert).toHaveBeenCalledWith({
      where: {
        userId_badgeType: {
          userId: "user-a",
          badgeType: "NOMAD_100_HOURS",
        },
      },
      create: {
        userId: "user-a",
        badgeType: "NOMAD_100_HOURS",
      },
      update: {
        awardedAt: expect.any(Date),
      },
    });

    expect(invalidateXpLeaderboard).toHaveBeenCalledTimes(1);
  });

  it("rejects unauthenticated requests before reading activity or verifying", async () => {
    (auth as jest.Mock).mockResolvedValue({
      userId: null,
    });

    const response = await POST(
      makeRequest({
        action: "verify",
        badgeType: "NOMAD_100_HOURS",
        proof: {},
        publicSignals: [],
      }),
    );

    expect(response.status).toBe(401);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(verifyAndMintNomadPassportStamp).not.toHaveBeenCalled();
    expect(prisma.userBadge.upsert).not.toHaveBeenCalled();
  });

  it("does not persist a badge when Groth16 verification rejects the proof", async () => {
    (verifyAndMintNomadPassportStamp as jest.Mock).mockResolvedValue({
      isValid: false,
      code: "INVALID_PROOF",
      error: "Invalid Groth16 proof",
      status: 400,
    });

    const response = await POST(
      makeRequest({
        action: "verify",
        badgeType: "NOMAD_100_HOURS",
        proof: {},
        publicSignals: [],
      }),
    );

    expect(response.status).toBe(400);
    expect(prisma.userBadge.upsert).not.toHaveBeenCalled();
    expect(invalidateXpLeaderboard).not.toHaveBeenCalled();
  });

  it("does not return success when badge persistence fails", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      (prisma.userBadge.upsert as jest.Mock).mockRejectedValue(
        new Error("Database unavailable"),
      );

      const response = await POST(
        makeRequest({
          action: "verify",
          badgeType: "NOMAD_100_HOURS",
          proof: {},
          publicSignals: [],
        }),
      );

      expect(response.status).toBe(500);
      expect((await response.json()).success).not.toBe(true);
      expect(invalidateXpLeaderboard).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
