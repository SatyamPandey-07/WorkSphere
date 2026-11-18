import { GET } from "../../app/api/bookings/[bookingId]/calendar.ics/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";

jest.mock("@clerk/nextjs/server", () => ({ auth: jest.fn() }));
jest.mock("@/lib/auth", () => ({ ensureUserExists: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  prisma: { booking: { findFirst: jest.fn() } },
}));

const mockAuth = auth as unknown as jest.Mock;
const mockFindFirst = (prisma as any).booking.findFirst as jest.Mock;

const booking = {
  id: "ckbooking123",
  confirmationId: "WS-ABC123",
  userId: "user_1",
  date: "2026-07-20",
  time: "09:00",
  timeZone: "Asia/Karachi",
  duration: 60,
  status: "CONFIRMED",
  seatNumber: null,
  venue: {
    name: "Hub",
    address: "1 Main St",
    latitude: 25.39,
    longitude: 68.35,
  },
};

const call = (qs = "") =>
  GET(
    {
      url: `http://localhost/api/bookings/ckbooking123/calendar.ics${qs}`,
    } as any,
    { params: Promise.resolve({ bookingId: "ckbooking123" }) },
  );

describe("GET /api/bookings/[bookingId]/calendar.ics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "user_1" });
    mockFindFirst.mockResolvedValue(booking);
  });

  it("returns 401 when signed out", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    expect((await call()).status).toBe(401);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("returns 404 when the booking is not the caller's", async () => {
    mockFindFirst.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(mockFindFirst.mock.calls[0][0].where.userId).toBe("user_1");
  });

  it("returns a text/calendar attachment", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "text/calendar; charset=utf-8",
    );
    expect(res.headers.get("Content-Disposition")).toContain(
      "WorkSphere_Booking_WS-ABC123.ics",
    );
    const body = await res.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("DTSTART:20260720T040000Z");
    expect(body).toContain("TRIGGER:-PT30M");
  });

  it("supports custom and disabled alarms", async () => {
    expect(await (await call("?alarm=10,120")).text()).toContain(
      "TRIGGER:-PT120M",
    );
    expect(await (await call("?alarm=0")).text()).not.toContain("VALARM");
  });

  it("returns web links with format=links", async () => {
    const res = await call("?format=links");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.googleUrl).toContain("calendar.google.com/calendar/render");
    expect(json.outlookUrl).toContain("outlook.live.com");
    expect(json.icsUrl).toBe("/api/bookings/ckbooking123/calendar.ics");
  });

  it("returns 422 for a booking with an unparseable date", async () => {
    mockFindFirst.mockResolvedValue({ ...booking, date: "bad" });
    expect((await call()).status).toBe(422);
  });

  it("returns 500 on unexpected errors", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockFindFirst.mockRejectedValue(new Error("db down"));
    expect((await call()).status).toBe(500);
  });
});
