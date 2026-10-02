/**
 * @jest-environment node
 */
import { POST } from "@/app/api/reservations/book/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
  currentUser: jest.fn().mockResolvedValue({
    primaryEmailAddress: { emailAddress: "user@example.com" },
  }),
}));

jest.mock("@/lib/auth", () => ({
  ensureUserExists: jest.fn().mockResolvedValue({ id: "user_test_123" }),
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockResolvedValue(true),
  getRateLimitInfo: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/lib/reservations/event-bus", () => ({
  publishVenueAvailability: jest.fn(),
}));

jest.mock("@/lib/webhooks/deliver", () => ({
  emitWebhookEvent: jest.fn(),
}));

jest.mock("@/core/subscribers/booking", () => ({}));
jest.mock("@/core/subscribers/guests", () => ({}));

jest.mock("@/core/events", () => ({
  eventBus: {
    emit: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    off: jest.fn(),
  },
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
    bookingGuest: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  },
}));

const futureDate = new Date(Date.now() + 7 * 86_400_000)
  .toISOString()
  .slice(0, 10);

type ExistingRow = {
  time: string;
  duration: number;
  date?: string;
  timeZone?: string | null;
};

const dayAfter = (d: string) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

function makeTx(existing: ExistingRow[] = []) {
  let n = 0;
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    venueSeat: {
      findMany: jest.fn(async ({ where }: any) =>
        where.id.in.map((id: string) => ({
          id,
          venueId: "venue_1",
          seatNumber: id.toUpperCase(),
        })),
      ),
    },
    booking: {
      findMany: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: `booking_${++n}`,
          ...data,
          venue: {
            name: "Test Venue",
            address: "123 Main St",
            category: "coworking",
          },
        }),
      ),
    },
  };
}

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/reservations/book", {
    method: "POST",
    body: JSON.stringify({
      venueId: "venue_1",
      date: futureDate,
      time: "10:00",
      duration: 60,
      timeZone: "UTC",
      ...body,
    }),
  });
}

describe("POST /api/reservations/book", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user_123" });
  });

  it("runs in a Serializable transaction and row-locks the seats", async () => {
    const tx = makeTx();
    (prisma.$transaction as jest.Mock).mockImplementation(
      async (cb: any, options: any) => {
        expect(options?.isolationLevel).toBe(
          Prisma.TransactionIsolationLevel.Serializable,
        );
        return cb(tx);
      },
    );

    const res = await POST(request({ seatId: "seat_1" }));
    expect(res.status).toBe(201);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("returns 409 when the seat is already taken for an overlapping slot", async () => {
    const tx = makeTx([{ time: "10:00", duration: 60 }]);
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) =>
      cb(tx),
    );

    const res = await POST(request({ seatId: "seat_1", time: "10:30" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("reserved");
    expect(tx.booking.create).not.toHaveBeenCalled();
  });

  it("returns 409 when an earlier booking runs past midnight into the requested date", async () => {
    // 23:00 + 2h on futureDate occupies the seat until 01:00 on the next day.
    const tx = makeTx([
      { date: futureDate, time: "23:00", duration: 120, timeZone: "UTC" },
    ]);
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) =>
      cb(tx),
    );

    const res = await POST(
      request({ seatId: "seat_1", date: dayAfter(futureDate), time: "00:30" }),
    );
    expect(res.status).toBe(409);
    expect(tx.booking.create).not.toHaveBeenCalled();
  });

  it("returns 409 when the same instant is requested from a different timezone", async () => {
    // 09:00 Asia/Colombo (UTC+5:30) is 03:30 UTC.
    const tx = makeTx([
      {
        date: futureDate,
        time: "09:00",
        duration: 60,
        timeZone: "Asia/Colombo",
      },
    ]);
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) =>
      cb(tx),
    );

    const res = await POST(
      request({ seatId: "seat_1", time: "03:30", timeZone: "UTC" }),
    );
    expect(res.status).toBe(409);
    expect(tx.booking.create).not.toHaveBeenCalled();
  });

  it("allows a booking whose wall clock matches but whose real time does not", async () => {
    // 10:00 in Colombo is 04:30 UTC; 10:00 in New York is 14:00/15:00 UTC.
    const tx = makeTx([
      {
        date: futureDate,
        time: "10:00",
        duration: 60,
        timeZone: "Asia/Colombo",
      },
    ]);
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) =>
      cb(tx),
    );

    const res = await POST(
      request({
        seatId: "seat_1",
        time: "10:00",
        timeZone: "America/New_York",
      }),
    );
    expect(res.status).toBe(201);
    expect(tx.booking.create).toHaveBeenCalledTimes(1);
  });

  it("returns 409 for a legacy row stored as a 12-hour time", async () => {
    const tx = makeTx([
      { date: futureDate, time: "10:00 AM", duration: 60, timeZone: null },
    ]);
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) =>
      cb(tx),
    );

    const res = await POST(request({ seatId: "seat_1", time: "10:00" }));
    expect(res.status).toBe(409);
  });

  it("queries neighbouring dates so cross-midnight and cross-timezone rows are found", async () => {
    const tx = makeTx();
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) =>
      cb(tx),
    );

    await POST(request({ seatId: "seat_1" }));

    const where = tx.booking.findMany.mock.calls[0][0].where;
    expect(where.date.in).toContain(futureDate);
    expect(where.date.in).toContain(dayAfter(futureDate));
    expect(where.date.in.length).toBeGreaterThan(1);
    expect(tx.booking.findMany.mock.calls[0][0].select).toMatchObject({
      date: true,
      timeZone: true,
    });
  });

  it("gives each seat of a multi-seat reservation its own confirmation id", async () => {
    const tx = makeTx();
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) =>
      cb(tx),
    );

    const res = await POST(request({ seatIds: ["seat_b", "seat_a"] }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.confirmationIds).toHaveLength(2);
    expect(new Set(json.confirmationIds).size).toBe(2);
    expect(
      tx.booking.create.mock.calls.map((c: any) => c[0].data.customerEmail),
    ).toEqual(["user@example.com", "user@example.com"]);
  });

  it("rejects reservations in the past", async () => {
    const res = await POST(request({ seatId: "seat_1", date: "2020-01-01" }));
    expect(res.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("retries automatically on transient serialization failure (P2034)", async () => {
    let attempts = 0;
    const p2034 = Object.assign(new Error("serialization failure"), {
      code: "P2034",
    });
    const tx = makeTx();
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => {
      attempts++;
      if (attempts === 1) throw p2034;
      return cb(tx);
    });

    const res = await POST(request({ seatId: "seat_1", time: "14:00" }));
    expect(res.status).toBe(201);
    expect(attempts).toBe(2);
  });
});
