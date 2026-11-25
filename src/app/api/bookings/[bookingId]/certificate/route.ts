import { ensureUserExists } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { generateNomadAttendanceCertificate } from "@/lib/pdf/generateCertificate";

export const dynamic = "force-dynamic";

/**
 * GET /api/bookings/:bookingId/certificate
 * Generates and downloads the Nomad Attendance Certificate PDF for an authenticated user's completed stay.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ bookingId: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureUserExists(userId);

    const { bookingId } = await context.params;
    const booking = await prisma.booking.findFirst({
      where: {
        OR: [{ id: bookingId }, { confirmationId: bookingId }],
        userId,
      },
      include: { venue: true, user: true },
    });

    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    if (
      booking.status === "CANCELLED" ||
      booking.status === "CANCELLED_BY_OPERATOR"
    ) {
      return NextResponse.json(
        { error: "Cannot generate attendance certificate for a cancelled booking." },
        { status: 400 },
      );
    }

    // Determine check-in and check-out
    const checkInDate = new Date(`${booking.date}T${booking.time}`);
    if (isNaN(checkInDate.getTime())) {
      return NextResponse.json(
        { error: "Booking has invalid check-in date/time." },
        { status: 400 },
      );
    }

    const durationMinutes = booking.duration || 120;
    const checkOutDate = new Date(checkInDate.getTime() + durationMinutes * 60000);

    const nomadName = booking.user
      ? `${booking.user.firstName || ""} ${booking.user.lastName || ""}`.trim() || booking.user.email || "WorkSphere Nomad"
      : booking.customerEmail || "WorkSphere Nomad";

    const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
    const proto = req.headers.get("x-forwarded-proto") || "https";
    const baseUrl = host ? `${proto}://${host}` : undefined;

    const pdfBytes = await generateNomadAttendanceCertificate(
      {
        bookingId: booking.id,
        confirmationId: booking.confirmationId,
        nomadName,
        nomadEmail: booking.user?.email || booking.customerEmail,
        venueName: booking.venue?.name || "WorkSphere Coworking Space",
        venueAddress: booking.venue?.address || "Address verified on check-in",
        venueCategory: booking.venue?.category || "Coworking Space",
        checkInTime: checkInDate,
        checkOutTime: checkOutDate,
        timeZone: booking.timeZone || "UTC",
        status: booking.status,
        seatNumber: booking.seatNumber,
      },
      { baseUrl },
    );

    const filename = `worksphere-attendance-certificate-${booking.confirmationId || booking.id}.pdf`;

    return new Response(new Uint8Array(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": pdfBytes.byteLength.toString(),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[Booking Certificate Error]:", error);
    return NextResponse.json(
      { error: "Failed to generate attendance certificate" },
      { status: 500 },
    );
  }
}
