/**
 * route.ts
 * /api/bookings/bundles
 * Handles creation and retrieval of composite multi-venue Work-Hop Day Pass reservations.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  calculateRevenueAttribution,
  generateWorkHopPassToken,
  type WorkHopLeg,
  type WorkHopBundle,
} from "@/lib/bundles/workHopEngine";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");

    // Curated day pass bundles available for instant booking
    const curatedBundles = [
      {
        id: "curated-nomad-sprint",
        title: "Digital Nomad Sprint (Cafe + Quiet Booth + Lounge)",
        tier: "NOMAD_PRO",
        price: 28,
        currency: "USD",
        originalPrice: 42,
        savingsPercent: 33,
        description: "Morning artisan espresso & warm-up, afternoon acoustic pod for calls, evening rooftop networking lounge.",
        legs: [
          {
            legIndex: 1,
            slot: "Morning Warmup",
            duration: "09:00 - 12:00 (3 hrs)",
            venueCategory: "cafe",
            amenityHighlight: "Specialty Pour-over + AC Power",
          },
          {
            legIndex: 2,
            slot: "Deep Focus & Video Calls",
            duration: "13:00 - 16:30 (3.5 hrs)",
            venueCategory: "coworking",
            amenityHighlight: "Sub-40dB Phone Booth + 300Mbps WiFi",
          },
          {
            legIndex: 3,
            slot: "Evening Chill & Wrap-up",
            duration: "17:00 - 19:30 (2.5 hrs)",
            venueCategory: "coworking",
            amenityHighlight: "Collaborative Lounge & Craft Brews",
          },
        ],
      },
      {
        id: "curated-student-study-hop",
        title: "Academic Focus Circuit (Library + Quiet Cafe)",
        tier: "EXPLORER",
        price: 14,
        currency: "USD",
        originalPrice: 22,
        savingsPercent: 36,
        description: "Zero-distraction quiet study zones paired with high-speed campus-adjacent cafe seating.",
        legs: [
          {
            legIndex: 1,
            slot: "Silent Research Block",
            duration: "10:00 - 14:00 (4 hrs)",
            venueCategory: "library",
            amenityHighlight: "Ergonomic Desk + Power Sockets",
          },
          {
            legIndex: 2,
            slot: "Group Review & Coffee",
            duration: "15:00 - 18:00 (3 hrs)",
            venueCategory: "cafe",
            amenityHighlight: "Spacious Tables + Oat Milk Bar",
          },
        ],
      },
    ];

    return NextResponse.json({
      success: true,
      curatedBundles,
    });
  } catch (error: any) {
    console.error("[GET /api/bookings/bundles] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch bundle options" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      userId = "user_guest_nomad",
      date,
      title = "Custom Work-Hop Day Pass",
      tier = "NOMAD_PRO",
      legs,
      customerEmail = "nomad@worksphere.dev",
      customerPhone,
    } = body;

    if (!legs || !Array.isArray(legs) || legs.length < 2) {
      return NextResponse.json(
        { error: "A Work-Hop bundle requires at least 2 itinerary legs" },
        { status: 400 }
      );
    }

    if (!date) {
      return NextResponse.json(
        { error: "Booking date (YYYY-MM-DD) is required" },
        { status: 400 }
      );
    }

    // Fetch venue details for all legs
    const venueIds = legs.map((l: any) => l.venueId);
    const venues = await prisma.venue.findMany({
      where: { id: { in: venueIds } },
      select: { id: true, name: true, category: true, address: true },
    });

    const venueMap = new Map(venues.map((v) => [v.id, v]));

    // Calculate pass pricing with 25% multi-hop bundle discount
    const baseRatePerHour = 5.0;
    const totalHours = legs.reduce(
      (sum: number, leg: any) => sum + (Number(leg.durationHours) || 2),
      0
    );
    const rawPrice = totalHours * baseRatePerHour;
    const discountPercentage = 25;
    const totalPrice = Number((rawPrice * (1 - discountPercentage / 100)).toFixed(2));

    // Calculate revenue attribution across venues
    const legWeights = legs.map((l: any) => {
      const v = venueMap.get(l.venueId);
      return {
        venueId: l.venueId,
        durationHours: Number(l.durationHours) || 2,
        venueCategory: v?.category || "coworking",
      };
    });

    const attributions = calculateRevenueAttribution(totalPrice, legWeights);
    const attributionMap = new Map(attributions.map((a) => [a.venueId, a.allocatedRevenue]));

    const bundleId = `whop-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 6)}`;
    const qrToken = generateWorkHopPassToken(bundleId, userId, date);

    // Construct enriched legs
    const enrichedLegs: WorkHopLeg[] = legs.map((leg: any, idx: number) => {
      const v = venueMap.get(leg.venueId);
      return {
        legIndex: idx + 1,
        venueId: leg.venueId,
        venueName: v?.name || `Venue ${idx + 1}`,
        venueCategory: v?.category || "coworking",
        venueAddress: v?.address || null,
        seatId: leg.seatId || null,
        seatNumber: leg.seatNumber || `Desk-${idx + 1}A`,
        startTime: leg.startTime || "09:00",
        endTime: leg.endTime || "12:00",
        durationHours: Number(leg.durationHours) || 3,
        amenities: leg.amenities || ["High-Speed WiFi", "Power Outlet"],
        allocatedRevenue: attributionMap.get(leg.venueId) || 0,
        status: "PENDING",
      };
    });

    // Create atomic individual Booking records in DB to secure seats
    const createdBookings = await Promise.all(
      enrichedLegs.map(async (leg) => {
        return prisma.booking.create({
          data: {
            userId,
            venueId: leg.venueId,
            date,
            time: leg.startTime,
            duration: leg.durationHours * 60,
            customerEmail,
            customerPhone,
            seatId: leg.seatId || undefined,
            seatNumber: leg.seatNumber,
            confirmationId: `WHOP-${bundleId.slice(-6)}-L${leg.legIndex}`,
            status: "CONFIRMED",
            projectBillingCode: `WORKHOP-PASS-${bundleId}`,
          },
        });
      })
    );

    const bundle: WorkHopBundle = {
      bundleId,
      userId,
      date,
      title,
      tier,
      totalPrice,
      currency: "USD",
      discountPercentage,
      legs: enrichedLegs,
      qrToken,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
    };

    return NextResponse.json({
      success: true,
      message: "Work-Hop Day Pass created successfully!",
      bundle,
      bookingsCount: createdBookings.length,
    });
  } catch (error: any) {
    console.error("[POST /api/bookings/bundles] Error:", error);
    return NextResponse.json(
      { error: "Failed to create Work-Hop bundle pass", details: error.message },
      { status: 500 }
    );
  }
}
