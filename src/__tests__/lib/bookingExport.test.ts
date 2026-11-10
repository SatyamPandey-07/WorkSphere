import { GET } from "@/app/api/bookings/export/route";
import { auth } from "@clerk/nextjs/server";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@prisma/client", () => {
  const mPrisma = {
    booking: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "b-001",
          userId: "user_123",
          status: "CONFIRMED",
          bookingDate: new Date("2026-11-15T10:00:00Z"),
          durationMinutes: 120,
          price: 45.0,
          currency: "USD",
          createdAt: new Date("2026-11-10T08:00:00Z"),
          venue: {
            name: 'CoWork "Hub" Central',
            address: "123 Main St, Floor 4",
          },
        },
      ]),
    },
  };
  return { PrismaClient: jest.fn(() => mPrisma) };
});

describe("GET /api/bookings/export", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("returns 401 when request is unauthenticated", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: null });
    const req = new Request("http://localhost:3000/api/bookings/export");
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  test("exports bookings in JSON format by default for authenticated user", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });
    const req = new Request("http://localhost:3000/api/bookings/export");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("content-disposition")).toContain("worksphere-bookings-");

    const data = await res.json();
    expect(data.bookings.length).toBe(1);
    expect(data.bookings[0].id).toBe("b-001");
  });

  test("exports bookings in properly escaped CSV format", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });
    const req = new Request("http://localhost:3000/api/bookings/export?format=csv");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain(".csv");

    const text = await res.text();
    expect(text).toContain("Booking ID,Venue Name,Address");
    // Verifies quotes escaping inside CSV fields
    expect(text).toContain('"CoWork ""Hub"" Central"');
  });
});