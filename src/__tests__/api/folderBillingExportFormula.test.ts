import { GET } from "@/app/api/folders/[id]/export-billing/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { hasFolderAccess } from "@/lib/folders";
import { NextRequest } from "next/server";
import { escapeCSVField } from "@/lib/export/csvBuilder";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/folders", () => ({
  hasFolderAccess: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    folderVenue: {
      findMany: jest.fn(),
    },
    booking: {
      findMany: jest.fn(),
    },
  },
}));

describe("Folder billing CSV formula injection prevention (Issue #9791)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("escapeCSVField unit sanitization", () => {
    it("sanitizes dangerous formula prefixes (=, +, -, @, |) on text values", () => {
      expect(escapeCSVField("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
      expect(escapeCSVField("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
      expect(escapeCSVField("-calc")).toBe("'-calc");
      expect(escapeCSVField("@evil_endpoint")).toBe("'@evil_endpoint");
      expect(escapeCSVField("|DDE_EXEC")).toBe("'|DDE_EXEC");
    });

    it("sanitizes formula characters preceded by whitespace or control characters", () => {
      expect(escapeCSVField("   =1+1")).toBe("'   =1+1");
      expect(escapeCSVField("\t@SUM")).toBe("'\t@SUM");
      expect(escapeCSVField("\r=2+2")).toBe('"\'\r=2+2"');
    });

    it("preserves legitimate positive and negative numeric values without formula quotes", () => {
      expect(escapeCSVField(123)).toBe("123");
      expect(escapeCSVField(-45.67)).toBe("-45.67");
      expect(escapeCSVField("45.67")).toBe("45.67");
      expect(escapeCSVField("-100")).toBe("-100");
    });

    it("escapes fields containing commas, double quotes, and newlines per RFC 4180", () => {
      expect(escapeCSVField('Acme, "Main" Office')).toBe(
        '"Acme, ""Main"" Office"',
      );
      expect(escapeCSVField("Row 1\nRow 2")).toBe('"Row 1\nRow 2"');
      expect(escapeCSVField("Row 1\r\nRow 2")).toBe('"Row 1\r\nRow 2"');
    });

    it("handles formula triggers inside strings that also contain commas or quotes", () => {
      expect(escapeCSVField('=HYPERLINK("http://evil.com", "Click")')).toBe(
        '"\'=HYPERLINK(""http://evil.com"", ""Click"")"',
      );
    });
  });

  describe("GET /api/folders/[id]/export-billing sanitization", () => {
    it("sanitizes billing codes, confirmation IDs, and venue names with formula prefixes", async () => {
      (auth as jest.Mock).mockResolvedValue({ userId: "owner-1" });
      (hasFolderAccess as jest.Mock).mockResolvedValue({
        folder: { id: "f-1", name: "Injected Folder" },
        hasAccess: true,
        role: "OWNER",
      });

      (prisma.folderVenue.findMany as jest.Mock).mockResolvedValue([
        { venueId: "v-1" },
      ]);
      (prisma.booking.findMany as jest.Mock).mockResolvedValue([
        {
          date: "2026-11-20",
          duration: 60,
          confirmationId: "=CMD|' /C calc'!A0",
          projectBillingCode: "+PROJ-INJECT",
          customerEmail: "user@test.com",
          venue: { name: '@EvilVenue, "Special"' },
          user: {
            firstName: "-Admin",
            lastName: "User",
            email: "=evil@domain.com",
          },
        },
      ]);

      const req = new NextRequest(
        "http://localhost:3000/api/folders/f-1/export-billing",
      );
      const res = await GET(req, { params: Promise.resolve({ id: "f-1" }) });

      expect(res.status).toBe(200);
      const csv = await res.text();

      // Formula triggers must be prefixed with a single quote
      expect(csv).toContain("'+PROJ-INJECT");
      expect(csv).toContain("'=CMD|' /C calc'!A0");
      expect(csv).toContain("'-Admin User");
      expect(csv).toContain("'=evil@domain.com");

      // Double quotes and commas must be safely escaped per RFC 4180
      expect(csv).toContain('"\'@EvilVenue, ""Special"""');

      // Numeric fields must not be prepended with apostrophe
      expect(csv).toContain("60");
      expect(csv).toContain("30.00");
    });
  });
});
