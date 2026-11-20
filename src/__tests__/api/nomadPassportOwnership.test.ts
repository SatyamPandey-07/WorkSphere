/** @jest-environment node */

import { NextRequest } from "next/server";
import { POST } from "@/app/api/auth/zkp/nomad-proof/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { verifyAndMintNomadPassportStamp } from "@/lib/zkp/nomadProof";
import { invalidateXpLeaderboard } from "@/lib/leaderboards/xpLeaderboard";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    userBadge: {
      upsert: jest.fn(),
    },
  },
}));

jest.mock("@/lib/zkp/nomadProof", () => ({
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

describe("POST /api/auth/zkp/nomad-proof — ownership authorization", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (auth as jest.Mock).mockResolvedValue({
      userId: "user-a",
    });

    (verifyAndMintNomadPassportStamp as jest.Mock).mockReturnValue({
      isValid: true,
      stamp: {
        badgeType: "nomad_passport",
      },
    });

    (prisma.userBadge.upsert as jest.Mock).mockResolvedValue({
      id: "badge-1",
    });

    (invalidateXpLeaderboard as jest.Mock).mockResolvedValue(undefined);
  });

  it("assigns the badge to the authenticated user, ignoring a spoofed body userId", async () => {
    const response = await POST(
      makeRequest({
        statement: "Valid proof statement",
        proof: { proofData: "test-proof" },
        userId: "user-b",
      }),
    );

    expect(response.status).toBe(200);

    expect(prisma.userBadge.upsert).toHaveBeenCalledWith({
      where: {
        userId_badgeType: {
          userId: "user-a",
          badgeType: "nomad_passport",
        },
      },
      create: {
        userId: "user-a",
        badgeType: "nomad_passport",
      },
      update: {
        awardedAt: expect.any(Date),
      },
    });

    expect(invalidateXpLeaderboard).toHaveBeenCalledTimes(1);
  });

  it("rejects unauthenticated requests before verifying or persisting a badge", async () => {
    (auth as jest.Mock).mockResolvedValue({
      userId: null,
    });

    const response = await POST(
      makeRequest({
        statement: "Valid proof statement",
        proof: { proofData: "test-proof" },
      }),
    );

    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error).toBe("Unauthorized");

    expect(verifyAndMintNomadPassportStamp).not.toHaveBeenCalled();
    expect(prisma.userBadge.upsert).not.toHaveBeenCalled();
    expect(invalidateXpLeaderboard).not.toHaveBeenCalled();
  });

  it("does not return success when badge persistence fails", async () => {
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      (prisma.userBadge.upsert as jest.Mock).mockRejectedValue(
        new Error("Database unavailable"),
      );

      const response = await POST(
        makeRequest({
          statement: "Valid proof statement",
          proof: { proofData: "test-proof" },
        }),
      );

      expect(response.status).toBe(500);

      const body = await response.json();
      expect(body.success).not.toBe(true);

      expect(invalidateXpLeaderboard).not.toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
