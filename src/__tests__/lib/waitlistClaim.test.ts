/**
 * Regression tests for the waitlist claim / hand-off flow.
 *
 * Before the fix, `claimWaitlistSeat`:
 *  - handed out the first enabled seat in the venue without checking existing
 *    bookings (so claimers were double-booked onto an occupied seat),
 *  - was a read-then-write sequence outside a transaction (so a double submit
 *    created two bookings), and
 *  - `expireStaleWaitlistOffers` / `notifyNextInWaitlist` transitioned entries
 *    without a status guard (so concurrent sweeps notified the same waiter
 *    several times for one freed seat).
 */

jest.mock("@/lib/prisma", () => {
  const db: any = { waitlist: [], seats: [], bookings: [], users: [{ id: "u1", email: "u1@example.com" }, { id: "u2", email: "u2@example.com" }, { id: "u3", email: "u3@example.com" }] };
  let seq = 0;
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const match = (row: any, where: any = {}) =>
    Object.entries(where).every(([key, value]: [string, any]) => {
      if (value && typeof value === "object" && !(value instanceof Date)) {
        if ("in" in value) return value.in.includes(row[key]);
        if ("not" in value) return row[key] !== value.not;
        if ("lt" in value) return row[key] < value.lt;
        if ("has" in value) return (row[key] || []).includes(value.has);
        return true;
      }
      return row[key] === value;
    });
  const sortBy = (rows: any[], orderBy?: any) => {
    if (!orderBy) return rows;
    const [[key, dir]] = Object.entries(orderBy) as [string, string][];
    return [...rows].sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * (dir === "desc" ? -1 : 1));
  };
  const withRelations = (rows: any[], include?: any) =>
    rows.map((row) => ({
      ...row,
      ...(include?.user ? { user: db.users.find((u: any) => u.id === row.userId) } : {}),
      ...(include?.venue ? { venue: { name: "Hub" } } : {}),
      ...(include?.seat ? { seat: db.seats.find((s: any) => s.id === row.seatId) ?? null } : {}),
    }));

  const tx: any = {
    $queryRaw: async () => {
      await tick();
      return [];
    },
    venueSeatWaitlist: {
      findFirst: async ({ where, include }: any) => (await tick(), withRelations(db.waitlist.filter((r: any) => match(r, where)), include)[0] ?? null),
      findUnique: async ({ where }: any) => (await tick(), db.waitlist.find((r: any) => r.id === where.id) ?? null),
      findMany: async ({ where, include, orderBy }: any) => (await tick(), withRelations(sortBy(db.waitlist.filter((r: any) => match(r, where)), orderBy), include)),
      updateMany: async ({ where, data }: any) => {
        await tick();
        const rows = db.waitlist.filter((r: any) => match(r, where));
        rows.forEach((r: any) => Object.assign(r, data));
        return { count: rows.length };
      },
      update: async ({ where, data }: any) => {
        await tick();
        const row = db.waitlist.find((r: any) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    venueSeat: {
      findMany: async ({ where, orderBy, select }: any) => {
        await tick();
        const rows = sortBy(db.seats.filter((r: any) => match(r, where)), orderBy);
        return select ? rows.map((r: any) => ({ id: r.id })) : rows;
      },
      findUnique: async ({ where }: any) => (await tick(), db.seats.find((s: any) => s.id === where.id) ?? null),
      count: async ({ where }: any) => (await tick(), db.seats.filter((r: any) => match(r, where)).length),
    },
    booking: {
      findMany: async ({ where }: any) => (await tick(), db.bookings.filter((r: any) => match(r, where))),
      create: async ({ data }: any) => {
        await tick();
        const row = { id: `booking_${++seq}`, ...data };
        db.bookings.push(row);
        return row;
      },
    },
  };

  // Serializable isolation emulation: transactions commit one after another.
  let chain: Promise<unknown> = Promise.resolve();
  const prisma = {
    ...tx,
    $transaction: async (callback: (client: any) => Promise<unknown>) => {
      const run = chain.then(() => callback(tx));
      chain = run.catch(() => undefined);
      return run;
    },
  };
  return { prisma, __db: db };
});

jest.mock("@/lib/notifications/dispatcher", () => {
  const sent: any[] = [];
  return {
    NotificationDispatcher: class {
      async dispatch(_channel: string, message: any) {
        sent.push(message);
      }
    },
    __sent: sent,
  };
});

import {
  claimWaitlistSeat,
  expireStaleWaitlistOffers,
  notifyNextInWaitlist,
} from "@/lib/waitlist";

const { __db: db } = jest.requireMock("@/lib/prisma") as { __db: any };
const { __sent: sentNotifications } = jest.requireMock(
  "@/lib/notifications/dispatcher",
) as { __sent: any[] };

const DATE = "2030-01-10";

function seat(id: string, seatNumber: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    venueId: "venue_1",
    seatNumber,
    type: "HOT_DESK",
    isEnabled: true,
    isQuietZone: false,
    amenities: [] as string[],
    ...extra,
  };
}

function waitlistEntry(id: string, userId: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    userId,
    venueId: "venue_1",
    seatId: null,
    seatType: null,
    date: DATE,
    time: "10:00",
    duration: 60,
    timeZone: "UTC",
    requiresQuiet: false,
    requiresOutlets: false,
    status: "NOTIFIED",
    notifiedAt: new Date(),
    claimExpiresAt: new Date(Date.now() + 10 * 60_000),
    claimedAt: null,
    createdAt: new Date(),
    ...extra,
  };
}

