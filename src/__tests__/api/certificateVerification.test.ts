import { NextRequest } from "next/server";
import { GET as verifyCertificateHandler } from "@/app/api/certificates/verify/route";
import { prisma } from "@/lib/prisma";
import { computeAttendanceCertificateHash } from "@/lib/pdf/generateCertificate";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findFirst: jest.fn(),
    },
  },
}));

describe("Certificate Verification API Route (/api/certificates/verify)", () => {
  const mockBooking = {
    id: "booking_abc123",
    confirmationId: "WS-CONF-9876",
    date: "2026-11-20",
    time: "09:30",
    duration: 180,
    status: "COMPLETED",
    timeZone: "America/New_York",
    venue: {
      id: "v1",
      name: "Manhattan Nomad Hub",
      address: "350 5th Ave, New York, NY",
      category: "Coworking Space",
    },
    user: {
      id: "u1",
      firstName: "Sarah",
      lastName: "Connor",
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 400 when id or hash query parameters are missing", async () => {
    const req1 = new NextRequest("https://worksphere.app/api/certificates/verify");
    const res1 = await verifyCertificateHandler(req1);
    expect(res1.status).toBe(400);
    const json1 = await res1.json();
    expect(json1.error).toContain("Missing required verification parameters");

    const req2 = new NextRequest(
      "https://worksphere.app/api/certificates/verify?id=WS-CERT-123",
    );
    const res2 = await verifyCertificateHandler(req2);
    expect(res2.status).toBe(400);
  });

  it("returns 404 when certificate record is not found in database", async () => {
    (prisma.booking.findFirst as jest.Mock).mockResolvedValueOnce(null);

    const req = new NextRequest(
      "https://worksphere.app/api/certificates/verify?id=WS-CERT-UNKNOWN&hash=somehash",
    );
    const res = await verifyCertificateHandler(req);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.status).toBe("NOT_FOUND");
  });

  it("returns 410 REVOKED when the booking was cancelled", async () => {
    (prisma.booking.findFirst as jest.Mock).mockResolvedValueOnce({
      ...mockBooking,
      status: "CANCELLED",
    });

    const req = new NextRequest(
      "https://worksphere.app/api/certificates/verify?id=WS-CERT-9876&hash=somehash",
    );
    const res = await verifyCertificateHandler(req);
    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json.status).toBe("REVOKED");
    expect(json.error).toContain("cancelled or revoked");
  });

  it("returns 400 TAMPERED when the cryptographic hash does not match stay facts", async () => {
    (prisma.booking.findFirst as jest.Mock).mockResolvedValueOnce(mockBooking);

    const req = new NextRequest(
      "https://worksphere.app/api/certificates/verify?id=WS-CERT-9876&hash=invalidforgedhash1234567890abcdef",
    );
    const res = await verifyCertificateHandler(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.status).toBe("TAMPERED");
    expect(json.error).toContain("signature mismatch");
  });

  it("returns 200 VERIFIED with masked privacy fields when hash is authentic", async () => {
    (prisma.booking.findFirst as jest.Mock).mockResolvedValueOnce(mockBooking);

    const checkInDate = new Date(`${mockBooking.date}T${mockBooking.time}`);
    const checkOutDate = new Date(checkInDate.getTime() + mockBooking.duration * 60000);

    const validHash = computeAttendanceCertificateHash({
      certificateId: "WS-CERT-9876",
      bookingId: mockBooking.id,
      nomadName: "Sarah Connor",
      venueName: "Manhattan Nomad Hub",
      checkInTime: checkInDate,
      checkOutTime: checkOutDate,
    });

    const req = new NextRequest(
      `https://worksphere.app/api/certificates/verify?id=WS-CERT-9876&hash=${validHash.slice(0, 32)}`,
    );
    const res = await verifyCertificateHandler(req);
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.valid).toBe(true);
    expect(json.status).toBe("VERIFIED");
    expect(json.certificateId).toBe("WS-CERT-9876");
    // Privacy check: lastName should be masked to initial "Connor" -> "Sarah C."
    expect(json.nomadName).toBe("Sarah C.");
    expect(json.venueName).toBe("Manhattan Nomad Hub");
    expect(json.stayDate).toBe("2026-11-20");
    expect(json.durationMinutes).toBe(180);
  });
});
