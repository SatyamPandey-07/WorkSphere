import { NextRequest } from "next/server";
import { GET } from "@/app/api/bookings/history/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { ensureUserExists } from "@/lib/auth";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  ensureUserExists: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findMany: jest.fn(),
    },
  },
}));

describe("GET /api/bookings/history - Cursor-based pagination (#3516)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user-123" });
    (ensureUserExists as unknown as jest.Mock).mockResolvedValue(undefined);
  });

  it("returns 401 when user is unauthorized", async () => {
    (auth as unknown as jest.Mock).mockResolvedValueOnce({ userId: null });
    const req = new NextRequest("http://localhost/api/bookings/history");
    const res = await GET(req);

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns paginated bookings with nextCursor and hasMore = false when total <= take", async () => {
    const mockBookings = [
      { id: "b1", date: "2026-10-01", time: "10:00", venue: { name: "Lab A" } },
      { id: "b2", date: "2026-09-28", time: "14:00", venue: { name: "Lab B" } },
    ];
    (prisma.booking.findMany as jest.Mock).mockResolvedValueOnce(mockBookings);

    const req = new NextRequest("http://localhost/api/bookings/history?take=20");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.bookings).toEqual(mockBookings);
    expect(data.hasMore).toBe(false);
    expect(data.nextCursor).toBeNull();

    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-123" },
        take: 21,
      }),
    );
  });

  it("returns nextCursor and hasMore = true when more items exist", async () => {
    const mockBookings = [
      { id: "b1", date: "2026-10-01", time: "10:00" },
      { id: "b2", date: "2026-09-28", time: "14:00" },
      { id: "b3", date: "2026-09-20", time: "09:00" }, // 3rd item indicates hasMore when take=2
    ];
    (prisma.booking.findMany as jest.Mock).mockResolvedValueOnce(mockBookings);

    const req = new NextRequest("http://localhost/api/bookings/history?take=2");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.bookings).toHaveLength(2);
    expect(data.hasMore).toBe(true);
    expect(data.nextCursor).toBe("b2");
  });

  it("applies cursor and skip: 1 when cursor query parameter is provided", async () => {
    (prisma.booking.findMany as jest.Mock).mockResolvedValueOnce([
      { id: "b3", date: "2026-09-20", time: "09:00" },
    ]);

    const req = new NextRequest("http://localhost/api/bookings/history?cursor=b2&take=5");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: "b2" },
        skip: 1,
        take: 6,
      }),
    );
  });

  it("supports sorting by date in ascending and descending order", async () => {
    (prisma.booking.findMany as jest.Mock).mockResolvedValueOnce([]);

    // asc
    const reqAsc = new NextRequest("http://localhost/api/bookings/history?sort=asc");
    await GET(reqAsc);
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { date: "asc" },
          { time: "asc" },
          { id: "asc" },
        ],
      }),
    );

    // desc (default)
    const reqDesc = new NextRequest("http://localhost/api/bookings/history?sort=desc");
    await GET(reqDesc);
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { date: "desc" },
          { time: "desc" },
          { id: "desc" },
        ],
      }),
    );
  });

  it("filters by status (CONFIRMED, CANCELLED, COMPLETED)", async () => {
    (prisma.booking.findMany as jest.Mock).mockResolvedValue([]);

    // CONFIRMED
    await GET(new NextRequest("http://localhost/api/bookings/history?status=CONFIRMED"));
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "CONFIRMED" }),
      }),
    );

    // CANCELLED
    await GET(new NextRequest("http://localhost/api/bookings/history?status=CANCELLED"));
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "CANCELLED" }),
      }),
    );

    // COMPLETED
    await GET(new NextRequest("http://localhost/api/bookings/history?status=COMPLETED"));
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-123",
          OR: expect.arrayContaining([
            { status: "COMPLETED" },
            expect.objectContaining({ status: "CONFIRMED" }),
          ]),
        }),
      }),
    );
  });

  it("gracefully handles invalid/missing cursor errors (P2025)", async () => {
    const error: any = new Error("Record to use, neither exists nor is accessible");
    error.code = "P2025";
    (prisma.booking.findMany as jest.Mock).mockRejectedValueOnce(error);

    const req = new NextRequest("http://localhost/api/bookings/history?cursor=invalid-id");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.bookings).toEqual([]);
    expect(data.hasMore).toBe(false);
    expect(data.nextCursor).toBeNull();
  });
});
