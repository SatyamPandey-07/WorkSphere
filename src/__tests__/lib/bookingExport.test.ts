import { GET, escapeCsvField } from "@/app/api/bookings/export/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
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
  });

  test("exports bookings in properly escaped CSV format with formula injection protection", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });
    (prisma.booking.findMany as jest.Mock).mockResolvedValueOnce([
      {
        id: "b-001",
        userId: "user_123",
        status: "CONFIRMED",
        bookingDate: new Date("2026-11-15T10:00:00Z"),
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
  });
});
