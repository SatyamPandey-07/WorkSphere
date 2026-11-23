import { GET, POST, escapeCsvField } from "@/app/api/bookings/export/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/queue", () => ({
  pushJob: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "b-001",
          userId: "user_123",
          status: "CONFIRMED",
          date: "2026-11-15",
          time: "10:00",
          timeZone: "UTC",
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
  },
}));

describe("escapeCsvField formula-injection mitigation (Issue #9523)", () => {
  it("mitigates dangerous formula prefixes (=, +, -, @, |, %)", () => {
    expect(escapeCsvField("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
    expect(escapeCsvField("+CMD|' /C calc'!A0")).toBe("'+CMD|' /C calc'!A0");
    expect(escapeCsvField("-2+3*[calc]")).toBe("'-2+3*[calc]");
    expect(escapeCsvField("@malicious_call")).toBe("'@malicious_call");
    expect(escapeCsvField("|DDE_COMMAND")).toBe("'|DDE_COMMAND");
    expect(escapeCsvField("%0Acalc")).toBe("'%0Acalc");
  });

  it("mitigates leading control characters (tab, CR, newline)", () => {
    expect(escapeCsvField("\tTabInjected")).toBe("'\tTabInjected");
    expect(escapeCsvField("\rCarriageReturn")).toBe('"\'\rCarriageReturn"');
    expect(escapeCsvField("\nNewlineInjected")).toBe('"\'\nNewlineInjected"');
  });

  it("mitigates leading whitespace followed by formula triggers", () => {
    expect(escapeCsvField("  =SUM(1+1)")).toBe("'  =SUM(1+1)");
    expect(escapeCsvField("   +CMD")).toBe("'   +CMD");
    expect(escapeCsvField(" \t-2+3")).toBe("' \t-2+3");
    expect(escapeCsvField("    @remote")).toBe("'    @remote");
  });

  it("mitigates formula triggers inside venue names and addresses", () => {
    expect(escapeCsvField("=Danger Lounge")).toBe("'=Danger Lounge");
    expect(escapeCsvField("+44 20 7946 0958")).toBe("'+44 20 7946 0958");
    expect(escapeCsvField("-100 Main St")).toBe("'-100 Main St");
    expect(escapeCsvField("  @Central Workspace")).toBe(
      "'  @Central Workspace",
    );
  });

  it("preserves ordinary text without modification", () => {
    expect(escapeCsvField("CONFIRMED")).toBe("CONFIRMED");
    expect(escapeCsvField("USD")).toBe("USD");
    expect(escapeCsvField("b-001")).toBe("b-001");
    expect(escapeCsvField("Ordinary Venue")).toBe("Ordinary Venue");
  });

  it("escapes fields containing quotes, commas, and newlines in accordance with RFC 4180", () => {
    expect(escapeCsvField('CoWork "Hub" Central')).toBe(
      '"CoWork ""Hub"" Central"',
    );
    expect(escapeCsvField("123 Main St, Floor 4")).toBe(
      '"123 Main St, Floor 4"',
    );
    expect(escapeCsvField("Line1\nLine2")).toBe('"Line1\nLine2"');
    expect(escapeCsvField("Line1\r\nLine2")).toBe('"Line1\r\nLine2"');
  });

  it("correctly handles formula prefixes combined with commas or quotes", () => {
    expect(escapeCsvField("=SUM(A1, A2)")).toBe('"\'=SUM(A1, A2)"');
    expect(escapeCsvField('="+CMD"')).toBe('"\'=""+CMD"""');
  });

  it("preserves positive numeric values without apostrophes", () => {
    expect(escapeCsvField(120)).toBe("120");
    expect(escapeCsvField(45.5)).toBe("45.5");
    expect(escapeCsvField(0)).toBe("0");
    expect(escapeCsvField("120", true)).toBe("120");
  });

  it("preserves legitimate negative numeric values as numbers without formula apostrophe prefixes", () => {
    expect(escapeCsvField(-10)).toBe("-10");
    expect(escapeCsvField(-15.5)).toBe("-15.5");
    expect(escapeCsvField("-25")).toBe("-25");
    expect(escapeCsvField("-25.75")).toBe("-25.75");
    expect(escapeCsvField(-10, true)).toBe("-10");
  });

  it("returns empty string for null and undefined", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });
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

  test("exports bookings in JSON format by default for authenticated user without altering raw data", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });
    const req = new Request("http://localhost:3000/api/bookings/export");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("content-disposition")).toContain(
      "worksphere-bookings-",
    );

    const data = await res.json();
    expect(data.bookings.length).toBe(1);
    expect(data.bookings[0].id).toBe("b-001");
    expect(data.bookings[0].venueName).toBe('CoWork "Hub" Central');
    expect(data.bookings[0].date).toBe("2026-11-15");
    expect(data.bookings[0].time).toBe("10:00");
    expect(data.bookings[0].timeZone).toBe("UTC");
    expect(data.bookings[0].bookingDate).toBe("2026-11-15T10:00:00.000Z");
  });

  test("exports bookings in properly escaped CSV format with formula injection protection", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });
    (prisma.booking.findMany as jest.Mock).mockResolvedValueOnce([
      {
        id: "b-001",
        userId: "user_123",
        status: "CONFIRMED",
        date: "2026-11-15",
        time: "10:00",
        timeZone: "UTC",
        durationMinutes: 120,
        price: -15.5, // Negative discount/refund price
        currency: "USD",
        createdAt: new Date("2026-11-10T08:00:00Z"),
        venue: {
          name: '=CMD|calc!"A0"',
          address: "123 Main St, Floor 4",
        },
      },
    ]);

    const req = new Request(
      "http://localhost:3000/api/bookings/export?format=csv",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain(".csv");

    const text = await res.text();
    expect(text).toContain("Booking ID,Venue Name,Address");
    // Verifies formula injection mitigation on venue name
    expect(text).toContain('\'=CMD|calc!""A0"""');
    // Verifies commas escaping inside CSV fields
    expect(text).toContain('"123 Main St, Floor 4"');
    // Verifies negative price is preserved numerically without apostrophe
    expect(text).toContain("-15.5");
    // Verifies reservation date and time are used in CSV
    expect(text).toContain("2026-11-15,10:00");
  });

  test("exports authoritative reservation schedule rather than booking creation timestamp", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });
    (prisma.booking.findMany as jest.Mock).mockResolvedValueOnce([
      {
        id: "booking-future-1",
        userId: "user_123",
        status: "CONFIRMED",
        date: "2026-12-25",
        time: "15:30",
        timeZone: "America/New_York",
        durationMinutes: 60,
        price: 25.0,
        currency: "USD",
        createdAt: new Date("2026-11-01T08:00:00Z"),
        venue: {
          name: "Future Workspace",
          address: "789 Innovation Way",
        },
      },
    ]);

    const jsonReq = new Request("http://localhost:3000/api/bookings/export");
    const jsonRes = await GET(jsonReq);
    expect(jsonRes.status).toBe(200);
    const jsonData = await jsonRes.json();

    const booking = jsonData.bookings[0];
    expect(booking.date).toBe("2026-12-25");
    expect(booking.time).toBe("15:30");
    expect(booking.timeZone).toBe("America/New_York");
    // Does not fall back to createdAt (2026-11-01)
    expect(booking.bookingDate).not.toContain("2026-11-01");
    // Converts 15:30 EST (UTC-5) to 20:30 UTC
    expect(booking.bookingDate).toBe("2026-12-25T20:30:00.000Z");
    expect(booking.createdAt).toBe("2026-11-01T08:00:00.000Z");
  });

  test("produces consistent date and time values across JSON and CSV exports", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });
    const mockRecord = {
      id: "booking-consistent-1",
      userId: "user_123",
      status: "CONFIRMED",
      date: "2027-01-10",
      time: "09:00",
      timeZone: "UTC",
      durationMinutes: 90,
      price: 35.0,
      currency: "USD",
      createdAt: new Date("2026-11-05T12:00:00Z"),
      venue: {
        name: "Consistent Hub",
        address: "100 Tech Blvd",
      },
    };

    (prisma.booking.findMany as jest.Mock).mockResolvedValueOnce([mockRecord]);
    const jsonRes = await GET(
      new Request("http://localhost:3000/api/bookings/export"),
    );
    const jsonData = await jsonRes.json();
    const jsonBooking = jsonData.bookings[0];

    (prisma.booking.findMany as jest.Mock).mockResolvedValueOnce([mockRecord]);
    const csvRes = await GET(
      new Request("http://localhost:3000/api/bookings/export?format=csv"),
    );
    const csvText = await csvRes.text();

    expect(jsonBooking.date).toBe("2027-01-10");
    expect(jsonBooking.time).toBe("09:00");
    expect(csvText).toContain("2027-01-10,09:00");
  });
});

