import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import {
  venueSearchSchema,
  venueCreateSchema,
  validateRequest,
} from "@/lib/validations";
import { analyzeVenueImage } from "@/lib/agents/VisionAgent";
import { rateLimit, getRateLimitInfo } from "@/lib/rateLimit";

// Search/autocomplete is expected to fire on every keystroke (debounced client-side
// to ~250-300ms), which can mean several requests per second while someone types a
// long query. A tight per-minute cap (like the 3-5/min used on auth routes) blocks
// that legitimate traffic almost immediately, so this endpoint uses a much higher,
// burst-tolerant ceiling — generous enough for fast typing, still low enough to stop
// scripted abuse. See #717.
const VENUE_SEARCH_RATE_LIMIT = 120;

// GET /api/venues - Search venues
export async function GET(req: NextRequest) {
  try {
    // Identify the caller (signed-in user, else IP) and rate limit before touching
    // the DB. Keyed separately from other routes so it doesn't share a budget with
    // auth/chat rate limits.
    const { userId } = await auth();
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      req.headers.get("x-real-ip") ??
      "anonymous";
    const identifier = `venues-search:${userId || ip}`;

    const allowed = await rateLimit(identifier, VENUE_SEARCH_RATE_LIMIT);
    if (!allowed) {
      const info = await getRateLimitInfo(identifier, VENUE_SEARCH_RATE_LIMIT);
      const retryAfter = info?.resetTime
        ? Math.ceil((info.resetTime - Date.now()) / 1000)
        : 60;

      return NextResponse.json(
        {
          error: "Too many search requests. Please slow down and try again.",
          retryAfter,
        },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }

    const searchParams = req.nextUrl.searchParams;

    const pageParam = searchParams.get("page");
    const limitParam = searchParams.get("limit");

    const page = pageParam ? Math.max(1, parseInt(pageParam, 10)) : 1;
    const limit = limitParam
      ? Math.min(100, Math.max(1, parseInt(limitParam, 10)))
      : 50;
    const skip = (page - 1) * limit;

    // Fallback: If no coordinates are provided, return all venues
    if (!searchParams.get("lat") || !searchParams.get("lng")) {
      const total = await prisma.venue.count();
      const venues = await prisma.venue.findMany({
        skip,
        take: limit,
        include: {
          _count: {
            select: { favorites: true, ratings: true },
          },
        },
      });
      return NextResponse.json({
        venues,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNextPage: skip + venues.length < total,
        },
      });
    }

    // Validate search params with Zod
    const rawData: any = {};
    const keys = [
      "lat",
      "lng",
      "radius",
      "category",
      "wifi",
      "outlets",
      "quiet",
      "ergonomic",
      "outletDensity",
      "wifiSpeedBand",
      "hasPhoneBooths",
      "hasNoMusic",
      "hasQuietZone",
      "hasAncHeadsetRental",
      "lighting",
      "petsAllowedIndoors",
      "patioOnly",
      "waterBowlsProvided",
      "dogFriendly",
      "catsAllowed",
      "singleOriginBeans",
      "specialtyEspresso",
      "oatAlmondMilk",
      "pourOverAvailable",
      "musicStyle",
    ];
    for (const key of keys) {
      const val = searchParams.get(key);
      if (val !== null) {
        rawData[key] = val;
      }
    }
    const validation = validateRequest(venueSearchSchema, rawData);

    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const {
      lat,
      lng,
      radius,
      category,
      wifi,
      outlets,
      quiet,
      ergonomic,
      outletDensity,
      wifiSpeedBand,
      hasPhoneBooths,
      hasNoMusic,
      hasQuietZone,
      hasAncHeadsetRental,
      lighting,
      petsAllowedIndoors,
      patioOnly,
      waterBowlsProvided,
      dogFriendly,
      catsAllowed,
      singleOriginBeans,
      specialtyEspresso,
      oatAlmondMilk,
      pourOverAvailable,
      musicStyle,
    } = validation.data;

    // Simple bounding box search (for PostgreSQL without PostGIS)
    // Approximate: 1 degree ≈ 111km
    const latDelta = radius / 1000 / 111;
    const lngDelta = radius / 1000 / (111 * Math.cos((lat * Math.PI) / 180));

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
        where.outletDensity = {
          in: ["every_table", "some_tables", "wall_seats"],
        };
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

    if (hasAncHeadsetRental) {
      where.hasAncHeadsetRental = true;
    }
    if (musicStyle && musicStyle !== "all") {
      if (musicStyle === "no_music") {
        where.OR = [{ musicStyle: "no_music" }, { hasNoMusic: true }];
      } else {
        where.musicStyle = musicStyle;
      }
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

    if (dogFriendly) {
      where.dogFriendly = true;
    }

    if (catsAllowed) {
      where.catsAllowed = true;
    }

    if (lighting) {
      where.lighting = lighting;
    }

    const total = await prisma.venue.count({ where });
    const venues = await prisma.venue.findMany({
      where,
      include: {
        _count: {
          select: { favorites: true, ratings: true },
        },
      },
      skip,
      take: limit,
    });

    return NextResponse.json({
      venues,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: skip + venues.length < total,
      },
    });
  } catch (error) {
    console.error("GET /api/venues error:", error);
    return NextResponse.json(
      { error: "Failed to fetch venues" },
      { status: 500 },
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
    const {
      name,
      latitude,
      longitude,
      category,
      address,
      wifiQuality,
      hasOutlets,
      noiseLevel,
      hasErgonomic,
      outletDensity,
      wifiSpeed,
      hasPhoneBooths,
      hasNoMusic,
      hasQuietZone,
      hasAncHeadsetRental,
      lighting,
      petsAllowedIndoors,
      patioOnly,
      waterBowlsProvided,
      dogFriendly,
      catsAllowed,
      singleOriginBeans,
      specialtyEspresso,
      oatAlmondMilk,
      pourOverAvailable,
      musicStyle,
    } = validation.data;
    const { placeId, rating, imageUrl } = body; // placeId, rating, imageUrl are additional fields

    // Validate placeId (required for upsert)
    if (!placeId) {
      return NextResponse.json(
        { error: "placeId is required" },
        { status: 400 },
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
        (hasOutlets &&
          !visionResult.visibleOutlets &&
          visionResult.confidenceScore > 60)
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
        hasAncHeadsetRental,
        hasNoMusic,
        hasQuietZone,
        lighting,
        petsAllowedIndoors,
        patioOnly,
        waterBowlsProvided,
        dogFriendly,
        catsAllowed,
        singleOriginBeans,
        specialtyEspresso,
        oatAlmondMilk,
        pourOverAvailable,
        musicStyle,
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
        hasAncHeadsetRental: hasAncHeadsetRental || false,
        lighting,
        petsAllowedIndoors: petsAllowedIndoors || false,
        patioOnly: patioOnly || false,
        waterBowlsProvided: waterBowlsProvided || false,
        dogFriendly: dogFriendly || false,
        catsAllowed: catsAllowed || false,
        singleOriginBeans: singleOriginBeans || false,
        specialtyEspresso: specialtyEspresso || false,
        oatAlmondMilk: oatAlmondMilk || false,
        pourOverAvailable: pourOverAvailable || false,
        musicStyle,
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
      { status: 500 },
    );
  }
}
