import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import {
  buildBookingCalendarEvent,
  buildGoogleCalendarLink,
  buildOutlookWebLink,
  generateBookingIcs,
} from "@/lib/calendar/icsGenerator";

export const dynamic = "force-dynamic";

const MAX_ALARM_MINUTES = 10_080;

/**
 * GET /api/bookings/:bookingId/calendar.ics
 *
 * Returns an RFC 5545 .ics file for one of the caller's bookings.
 *   ?alarm=15,60   reminder offsets in minutes before start (default 30, 0 disables)
 *   ?format=links  JSON with one click Google Calendar and Outlook Web links
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
    const url = new URL(req.url);

    const booking = await prisma.booking.findFirst({
      where: {
        OR: [{ id: bookingId }, { confirmationId: bookingId }],
        userId,
      },
      include: { venue: true },
    });

    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const input = {
      id: booking.id,
      confirmationId: booking.confirmationId,
      date: booking.date,
      time: booking.time,
      timeZone: booking.timeZone,
      duration: booking.duration,
      status: booking.status,
      seatNumber: booking.seatNumber,
      venue: {
        name: booking.venue.name,
        address: booking.venue.address,
        latitude: booking.venue.latitude,
        longitude: booking.venue.longitude,
      },
    };

    const event = buildBookingCalendarEvent(input);
    if (!event) {
      return NextResponse.json(
        { error: "Booking has an invalid date or time" },
        { status: 422 },
      );
    }

    if (url.searchParams.get("format") === "links") {
      return NextResponse.json(
        {
          googleUrl: buildGoogleCalendarLink(event),
          outlookUrl: buildOutlookWebLink(event, "personal"),
          outlookWorkUrl: buildOutlookWebLink(event, "work"),
          icsUrl: `/api/bookings/${encodeURIComponent(booking.id)}/calendar.ics`,
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const alarmParam = url.searchParams.get("alarm");
    let alarmMinutes: number[] | undefined;
    if (alarmParam !== null) {
      alarmMinutes = alarmParam
        .split(",")
        .map((v) => Number(v.trim()))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= MAX_ALARM_MINUTES);
    }

    const ics = generateBookingIcs(input, { alarmMinutes });
    if (!ics) {
      return NextResponse.json(
        { error: "Booking has an invalid date or time" },
        { status: 422 },
      );
    }

    const safeName = (booking.confirmationId || booking.id).replace(
      /[^A-Za-z0-9_-]/g,
      "",
    );
    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="WorkSphere_Booking_${safeName}.ics"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[Booking Calendar ICS Error]:", error);
    return NextResponse.json(
      { error: "Failed to generate calendar file" },
      { status: 500 },
    );
  }
}
