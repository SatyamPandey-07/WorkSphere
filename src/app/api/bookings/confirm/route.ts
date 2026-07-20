import { NextResponse, after } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { eventBus } from "@/core/events";
import "@/core/subscribers/booking";
import "@/core/subscribers/discord";
import "@/core/subscribers/whatsapp";
import "@/core/subscribers/guests";
import "@/core/subscribers/telegram";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 0. Ensure Identity 💎
    await ensureUserExists(userId);

    const {
      venue,
      date,
      dates: inputDates,
      time,
      customerEmail,
      customerPhone,
      projectBillingCode,
    } = await req.json();

    if (!venue) {
      return NextResponse.json(
        { error: "Missing venue data" },
        { status: 400 },
      );
    }

    const bookingDates = inputDates || (date ? [date] : []);
    if (bookingDates.length === 0) {
      return NextResponse.json(
        { error: "Missing booking dates" },
        { status: 400 },
      );
    }

    const confirmationId = `WS-#${Math.floor(100000 + Math.random() * 900000)}`;
    const targetPlaceId = venue.placeId || venue.id;

    // --- CONCURRENCY FIX IMPLEMENTATION ---
    // Wrap database steps inside an interactive transaction to prevent key collisions
    const { bookings, dbVenue } = await prisma.$transaction(async (tx) => {
      // 0.5 Ensure Venue exists in local ledger via transaction client
      const localVenue = await tx.venue.upsert({
        where: { placeId: targetPlaceId },
        update: {
          name: venue.name || "Unknown Venue",
          address: venue.address || null,
          category: venue.category || "other",
        },
        create: {
          placeId: targetPlaceId,
          name: venue.name || "Unknown Venue",
          latitude: venue.latitude || venue.lat || 0,
          longitude: venue.longitude || venue.lng || 0,
          category: venue.category || "other",
          address: venue.address || null,
        },
      });

      // Double check race condition inside the isolated transaction window
      const existingBookings = await tx.booking.findMany({
        where: {
          venueId: localVenue.id,
          date: { in: bookingDates },
          time: time,
        },
      });

      if (existingBookings.length > 0) {
        throw new Error(
          "COLLISION: One or more workspace slots have already been claimed by another runtime thread.",
        );
      }

      // 1. Persist to Database safely using transaction context
      const createdBookings = [];
      for (const d of bookingDates) {
        const newBooking = await (tx as any).booking.create({
          data: {
            userId,
            venueId: localVenue.id,
            date: d,
            time,
            customerEmail: customerEmail || "pandeysatyam1802@gmail.com",
            customerPhone: customerPhone || null,
            projectBillingCode: projectBillingCode || null,
            confirmationId,
          },
        });
        createdBookings.push(newBooking);
      }

      return { bookings: createdBookings, dbVenue: localVenue };
    });
    // --- END OF FIX ---

    // 2. Emit Booking Confirmed Event to handle Side-Effects (PDF, Email, Analytics)
    // --- ASYNC PDF FIX IMPLEMENTATION (#518) ---
    after(async () => {
      try {
        for (const booking of bookings) {
          await eventBus.emit("booking:confirmed", {
            bookingId: booking.id,
            confirmationId,
            venue: {
              id: dbVenue.id,
              name: venue.name || "Unknown Venue",
              category: venue.category || "other",
              address: venue.address || undefined,
            },
            customerEmail: customerEmail || "pandeysatyam1802@gmail.com",
            date: booking.date,
            time,
          });
        }
      } catch (backgroundError) {
        console.error("[Background Event Bus Error]:", backgroundError);
      }
    });
    // --- END OF ASYNC PDF FIX ---

    return NextResponse.json({
      success: true,
      bookingId: bookings[0].id,
      bookingIds: bookings.map((b: any) => b.id),
      confirmationId,
    });
  } catch (error: any) {
    console.error("[Booking API Critical Failure]:", error);

    // Catch standard Prisma unique constraint violations (P2002) cleanly
    if (error.code === "P2002" || error.message?.includes("COLLISION")) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Reservation collision intercepted. Please try selecting another slot.",
          details: error.message,
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "Internal systems error during confirmation",
        details: error.message || String(error),
      },
      { status: 500 },
    );
  }
}
