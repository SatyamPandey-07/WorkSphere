/**
 * Regression tests for split-bill guest payments.
 *
 * Before the fix, `BookingGuest.status === "ACCEPTED"` was treated as "paid".
 * That status is also what the free email RSVP link sets, so a guest who just
 * clicked "Accept" was shown as paid (and got the Guest Pass with WiFi code)
 * without paying. The payment route also accepted payments for cancelled
 * bookings / declined guests, and a check-then-update race could record and
 * announce the same payment twice.
 */

import { GET, POST } from "../../app/api/payments/split/[token]/route";
import { prisma } from "@/lib/prisma";
import { eventBus } from "@/core/events";
import { generateSplitPaymentToken } from "@/lib/billing/splitPayment";

jest.mock("@/lib/prisma", () => {
  const client: any = {
    booking: { findUnique: jest.fn() },
    bookingGuest: { findUnique: jest.fn(), updateMany: jest.fn() },
  };
  client.$transaction = jest.fn(async (cb: (tx: any) => Promise<unknown>) => cb(client));
  return { prisma: client };
});

jest.mock("@/core/events", () => ({
  eventBus: { emit: jest.fn() },
}));

const db = prisma as any;
const emit = eventBus.emit as jest.Mock;

function makeToken() {
  return generateSplitPaymentToken({
    bookingId: "booking_abcd1234",
    guestId: "guest_wxyz5678",
    email: "guest@example.com",
    name: "Gia Guest",
    amount: 12.5,
    currency: "USD",
    venueName: "Old Venue Name",
    date: "2030-01-10",
    time: "10:00",
  });
}

function ctx(token: string) {
  return { params: Promise.resolve({ token }) };
}

function guestRow(extra: Record<string, unknown> = {}, bookingExtra: Record<string, unknown> = {}) {
  return {
    id: "guest_wxyz5678",
    bookingId: "booking_abcd1234",
    email: "guest@example.com",
    status: "PENDING",
    paidAt: null,
    booking: {
      status: "CONFIRMED",
      date: "2030-01-12",
      time: "14:30",
      venue: { name: "Current Venue" },
      ...bookingExtra,
    },
    ...extra,
  };
}

function bookingRow(guest: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    id: "booking_abcd1234",
    status: "CONFIRMED",
    date: "2030-01-12",
    time: "14:30",
    seatNumber: "A1",
    duration: 60,
    venue: { name: "Current Venue" },
    user: { firstName: "Host", lastName: "Person" },
    guests: [guest],
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  emit.mockResolvedValue(undefined);
});

describe("GET /api/payments/split/[token]", () => {
  it("does not treat an RSVP 'ACCEPTED' guest as paid", async () => {
    db.booking.findUnique.mockResolvedValue(
      bookingRow({ id: "guest_wxyz5678", status: "ACCEPTED", paidAt: null }),
    );
    const res = await GET({} as any, ctx(makeToken()));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.isPaid).toBe(false);
  });

  it("reports a guest with paidAt as paid", async () => {
    db.booking.findUnique.mockResolvedValue(
      bookingRow({ id: "guest_wxyz5678", status: "ACCEPTED", paidAt: new Date() }),
    );
    const json = await (await GET({} as any, ctx(makeToken()))).json();
    expect(json.isPaid).toBe(true);
  });

  it("returns 410 for an unpaid link on a cancelled booking", async () => {
    db.booking.findUnique.mockResolvedValue(
      bookingRow({ id: "guest_wxyz5678", status: "CANCELLED", paidAt: null }, { status: "CANCELLED" }),
    );
    const res = await GET({} as any, ctx(makeToken()));
    expect(res.status).toBe(410);
  });

  it("returns 404 when the guest no longer exists", async () => {
    db.booking.findUnique.mockResolvedValue(bookingRow(undefined as any, { guests: [] }));
    const res = await GET({} as any, ctx(makeToken()));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/payments/split/[token]", () => {
  it("records payment for an RSVP-accepted guest and announces it once", async () => {
    db.bookingGuest.findUnique.mockResolvedValue(guestRow({ status: "ACCEPTED" }));
    db.bookingGuest.updateMany.mockResolvedValue({ count: 1 });

    const res = await POST({} as any, ctx(makeToken()));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toMatch(/payment confirmed/i);
    const call = db.bookingGuest.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ id: "guest_wxyz5678", paidAt: null });
    expect(call.data).toMatchObject({
      status: "ACCEPTED",
      paidAmountCents: 1250,
      paidCurrency: "USD",
    });
    expect(call.data.paidAt).toBeInstanceOf(Date);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("issues the pass from current booking data, not the stale token", async () => {
    db.bookingGuest.findUnique.mockResolvedValue(guestRow());
    db.bookingGuest.updateMany.mockResolvedValue({ count: 1 });

    const json = await (await POST({} as any, ctx(makeToken()))).json();

    expect(json.guestPass.venueName).toBe("Current Venue");
    expect(json.guestPass.date).toBe("2030-01-12");
    expect(json.guestPass.time).toBe("14:30");
  });

  it("rejects payment for a cancelled booking", async () => {
    db.bookingGuest.findUnique.mockResolvedValue(guestRow({}, { status: "CANCELLED" }));
    const res = await POST({} as any, ctx(makeToken()));
    expect(res.status).toBe(410);
    expect(db.bookingGuest.updateMany).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it.each(["DECLINED", "CANCELLED"])("rejects payment from a %s guest", async (status) => {
    db.bookingGuest.findUnique.mockResolvedValue(guestRow({ status }));
    const res = await POST({} as any, ctx(makeToken()));
    expect(res.status).toBe(409);
    expect(db.bookingGuest.updateMany).not.toHaveBeenCalled();
  });

  it("is idempotent when the guest has already paid", async () => {
    db.bookingGuest.findUnique.mockResolvedValue(guestRow({ paidAt: new Date() }));
    const json = await (await POST({} as any, ctx(makeToken()))).json();
    expect(json).toEqual({ success: true, message: "Already paid" });
    expect(db.bookingGuest.updateMany).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("only one of two concurrent submissions records and announces the payment", async () => {
    db.bookingGuest.findUnique.mockResolvedValue(guestRow());
    db.bookingGuest.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const [a, b] = await Promise.all([
      POST({} as any, ctx(makeToken())),
      POST({} as any, ctx(makeToken())),
    ]);
    const bodies = [await a.json(), await b.json()];

    expect(bodies.filter((j) => j.guestPass)).toHaveLength(1);
    expect(bodies.filter((j) => j.message === "Already paid")).toHaveLength(1);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("does not turn a committed payment into a 500 when the event bus fails", async () => {
    db.bookingGuest.findUnique.mockResolvedValue(guestRow());
    db.bookingGuest.updateMany.mockResolvedValue({ count: 1 });
    emit.mockRejectedValue(new Error("smtp down"));
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await POST({} as any, ctx(makeToken()));
    expect(res.status).toBe(200);
  });

  it("rejects a token whose guest belongs to a different booking", async () => {
    db.bookingGuest.findUnique.mockResolvedValue(guestRow({ bookingId: "someone_elses_booking" }));
    const res = await POST({} as any, ctx(makeToken()));
    expect(res.status).toBe(400);
  });
});
