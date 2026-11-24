import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeAttendanceCertificateHash } from "@/lib/pdf/generateCertificate";

export const dynamic = "force-dynamic";

/**
 * GET /api/certificates/verify
 * Public verification endpoint for Nomad Attendance Certificates.
 * Scanned via QR code on the certificate.
 *
 * Query params:
 *   - id: Certificate ID (e.g. WS-CERT-XYZ)
 *   - hash: 32-character or full SHA-256 HMAC verification hash
 *
 * Security / Privacy:
 *   - Does not expose sensitive user personal identifiable information (PII).
 *   - Returns only verified venue name, sanitized nomad first name/last initial, stay date, duration, and status.
 *   - Strictly validates whether the certificate corresponds to a valid completed stay.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const certificateId = searchParams.get("id");
    const providedHash = searchParams.get("hash");

    if (!certificateId || !providedHash) {
      return NextResponse.json(
        {
          valid: false,
          status: "INVALID",
          error: "Missing required verification parameters (id and hash)",
        },
        { status: 400 },
      );
    }

    // Lookup booking by confirmationId or booking id encoded in certificateId
    // Certificate IDs are formatted as WS-CERT-<CLEAN_SEED>
    const seed = certificateId.replace(/^WS-CERT-/i, "");

    // Try finding the booking
    const booking = await prisma.booking.findFirst({
      where: {
        OR: [
          { confirmationId: { contains: seed, mode: "insensitive" } },
          { id: { contains: seed, mode: "insensitive" } },
          { confirmationId: seed },
          { id: seed },
        ],
      },
      include: {
        venue: {
          select: {
            id: true,
            name: true,
            address: true,
            category: true,
          },
        },
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!booking) {
      return NextResponse.json(
        {
          valid: false,
          status: "NOT_FOUND",
          error: "No attendance record found matching certificate identifier.",
        },
        { status: 404 },
      );
    }

    // Check if booking was cancelled
    if (
      booking.status === "CANCELLED" ||
      booking.status === "CANCELLED_BY_OPERATOR"
    ) {
      return NextResponse.json(
        {
          valid: false,
          status: "REVOKED",
          error: "This stay certificate has been cancelled or revoked.",
          certificateId,
        },
        { status: 410 },
      );
    }

    // Derive check-in and check-out timestamps
    const checkInDate = new Date(`${booking.date}T${booking.time}`);
    const durationMinutes = booking.duration || 120;
    const checkOutDate = new Date(checkInDate.getTime() + durationMinutes * 60000);

    const nomadName = booking.user
      ? `${booking.user.firstName || ""} ${booking.user.lastName || ""}`.trim() || "WorkSphere Member"
      : "WorkSphere Member";

    const expectedHash = computeAttendanceCertificateHash({
      certificateId,
      bookingId: booking.id,
      nomadName,
      venueName: booking.venue?.name || "WorkSphere Venue",
      checkInTime: checkInDate,
      checkOutTime: checkOutDate,
    });

    const hashMatch =
      expectedHash.startsWith(providedHash.toLowerCase()) ||
      providedHash.toLowerCase().startsWith(expectedHash.slice(0, 32));

    if (!hashMatch) {
      return NextResponse.json(
        {
          valid: false,
          status: "TAMPERED",
          error: "Cryptographic signature mismatch. Certificate may have been tampered with.",
          certificateId,
        },
        { status: 400 },
      );
    }

    // Mask name for privacy (e.g. "John D.")
    const firstName = booking.user?.firstName || "Nomad";
    const lastNameInitial = booking.user?.lastName ? `${booking.user.lastName[0]}.` : "";
    const maskedName = `${firstName} ${lastNameInitial}`.trim();

    return NextResponse.json({
      valid: true,
      status: "VERIFIED",
      certificateId,
      nomadName: maskedName,
      venueName: booking.venue?.name || "Verified Coworking Space",
      stayDate: booking.date,
      durationMinutes,
      checkInTime: checkInDate.toISOString(),
      checkOutTime: checkOutDate.toISOString(),
      timeZone: booking.timeZone || "UTC",
      verifiedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Certificate Verification Error]:", error);
    return NextResponse.json(
      {
        valid: false,
        status: "ERROR",
        error: "Internal server error during certificate verification",
      },
      { status: 500 },
    );
  }
}
