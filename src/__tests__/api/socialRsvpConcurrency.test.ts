import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";

import { POST } from "@/app/api/social/sessions/[slug]/rsvp/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { eventBus } from "@/core/events";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
  },
}));

jest.mock("@/core/events", () => ({
  eventBus: {
    emit: jest.fn(),
  },
}));

jest.mock("@/lib/social/waitlistPromotion", () => ({
  autoPromoteSessionWaitlist: jest.fn(),
}));

jest.mock("@/core/subscribers/discord", () => ({}));

const mockAuth = auth as jest.MockedFunction<typeof auth>;
const mockTransaction = prisma.$transaction as jest.Mock;
const mockEmit = eventBus.emit as jest.Mock;

describe("POST /api/social/sessions/[slug]/rsvp", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses a serializable transaction for RSVP confirmation", async () => {
    mockAuth.mockResolvedValue({ userId: "user-1" });

    const rsvp = {
      id: "rsvp-1",
      sessionId: "session-1",
      userId: "user-1",
      status: "GOING",
    };

    const tx = {
      coworkingSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: "session-1",
          slug: "test-session",
          maxGuests: 1,
          _count: {
            rsvps: 0,
          },
        }),
      },
      sessionRsvp: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue(rsvp),
      },
    };

    mockTransaction.mockImplementation(async (callback, options) => {
      expect(options?.isolationLevel).toBe(
        Prisma.TransactionIsolationLevel.Serializable,
      );

      return callback(tx);
    });

    const request = new NextRequest(
      "http://localhost/api/social/sessions/test-session/rsvp",
      {
        method: "POST",
        body: JSON.stringify({ status: "GOING" }),
      },
    );

    const response = await POST(request, {
      params: Promise.resolve({ slug: "test-session" }),
    });

    expect(response.status).toBe(200);
    expect(tx.sessionRsvp.upsert).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it("returns 409 when a concurrent serializable transaction loses the last available slot", async () => {
    mockAuth
      .mockResolvedValueOnce({ userId: "user-1" })
      .mockResolvedValueOnce({ userId: "user-2" });

    const rsvp = {
      id: "rsvp-1",
      sessionId: "session-1",
      userId: "user-1",
      status: "GOING",
    };

    const tx = {
      coworkingSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: "session-1",
          slug: "test-session",
          maxGuests: 1,
          _count: {
            rsvps: 0,
          },
        }),
      },
      sessionRsvp: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue(rsvp),
      },
    };

    let transactionCount = 0;

    mockTransaction.mockImplementation(async (callback) => {
      transactionCount += 1;

      if (transactionCount === 1) {
        return callback(tx);
      }

      const error = new Error("Transaction failed due to a write conflict");
      Object.assign(error, { code: "P2034" });
      throw error;
    });

    const request1 = new NextRequest(
      "http://localhost/api/social/sessions/test-session/rsvp",
      {
        method: "POST",
        body: JSON.stringify({ status: "GOING" }),
      },
    );

    const request2 = new NextRequest(
      "http://localhost/api/social/sessions/test-session/rsvp",
      {
        method: "POST",
        body: JSON.stringify({ status: "GOING" }),
      },
    );

    const [response1, response2] = await Promise.all([
      POST(request1, {
        params: Promise.resolve({ slug: "test-session" }),
      }),
      POST(request2, {
        params: Promise.resolve({ slug: "test-session" }),
      }),
    ]);

    expect([response1.status, response2.status].sort()).toEqual([200, 409]);
    expect(mockTransaction).toHaveBeenCalledTimes(2);
  });
});