function booking(id: string, seatId: string, time: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    venueId: "venue_1",
    seatId,
    date: DATE,
    time,
    duration: 60,
    timeZone: "UTC",
    status: "CONFIRMED",
    ...extra,
  };
}

describe("claimWaitlistSeat", () => {
  beforeEach(() => {
    db.waitlist.length = 0;
    db.bookings.length = 0;
    db.seats.length = 0;
    sentNotifications.length = 0;
    db.seats.push(seat("seat_1", "A1", { amenities: ["outlets"] }), seat("seat_2", "A2"));
  });

  it("never gives two concurrent claimers the same seat", async () => {
    db.waitlist.push(waitlistEntry("w1", "u1"), waitlistEntry("w2", "u2"));

    const [first, second] = await Promise.all([
      claimWaitlistSeat("w1", "u1"),
      claimWaitlistSeat("w2", "u2"),
    ]);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(first.seatId).not.toBe(second.seatId);
    expect(db.bookings.map((b: any) => b.seatId).sort()).toEqual(["seat_1", "seat_2"]);
  });

  it("refuses to claim a seat that was booked while the offer was pending", async () => {
    db.bookings.push(booking("existing", "seat_1", "10:30")); // overlaps 10:00-11:00
    db.waitlist.push(waitlistEntry("w1", "u1", { seatId: "seat_1" }));

    const result = await claimWaitlistSeat("w1", "u1");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/reserved/i);
    expect(db.bookings).toHaveLength(1);
    expect(db.waitlist[0].status).toBe("NOTIFIED");
  });

  it("treats back-to-back bookings as non-conflicting", async () => {
    db.bookings.push(booking("existing", "seat_1", "11:00")); // starts when ours ends
    db.waitlist.push(waitlistEntry("w1", "u1", { seatId: "seat_1" }));

    const result = await claimWaitlistSeat("w1", "u1");

    expect(result.success).toBe(true);
    expect(result.seatId).toBe("seat_1");
  });

  it("ignores cancelled bookings when looking for a free seat", async () => {
    db.bookings.push(booking("old", "seat_1", "10:00", { status: "CANCELLED" }));
    db.waitlist.push(waitlistEntry("w1", "u1", { seatId: "seat_1" }));

    expect((await claimWaitlistSeat("w1", "u1")).success).toBe(true);
  });

  it("honours seat preferences when picking a seat", async () => {
    db.waitlist.push(waitlistEntry("w1", "u1", { requiresOutlets: true }));

    const result = await claimWaitlistSeat("w1", "u1");

    expect(result.success).toBe(true);
    expect(result.seatId).toBe("seat_1"); // the only seat with outlets
  });

  it("creates exactly one booking when the same claim is submitted twice", async () => {
    db.waitlist.push(waitlistEntry("w1", "u1", { seatId: "seat_1" }));

    const results = await Promise.all([
      claimWaitlistSeat("w1", "u1"),
      claimWaitlistSeat("w1", "u1"),
    ]);

    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(db.bookings).toHaveLength(1);
    expect(db.waitlist[0].status).toBe("CLAIMED");
  });

  it("expires a lapsed offer and hands the seat to the next waiter", async () => {
    db.waitlist.push(
      waitlistEntry("w1", "u1", {
        seatId: "seat_1",
        claimExpiresAt: new Date(Date.now() - 1000),
        createdAt: new Date(1),
      }),
      waitlistEntry("w2", "u2", { status: "ACTIVE", claimExpiresAt: null, createdAt: new Date(2) }),
    );

    const result = await claimWaitlistSeat("w1", "u1");

    expect(result.success).toBe(false);
    expect(db.bookings).toHaveLength(0);
    expect(db.waitlist.find((w: any) => w.id === "w1").status).toBe("EXPIRED");
    expect(db.waitlist.find((w: any) => w.id === "w2").status).toBe("NOTIFIED");
  });

  it("rejects other users' entries and entries that are not NOTIFIED", async () => {
    db.waitlist.push(
      waitlistEntry("w1", "u1"),
      waitlistEntry("w3", "u3", { status: "ACTIVE" }),
    );

    expect((await claimWaitlistSeat("w1", "u2")).success).toBe(false);
    expect((await claimWaitlistSeat("w3", "u3")).success).toBe(false);
    expect(db.bookings).toHaveLength(0);
  });
});