describe("POST /api/bookings/export", () => {
  const mockBooking = {
    id: "booking-101",
    userId: "user_123",
    confirmationId: "WS-#101",
    date: "2026-11-20",
    time: "14:00",
    duration: 120,
    status: "CONFIRMED",
    projectBillingCode: "PROJ-TAX",
    createdAt: new Date("2026-11-10T10:00:00Z"),
    venue: {
      name: "Downtown CoWork",
      category: "Dedicated Desk",
      address: "456 Market St",
    },
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when request is unauthenticated", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: null });
    const req = new Request("http://localhost:3000/api/bookings/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingIds: ["booking-101"], format: "csv" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when body has an invalid export format", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });
    const req = new Request("http://localhost:3000/api/bookings/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingIds: ["booking-101"], format: "invalid" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid export format");
  });

  it("returns 400 when no bookings or date range are selected", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });
    const req = new Request("http://localhost:3000/api/bookings/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingIds: [] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("No bookings selected");
  });

  it("returns 404 when no matching bookings are found for selected IDs", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });
    (prisma.booking.findMany as jest.Mock).mockResolvedValueOnce([]);

    const req = new Request("http://localhost:3000/api/bookings/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingIds: ["non-existent"], format: "csv" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("exports selected bookings in CSV format via POST", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });
    (prisma.booking.findMany as jest.Mock).mockResolvedValueOnce([mockBooking]);

    const req = new Request("http://localhost:3000/api/bookings/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingIds: ["booking-101"], format: "csv" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain(
      'filename="WorkSphere_Bookings_',
    );

    const csv = await res.text();
    expect(csv).toContain("Confirmation ID,Venue Name,Category,Address");
    expect(csv).toContain("WS-#101");
    expect(csv).toContain("Downtown CoWork");
  });

  it("exports selected bookings in XLSX format via POST", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });
    (prisma.booking.findMany as jest.Mock).mockResolvedValueOnce([mockBooking]);

    const req = new Request("http://localhost:3000/api/bookings/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingIds: ["booking-101"], format: "xlsx" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers.get("content-disposition")).toContain(".xlsx");
  });

  it("exports selected bookings in PDF format via POST", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });
    (prisma.booking.findMany as jest.Mock).mockResolvedValueOnce([mockBooking]);

    const req = new Request("http://localhost:3000/api/bookings/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingIds: ["booking-101"], format: "pdf" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    expect(res.headers.get("content-disposition")).toContain(".pdf");
  });

  it("queues PDF tax export job and returns jobId for TaxExportModal", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });

    const req = new Request("http://localhost:3000/api/bookings/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "pdf", taxYear: "2026" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.jobId).toBeDefined();
    expect(typeof data.jobId).toBe("string");
  });

  it("exports tax summary in CSV format for TaxExportModal", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });
    (prisma.booking.findMany as jest.Mock).mockResolvedValueOnce([mockBooking]);

    const req = new Request("http://localhost:3000/api/bookings/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "csv", taxYear: "2026" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv).toContain("Downtown CoWork");
  });

  it("exports tax summary in XLSX format for custom date range in TaxExportModal", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });
    (prisma.booking.findMany as jest.Mock).mockResolvedValueOnce([mockBooking]);

    const req = new Request("http://localhost:3000/api/bookings/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format: "xlsx",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });
});
