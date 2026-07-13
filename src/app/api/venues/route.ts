import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { venueSearchSchema, venueCreateSchema, validateRequest } from "@/lib/validations";
import { analyzeVenueImage } from "@/lib/agents/VisionAgent";

// GET /api/venues - Search venues
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;

    // Fallback: If no coordinates are provided, return all venues
    if (!searchParams.get("lat") || !searchParams.get("lng")) {
      const venues = await prisma.venue.findMany();
      return NextResponse.json(venues);
    }

    // Validate search params with Zod
    const validation = validateRequest(venueSearchSchema, {
      lat: searchParams.get("lat"),
      lng: searchParams.get("lng"),
      radius: searchParams.get("radius"),
      category: searchParams.get("category"),
      wifi: searchParams.get("wifi"),
      outlets: searchParams.get("outlets"),
      quiet: searchParams.get("quiet"),
      ergonomic: searchParams.get("ergonomic"),
      outletDensity: searchParams.get("outletDensity"),
      wifiSpeedBand: searchParams.get("wifiSpeedBand"),
      hasPhoneBooths: searchParams.get("hasPhoneBooths"),
      hasNoMusic: searchParams.get("hasNoMusic"),
      hasQuietZone: searchParams.get("hasQuietZone"),
      lighting: searchParams.get("lighting"),
      petsAllowedIndoors: searchParams.get("petsAllowedIndoors"),
      patioOnly: searchParams.get("patioOnly"),
      waterBowlsProvided: searchParams.get("waterBowlsProvided"),
      singleOriginBeans: searchParams.get("singleOriginBeans"),
      specialtyEspresso: searchParams.get("specialtyEspresso"),
      oatAlmondMilk: searchParams.get("oatAlmondMilk"),
      pourOverAvailable: searchParams.get("pourOverAvailable"),
    });

    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { lat, lng, radius, category, wifi, outlets, quiet, ergonomic, outletDensity, wifiSpeedBand, hasPhoneBooths, hasNoMusic, hasQuietZone, lighting, petsAllowedIndoors, patioOnly, waterBowlsProvided, singleOriginBeans, specialtyEspresso, oatAlmondMilk, pourOverAvailable} = validation.data;

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

    if (category && category !== "all") {
      where.category = category;
    }

    if (wifi) {
      where.wifiQuality = { gte: 3 };
    }

    if (outlets) {
      where.hasOutlets = true;
    }

    if (quiet) {
      where.noiseLevel = "quiet";
    }

    if (ergonomic) {
      where.hasErgonomic = true;
    }

    if (outletDensity && outletDensity !== "none") {
      if (outletDensity === "every_table") {
        where.outletDensity = "every_table";
      } else if (outletDensity === "some_tables") {
        where.outletDensity = { in: ["every_table", "some_tables"] };
      } else if (outletDensity === "wall_seats") {
        where.outletDensity = { in: ["every_table", "some_tables", "wall_seats"] };
      }
    }

    if (wifiSpeedBand && wifiSpeedBand !== "all") {
      if (wifiSpeedBand === "basic") {
        where.wifiSpeed = { gte: 10 };
      } else if (wifiSpeedBand === "fast") {
        where.wifiSpeed = { gte: 50 };
      } else if (wifiSpeedBand === "ultra") {
        where.wifiSpeed = { gte: 100 };
      }
    }

    if (hasPhoneBooths) {
      where.hasPhoneBooths = true;
    }

    if (hasNoMusic) {
      where.hasNoMusic = true;
    }

    if (hasQuietZone) {
      where.hasQuietZone = true;
    }
    if (singleOriginBeans) {
      where.singleOriginBeans = true;
    }

    if (specialtyEspresso) {
      where.specialtyEspresso = true;
    }

    if (oatAlmondMilk) {
      where.oatAlmondMilk = true;
    }

    if (pourOverAvailable) {
      where.pourOverAvailable = true;
    }
    if (petsAllowedIndoors) {
      where.petsAllowedIndoors = true;
    }

    if (patioOnly) {
      where.patioOnly = true;
    }

    if (waterBowlsProvided) {
      where.waterBowlsProvided = true;
    }

    if (lighting) {
      where.lighting = lighting;
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
    const { name, latitude, longitude, category, address, wifiQuality, hasOutlets, noiseLevel, hasErgonomic, outletDensity, wifiSpeed, hasPhoneBooths, hasNoMusic, hasQuietZone, lighting, petsAllowedIndoors, patioOnly, waterBowlsProvided, singleOriginBeans, specialtyEspresso, oatAlmondMilk, pourOverAvailable } = validation.data;
    const { placeId, rating, imageUrl } = body; // placeId, rating, imageUrl are additional fields

    // Validate placeId (required for upsert)
    if (!placeId) {
      return NextResponse.json(
        { error: "placeId is required" },
        { status: 400 }
      );
    }

    let requiresReview = false;

    // Run Vision Validation if an image was provided
    if (imageUrl) {
      const visionResult = await analyzeVenueImage(imageUrl, {
        hasOutlets,
        category,
      });

      // Flag for review if it's not a workspace or if outlets are claimed but not visible (and model is fairly confident)
      if (
        !visionResult.isWorkspace ||
        (hasOutlets && !visionResult.visibleOutlets && visionResult.confidenceScore > 60)
      ) {
        requiresReview = true;
      }
    }

    // Upsert venue (update if exists, create if not)
    const venue = await prisma.venue.upsert({
      where: { placeId },
      update: {
        wifiQuality,
        hasOutlets,
        noiseLevel,
        hasErgonomic,
        outletDensity,
        wifiSpeed,
        hasPhoneBooths,
        hasNoMusic,
        hasQuietZone,
        lighting,
        petsAllowedIndoors,
        patioOnly,
        waterBowlsProvided,
        singleOriginBeans,
        specialtyEspresso,
        oatAlmondMilk,
        pourOverAvailable,
        crowdsourced: true,
        requiresReview,
        ...(imageUrl && { imageUrl }),
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
        hasErgonomic: hasErgonomic || false,
        outletDensity: outletDensity || "none",
        wifiSpeed: wifiSpeed || null,
        hasPhoneBooths: hasPhoneBooths || false,
        hasNoMusic: hasNoMusic || false,
        hasQuietZone: hasQuietZone || false,
        lighting,
        petsAllowedIndoors: petsAllowedIndoors || false,
        patioOnly: patioOnly || false,
        waterBowlsProvided: waterBowlsProvided || false,
        singleOriginBeans: singleOriginBeans || false,
        specialtyEspresso: specialtyEspresso || false,
        oatAlmondMilk: oatAlmondMilk || false,
        pourOverAvailable: pourOverAvailable || false,
        crowdsourced: true,
        requiresReview,
        imageUrl,
        creatorId: userId,
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
