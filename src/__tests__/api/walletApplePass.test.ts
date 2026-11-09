import { NextRequest } from "next/server";
import { GET } from "@/app/api/bookings/[bookingId]/wallet/apple/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import {
  buildApplePassJson,
  validatePassJson,
  generatePkpassArchive,
  buildZipArchive,
} from "@/lib/wallet/passService";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findFirst: jest.fn(),
    },
  },
}));

describe("Apple Wallet .pkpass Generation & Validation (#6496)", () => {
  const mockBooking = {
    id: "bkg-123",
    confirmationId: "CONF-8899",
    date: "2026-10-25",
    time: "10:00",
    duration: 120,
    seatNumber: "42A",
    status: "CONFIRMED",
    venue: {
      id: "venue-loft-7",
      name: "Downtown Innovation Loft",
      category: "coworking",
      address: "123 Market St, San Francisco, CA",
      latitude: 37.7749,
      longitude: -122.4194,
      imageUrl: "https://worksphere.app/images/loft.jpg",
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("pass.json Field Validation", () => {
    it("validates compliant pass.json generated from booking details", () => {
      const passJson = buildApplePassJson(mockBooking as any);
      const validation = validatePassJson(passJson);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);

      // Verify essential PassKit fields
      expect(passJson.formatVersion).toBe(1);
      expect(passJson.passTypeIdentifier).toMatch(/^pass\./);
      expect(passJson.serialNumber).toBe("CONF-8899");
      expect(passJson.teamIdentifier).toBeTruthy();
      expect(passJson.organizationName).toBe("WorkSphere");
      expect(passJson.description).toContain("Downtown Innovation Loft");

      // Verify barcode dictionary
      expect(passJson.barcode).toBeDefined();
      expect(passJson.barcode.format).toBe("PKBarcodeFormatQR");
      expect(passJson.barcode.message).toContain("checkin/CONF-8899");
      expect(passJson.barcode.message).toContain("token=");

      // Verify NFC transit turnstile payload
      expect(passJson.nfc).toBeDefined();
      expect(passJson.nfc.message).toContain("WS-NFC:CONF-8899:Desk 42A");
      expect(passJson.nfc.encryptionPublicKey).toBeTruthy();
    });

    it("catches invalid pass.json with missing or malformed required fields", () => {
      // Missing passTypeIdentifier prefix
      const invalidPass1 = {
        formatVersion: 1,
        passTypeIdentifier: "invalid-without-pass-prefix",
        serialNumber: "SN123",
        teamIdentifier: "TEAM1",
        organizationName: "Org",
        description: "Desc",
        barcode: { format: "PKBarcodeFormatQR", message: "data" },
      };
      const res1 = validatePassJson(invalidPass1);
      expect(res1.isValid).toBe(false);
      expect(res1.errors.some((e) => e.includes("pass."))).toBe(true);

      // Missing barcode message
      const invalidPass2 = {
        formatVersion: 1,
        passTypeIdentifier: "pass.com.worksphere",
        serialNumber: "SN123",
        teamIdentifier: "TEAM1",
        organizationName: "Org",
        description: "Desc",
        barcode: { format: "PKBarcodeFormatQR", message: "" },
      };
      const res2 = validatePassJson(invalidPass2);
      expect(res2.isValid).toBe(false);
      expect(res2.errors.some((e) => e.includes("barcode message"))).toBe(true);

      // Unsupported barcode format
      const invalidPass3 = {
        formatVersion: 1,
        passTypeIdentifier: "pass.com.worksphere",
        serialNumber: "SN123",
        teamIdentifier: "TEAM1",
        organizationName: "Org",
        description: "Desc",
        barcode: { format: "INVALID_BARCODE_FORMAT", message: "data" },
      };
      const res3 = validatePassJson(invalidPass3);
      expect(res3.isValid).toBe(false);
      expect(res3.errors.some((e) => e.includes("Invalid barcode format"))).toBe(true);
    });
  });

  describe("PKPASS Binary ZIP Archive Generation", () => {
    it("generates a compliant ZIP archive with PK magic bytes containing all assets", () => {
      const passJson = buildApplePassJson(mockBooking as any);
      const pkpassBuffer = generatePkpassArchive(passJson);

      // Verify PKZIP magic bytes (0x50, 0x4B, 0x03, 0x04)
      expect(pkpassBuffer[0]).toBe(0x50);
      expect(pkpassBuffer[1]).toBe(0x4b);
      expect(pkpassBuffer[2]).toBe(0x03);
      expect(pkpassBuffer[3]).toBe(0x04);

      // Convert buffer to string to verify presence of file entries
      const archiveString = pkpassBuffer.toString("binary");
      expect(archiveString).toContain("pass.json");
      expect(archiveString).toContain("manifest.json");
      expect(archiveString).toContain("signature");
      expect(archiveString).toContain("icon.png");
      expect(archiveString).toContain("logo.png");
    });
  });

  describe("GET /api/bookings/[bookingId]/wallet/apple Route", () => {
    it("returns 401 when user is unauthenticated", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });

      const request = new NextRequest("http://localhost:3000/api/bookings/bkg-123/wallet/apple");
      const context = { params: Promise.resolve({ bookingId: "bkg-123" }) };

      const response = await GET(request, context);
      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toBe("Unauthorized");
    });

    it("returns 404 when booking does not exist", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user-123" });
      (prisma.booking.findFirst as jest.Mock).mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/bookings/bkg-unknown/wallet/apple");
      const context = { params: Promise.resolve({ bookingId: "bkg-unknown" }) };

      const response = await GET(request, context);
      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json.error).toBe("Booking not found");
    });

    it("returns binary .pkpass attachment with correct headers on valid booking", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user-123" });
      (prisma.booking.findFirst as jest.Mock).mockResolvedValue(mockBooking);

      const request = new NextRequest("http://localhost:3000/api/bookings/bkg-123/wallet/apple");
      const context = { params: Promise.resolve({ bookingId: "bkg-123" }) };

      const response = await GET(request, context);
      expect(response.status).toBe(200);

      // Verify Apple Wallet MIME type and download header
      expect(response.headers.get("Content-Type")).toBe("application/vnd.apple.pkpass");
      expect(response.headers.get("Content-Disposition")).toBe(
        'attachment; filename="worksphere-CONF-8899.pkpass"',
      );

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Verify ZIP magic bytes
      expect(buffer[0]).toBe(0x50);
      expect(buffer[1]).toBe(0x4b);
      expect(buffer[2]).toBe(0x03);
      expect(buffer[3]).toBe(0x04);
    });
  });
});
