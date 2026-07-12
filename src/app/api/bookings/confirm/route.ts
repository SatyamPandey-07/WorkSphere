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

        // 0.5 Ensure Venue exists in local ledger 💎
        // Venues from search might not be in our DB yet
        // We upsert by placeId because that is the unique physical identifier
        const dbVenue = await prisma.venue.upsert({
            where: { placeId: targetPlaceId },
            update: {
                // Update basic info if it's missing or from a fresh search
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

        // 1. Persist to Database 💎
        const booking = await (prisma as any).booking.create({
            data: {
                userId,
                venueId: dbVenue.id, // Use the ID from our verified ledger record
                date,
                time,
                customerEmail: customerEmail || "pandeysatyam1802@gmail.com",
                customerPhone: customerPhone || null,
                confirmationId,
            }
        });

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
        return NextResponse.json({
            success: false,
            error: "Internal systems error during confirmation",
            details: error.message || String(error)
        }, { status: 500 });
    }
}
