import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { eventBus } from "@/core/events";
import "@/core/subscribers/booking";
import "@/core/subscribers/booking";
import "@/core/subscribers/discord";
export async function POST(req: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // 0. Ensure Identity 💎
        await ensureUserExists(userId);

        const { venue, date, time, customerEmail, customerPhone } = await req.json();

        if (!venue) {
            return NextResponse.json({ error: "Missing venue data" }, { status: 400 });
        }

        const confirmationId = `WS-#${Math.floor(100000 + Math.random() * 900000)}`;
        const targetPlaceId = venue.placeId || venue.id;

        // --- CONCURRENCY FIX IMPLEMENTATION ---
        // Wrap database steps inside an interactive transaction to prevent key collisions
        const { booking, dbVenue } = await prisma.$transaction(async (tx) => {
            
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
            const existingBooking = await tx.booking.findFirst({
                where: {
                    venueId: localVenue.id,
                    date: date,
                    time: time,
                },
            });

            if (existingBooking) {
                throw new Error("COLLISION: This workspace slot has already been claimed by another runtime thread.");
            }

            // 1. Persist to Database safely using transaction context
            const newBooking = await (tx as any).booking.create({
                data: {
                    userId,
                    venueId: localVenue.id,
                    date,
                    time,
                    customerEmail: customerEmail || "pandeysatyam1802@gmail.com",
                    customerPhone: customerPhone || null,
                    confirmationId,
                }
            });

            return { booking: newBooking, dbVenue: localVenue };
        });
        // --- END OF FIX ---

        // 2. Emit Booking Confirmed Event to handle Side-Effects (PDF, Email, Analytics)
        await eventBus.emit("booking:confirmed", {
            bookingId: booking.id,
            confirmationId,
            venue: {
                id: dbVenue.id,
                name: venue.name || "Unknown Venue",
                category: venue.category || "other",
                address: venue.address || undefined
            },
            customerEmail: customerEmail || "pandeysatyam1802@gmail.com",
            date,
            time
        });

        return NextResponse.json({
            success: true,
            bookingId: booking.id,
            confirmationId
        });
    } catch (error: any) {
        console.error("[Booking API Critical Failure]:", error);

        // Catch standard Prisma unique constraint violations (P2002) cleanly
        if (error.code === 'P2002' || error.message?.includes("COLLISION")) {
            return NextResponse.json({
                success: false,
                error: "Reservation collision intercepted. Please try selecting another slot.",
                details: error.message
            }, { status: 409 });
        }

        return NextResponse.json({
            success: false,
            error: "Internal systems error during confirmation",
            details: error.message || String(error)
        }, { status: 500 });
    }
}
