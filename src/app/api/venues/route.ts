import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { venueSearchSchema, venueCreateSchema, validateRequest } from "@/lib/validations";

// GET /api/venues - Search venues
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    
    // Validate search params with Zod
    const validation = validateRequest(venueSearchSchema, {
      lat: searchParams.get("lat"),
      lng: searchParams.get("lng"),
      radius: searchParams.get("radius"),
      category: searchParams.get("category"),
      wifi: searchParams.get("wifi"),
      outlets: searchParams.get("outlets"),
      quiet: searchParams.get("quiet"),
    });
    
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    
    const { lat, lng, radius, category } = validation.data;

    // Simple bounding box search (for PostgreSQL without PostGIS)
    // Approximate: 1 degree ≈ 111km
    const latDelta = (radius / 1000) / 111;
    const lngDelta = (radius / 1000) / (111 * Math.cos(lat * Math.PI / 180));

    const where: any = {
      latitude: {
        gte: lat - latDelta,
        lte: lat + latDelta,
      },
      longitude: {
        gte: lng - lngDelta,
        lte: lng + lngDelta,
      },
    };

    if (category) {
      where.category = category;
    }

    const venues = await prisma.venue.findMany({
      where,
      include: {
        _count: {
          select: { favorites: true, ratings: true },
        },
      },
      take: 50,
    });

    return NextResponse.json({ venues });
  } catch (error) {
    console.error("GET /api/venues error:", error);
    return NextResponse.json(
      { error: "Failed to fetch venues" },
      { status: 500 }
    );
  }
}

// POST /api/venues - Add crowdsourced venue
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    
    // Validate request body with Zod
    const validation = validateRequest(venueCreateSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    
    const { name, latitude, longitude, category, address, wifiQuality, hasOutlets, noiseLevel } = validation.data;
    const { placeId, rating } = body; // placeId and rating are additional fields

    // Validate placeId (required for upsert)
    if (!placeId) {
      return NextResponse.json(
        { error: "placeId is required" },
        { status: 400 }
      );
    }

    // Upsert venue (update if exists, create if not)
    const venue = await prisma.venue.upsert({
      where: { placeId },
      update: {
        wifiQuality,
        hasOutlets,
        noiseLevel,
        crowdsourced: true,
      },
      create: {
        placeId,
        name,
        latitude,
        longitude,
        category,
        address,
        rating,
        wifiQuality,
        hasOutlets: hasOutlets || false,
        noiseLevel,
        crowdsourced: true,
      },
    });

    return NextResponse.json({ venue }, { status: 201 });
  } catch (error) {
    console.error("POST /api/venues error:", error);
    return NextResponse.json(
      { error: "Failed to create venue" },
      { status: 500 }
    );
  }
}