describe("expireStaleWaitlistOffers", () => {
  beforeEach(() => {
    db.waitlist.length = 0;
    db.bookings.length = 0;
    db.seats.length = 0;
    sentNotifications.length = 0;
    db.seats.push(seat("seat_1", "A1"));
  });

  it("offers a freed seat only once even when sweeps run concurrently", async () => {
    db.waitlist.push(
      waitlistEntry("w1", "u1", {
        seatId: "seat_1",
        claimExpiresAt: new Date(Date.now() - 5000),
        createdAt: new Date(1),
      }),
      waitlistEntry("w2", "u2", { status: "ACTIVE", claimExpiresAt: null, createdAt: new Date(2) }),
      waitlistEntry("w3", "u3", { status: "ACTIVE", claimExpiresAt: null, createdAt: new Date(3) }),
    );

    const counts = await Promise.all([
      expireStaleWaitlistOffers(),
      expireStaleWaitlistOffers(),
      expireStaleWaitlistOffers(),
    ]);

    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(db.waitlist.filter((w: any) => w.status === "NOTIFIED").map((w: any) => w.id)).toEqual(["w2"]);
    expect(sentNotifications).toHaveLength(1);
  });
});

describe("notifyNextInWaitlist concurrency (#4796)", () => {
  beforeEach(() => {
    db.waitlist.length = 0;
    db.bookings.length = 0;
    db.seats.length = 0;
    sentNotifications.length = 0;
    db.seats.push(
      seat("seat_1", "A1"),
      seat("seat_2", "A2"),
    );
  });

  it("handles simultaneous seat releases without notifying the same waitlist entry twice", async () => {
    // Two users are active in the queue
    db.waitlist.push(
      waitlistEntry("w1", "u1", { status: "ACTIVE", claimExpiresAt: null, createdAt: new Date(1) }),
      waitlistEntry("w2", "u2", { status: "ACTIVE", claimExpiresAt: null, createdAt: new Date(2) }),
    );

    // Two seats are released simultaneously (e.g. concurrent cancellations)
    const [res1, res2] = await Promise.all([
      notifyNextInWaitlist("venue_1", DATE, "10:00", 60, "seat_1"),
      notifyNextInWaitlist("venue_1", DATE, "10:00", 60, "seat_2"),
    ]);

    expect(res1.notified).toBe(true);
    expect(res2.notified).toBe(true);
    // Each release must pick a distinct waitlist claimant
    expect(res1.waitlistId).not.toEqual(res2.waitlistId);
    expect(res1.userId).not.toEqual(res2.userId);

    const notifiedEntries = db.waitlist.filter((w: any) => w.status === "NOTIFIED");
    expect(notifiedEntries).toHaveLength(2);
    expect(new Set(notifiedEntries.map((w: any) => w.id))).toEqual(new Set(["w1", "w2"]));
    expect(sentNotifications).toHaveLength(2);
  });

  it("notifies strictly one user when only one seat is released among concurrent triggers", async () => {
    db.waitlist.push(
      waitlistEntry("w1", "u1", { status: "ACTIVE", claimExpiresAt: null, createdAt: new Date(1) }),
      waitlistEntry("w2", "u2", { status: "ACTIVE", claimExpiresAt: null, createdAt: new Date(2) }),
    );

    // Multiple triggers for the same freed seat
    const [res1, res2] = await Promise.all([
      notifyNextInWaitlist("venue_1", DATE, "10:00", 60, "seat_1"),
      notifyNextInWaitlist("venue_1", DATE, "10:00", 60, "seat_1"),
    ]);

    const notifiedResults = [res1, res2].filter((r) => r.notified);
    expect(notifiedResults).toHaveLength(1);
    expect(notifiedResults[0].waitlistId).toBe("w1");
    expect(db.waitlist.filter((w: any) => w.status === "NOTIFIED")).toHaveLength(1);
    expect(sentNotifications).toHaveLength(1);
  });
});

