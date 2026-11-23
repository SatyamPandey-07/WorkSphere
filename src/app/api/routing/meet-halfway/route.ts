/**
 * route.ts
 * POST /api/routing/meet-halfway
 * Computes the optimal geometric median centroid for a team, fetches matching venues
 * with sufficient contiguous capacity, and calculates fair commute metrics.
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  MeetHalfwayOptimizer,
  type CandidateVenue,
} from "@/core/routing/MeetHalfwayOptimizer";
import { MAX_SEARCH_RADIUS_METERS } from "@/lib/search/spatialVenueSearch";

/**
 * Maximum permissible search radius for Meet Halfway optimization in kilometers.
 * Aligns with the 100,000 meter (100 km) spatial search policy in spatialVenueSearch.ts.
 */
export const MAX_SEARCH_RADIUS_KM = MAX_SEARCH_RADIUS_METERS / 1000;

const MemberLocationSchema = z.object({
  id: z
    .string()
    .min(1)
    .refine((v) => v.trim().length > 0, {
      message: "id must be a non-empty string",
    }),
  name: z
    .string()
    .min(1)
    .refine((v) => v.trim().length > 0, {
      message: "name must be a non-empty string",
    }),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  transitMode: z
    .enum(["transit", "driving", "bicycling", "walking"])
    .optional(),
});

const MeetHalfwayRequestSchema = z.object({
  members: z
    .array(MemberLocationSchema)
    .min(2, "At least two team member coordinates are required")
    .refine(
      (members) => {
        if (members.length < 2) return true;
        const uniqueCoordinates = new Set(
          members.map((m) => `${m.latitude + 0},${m.longitude + 0}`),
        );
        return uniqueCoordinates.size >= 2;
      },
      {
        message: "At least two distinct member locations are required",
      },
    ),
  category: z.string().optional(),
  minWifiSpeed: z.number().finite().min(0).default(0),
  minSeats: z.number().finite().int().min(1).optional(),
  searchRadiusKm: z
    .number()
    .finite()
    .positive()
    .max(MAX_SEARCH_RADIUS_KM)
    .default(25),
  hasOutlets: z.boolean().optional(),
  transitPreference: z
    .enum(["transit", "walking", "balanced"])
    .default("transit"),
});

export async function POST(req: NextRequest) {
  try {
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (
      typeof rawBody !== "object" ||
      rawBody === null ||
      Array.isArray(rawBody)
    ) {
      return NextResponse.json(
        { error: "Request body must be an object" },
        { status: 400 },
      );
    }

    const parsed = MeetHalfwayRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request parameters",
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const {
      members,
      category,
      minWifiSpeed,
      minSeats,
      searchRadiusKm,
      hasOutlets,
      transitPreference,
    } = parsed.data;

    const requiredSeats = minSeats ?? members.length;

    // 1. Calculate centroid to establish search bounding box
    const centroid = MeetHalfwayOptimizer.computeGeometricMedian(members);

    // Approximate lat/lng delta for bounding box (1 deg lat ~= 111km)
    const latDelta = searchRadiusKm / 111;
    const lngDelta =
      searchRadiusKm /
      (111 * Math.cos((centroid.latitude * Math.PI) / 180) || 1);

    // 2. Fetch candidate venues from database
    const venueWhereClause: Prisma.VenueWhereInput = {
      latitude: {
        gte: centroid.latitude - latDelta,
        lte: centroid.latitude + latDelta,
      },
      longitude: {
        gte: centroid.longitude - lngDelta,
        lte: centroid.longitude + lngDelta,
      },
    };

    if (category && category !== "all") {
      venueWhereClause.category = category;
    }

    if (minWifiSpeed > 0) {
      venueWhereClause.wifiSpeed = { gte: minWifiSpeed };
    }

    if (hasOutlets) {
      venueWhereClause.hasOutlets = true;
    }

    const fetchedVenues = await prisma.venue.findMany({
      where: venueWhereClause,
      select: {
        id: true,
        name: true,
        latitude: true,
        longitude: true,
        category: true,
        address: true,
        rating: true,
        wifiSpeed: true,
        wifiQuality: true,
        hasOutlets: true,
        maxCapacity: true,
        currentOccupancy: true,
        imageUrl: true,
        seats: {
          where: { isEnabled: true },
          select: { id: true, seatNumber: true, type: true },
        },
      },
      take: 50,
    });

    // 3. Map into candidate venues with available seats counts
    const candidateVenues: CandidateVenue[] = fetchedVenues.map((v) => {
      const enabledSeatsCount = v.seats.length;
      const computedAvailable =
        enabledSeatsCount > 0
          ? Math.max(0, enabledSeatsCount - v.currentOccupancy)
          : Math.max(0, v.maxCapacity - v.currentOccupancy);

      return {
        id: v.id,
        name: v.name,
        latitude: v.latitude,
        longitude: v.longitude,
        category: v.category,
        address: v.address,
        rating: v.rating,
        wifiSpeed: v.wifiSpeed,
        wifiQuality: v.wifiQuality,
        hasOutlets: v.hasOutlets,
        maxCapacity: v.maxCapacity,
        currentOccupancy: v.currentOccupancy,
        availableSeatsCount: computedAvailable,
        imageUrl: v.imageUrl,
      };
    });

    // 4. Run optimization ranking
    const optimization = MeetHalfwayOptimizer.rankVenuesForTeam(
      members,
      candidateVenues,
      { minRequiredSeats: requiredSeats, transitPreference },
    );

    return NextResponse.json({
      success: true,
      centroid: optimization.centroid,
      totalCandidatesEvaluated: candidateVenues.length,
      recommendations: optimization.recommendedVenues.slice(0, 10),
      isCoLocated: optimization.isCoLocated,
      fallbackApplied: optimization.fallbackApplied,
      message: optimization.message,
      teamSummary: {
        memberCount: members.length,
        requiredSeats,
        searchRadiusKm,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[POST /api/routing/meet-halfway] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to compute meet-halfway optimization",
        details: message,
      },
      { status: 500 },
    );
  }
}
