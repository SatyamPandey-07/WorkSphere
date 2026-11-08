import { ensureUserExists } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { generateBookingItineraryPdf } from "@/lib/pdfGenerator";

export const dynamic = "force-dynamic";

/** GET /api/bookings/:bookingId/itinerary — PDF itinerary with QR code verification badge for one of the caller's bookings. */
export async function GET(
  _req: NextRequest,
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

    const pdf = await generateBookingItineraryPdf(booking);
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="WorkSphere_Itinerary_${booking.confirmationId || booking.id}.pdf"`,
        "Content-Length": pdf.byteLength.toString(),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[Booking Itinerary Error]:", error);
    return NextResponse.json(
      { error: "Failed to generate itinerary" },
      { status: 500 },
    );
  }
}