describe("notifyNextInWaitlist eligibility uses real intervals", () => {
  beforeEach(() => {
    db.waitlist.length = 0;
    db.bookings.length = 0;
    db.seats.length = 0;
    sentNotifications.length = 0;
    db.seats.push(seat("seat_1", "A1"));
  });

  it("does not offer a freed seat to an older waiter who wants a different day at the same clock time", async () => {
    db.waitlist.push(
      // Oldest in line, but waiting for 2 days earlier at the same 10:00.
      waitlistEntry("w_other_day", "u1", {
        status: "ACTIVE",
        claimExpiresAt: null,
        date: "2030-01-08",
        createdAt: new Date(1),
      }),
      waitlistEntry("w_same_day", "u2", {
        status: "ACTIVE",
        claimExpiresAt: null,
        createdAt: new Date(2),
      }),
    );

    const res = await notifyNextInWaitlist("venue_1", DATE, "10:00", 60, "seat_1", "UTC");

    expect(res.notified).toBe(true);
    expect(res.waitlistId).toBe("w_same_day");
    expect(db.waitlist.find((w: any) => w.id === "w_other_day").status).toBe("ACTIVE");
  });

  it("offers the seat to a waiter whose slot overlaps but starts at a different time", async () => {
    db.waitlist.push(
      waitlistEntry("w_overlap", "u1", {
        status: "ACTIVE",
        claimExpiresAt: null,
        time: "10:30",
        createdAt: new Date(1),
      }),
    );

    // Freed booking ran 10:00-11:00 UTC, so a 10:30 waiter overlaps it.
    const res = await notifyNextInWaitlist("venue_1", DATE, "10:00", 60, "seat_1", "UTC");

    expect(res.notified).toBe(true);
    expect(res.waitlistId).toBe("w_overlap");
  });

  it("compares instants across timezones", async () => {
    db.waitlist.push(
      // 10:00 in New York is 15:00 UTC: same wall clock as the freed booking, different instant.
      waitlistEntry("w_wrong_tz", "u1", {
        status: "ACTIVE",
        claimExpiresAt: null,
        timeZone: "America/New_York",
        createdAt: new Date(1),
      }),
      // 15:00 in Colombo is 09:30 UTC: overlaps the freed 09:00-10:00 UTC slot.
      waitlistEntry("w_right_tz", "u2", {
        status: "ACTIVE",
        claimExpiresAt: null,
        time: "15:00",
        timeZone: "Asia/Colombo",
        createdAt: new Date(2),
      }),
    );

    const res = await notifyNextInWaitlist("venue_1", DATE, "09:00", 60, "seat_1", "UTC");

    expect(res.notified).toBe(true);
    expect(res.waitlistId).toBe("w_right_tz");
  });

  it("skips waiters whose own interval is still occupied on the freed seat", async () => {
    db.waitlist.push(
      waitlistEntry("w_blocked", "u1", {
        status: "ACTIVE",
        claimExpiresAt: null,
        time: "10:30",
        duration: 60,
        createdAt: new Date(1),
      }),
      waitlistEntry("w_free", "u2", {
        status: "ACTIVE",
        claimExpiresAt: null,
        time: "10:00",
        duration: 30,
        createdAt: new Date(2),
      }),
    );
    // Seat was freed for 10:00-11:00 but someone else already holds 10:45-11:45.
    db.bookings.push(booking("b_other", "seat_1", "10:45", { status: "CONFIRMED" }));

    const res = await notifyNextInWaitlist("venue_1", DATE, "10:00", 60, "seat_1", "UTC");

    expect(res.notified).toBe(true);
    expect(res.waitlistId).toBe("w_free");
  });
});

