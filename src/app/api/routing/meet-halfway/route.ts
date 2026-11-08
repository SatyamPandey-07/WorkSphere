/**
 * route.ts
 * POST /api/routing/meet-halfway
 * Computes the optimal geometric median centroid for a team, fetches matching venues
 * with sufficient contiguous capacity, and calculates fair commute metrics.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  MeetHalfwayOptimizer,
  type TeamMemberLocation,
  type CandidateVenue,
} from "@/core/routing/MeetHalfwayOptimizer";

interface MeetHalfwayRequestBody {
  members: TeamMemberLocation[];
  category?: string;
  minWifiSpeed?: number;
  minSeats?: number;
  searchRadiusKm?: number;
  hasOutlets?: boolean;
  transitPreference?: 'transit' | 'walking' | 'balanced';
}

export async function POST(req: NextRequest) {
  try {
    const body: MeetHalfwayRequestBody = await req.json();
    const {
      members,
      category,
      minWifiSpeed = 0,
      minSeats,
      searchRadiusKm = 25,
      hasOutlets,
      transitPreference = 'transit',
    } = body;

    if (!members || !Array.isArray(members) || members.length === 0) {
      return NextResponse.json(
        { error: "At least one team member coordinate is required" },
        { status: 400 }
      );
    }

    // Validate coordinates
    for (const m of members) {
      if (
        typeof m.latitude !== "number" ||
        typeof m.longitude !== "number" ||
        isNaN(m.latitude) ||
        isNaN(m.longitude)
      ) {
        return NextResponse.json(
          { error: `Invalid coordinates for member: ${m.name || m.id}` },
          { status: 400 }
        );
      }
    }

    const requiredSeats = minSeats ?? members.length;

    // 1. Calculate centroid to establish search bounding box
    const centroid = MeetHalfwayOptimizer.computeGeometricMedian(members);

    // Approximate lat/lng delta for bounding box (1 deg lat ~= 111km)
    const latDelta = searchRadiusKm / 111;
    const lngDelta =
      searchRadiusKm / (111 * Math.cos((centroid.latitude * Math.PI) / 180) || 1);

    // 2. Fetch candidate venues from database
    const venueWhereClause: any = {
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
      { minRequiredSeats: requiredSeats, transitPreference }
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
  } catch (error: any) {
    console.error("[POST /api/routing/meet-halfway] Error:", error);
    return NextResponse.json(
      { error: "Failed to compute meet-halfway optimization", details: error.message },
      { status: 500 }
    );
  }
}
