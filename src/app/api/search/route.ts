/**
 * route.ts
 * Bounding box spatial search route supporting anti-meridian (180° / -180°) crossover queries.
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  normalizeSearchQuery,
  sanitizeSearchQuery,
} from "@/lib/searchSanitizer";

const coordinateSchema = z
  .number({ invalid_type_error: "Must be a number" })
  .finite("Must be a finite number");

export const spatialSearchSchema = z
  .object({
    minLon: coordinateSchema.min(-180).max(180).optional(),
    maxLon: coordinateSchema.min(-180).max(180).optional(),
    minLongitude: coordinateSchema.min(-180).max(180).optional(),
    maxLongitude: coordinateSchema.min(-180).max(180).optional(),
    minLng: coordinateSchema.min(-180).max(180).optional(),
    maxLng: coordinateSchema.min(-180).max(180).optional(),
    minLat: coordinateSchema.min(-90).max(90).optional(),
    maxLat: coordinateSchema.min(-90).max(90).optional(),
    minLatitude: coordinateSchema.min(-90).max(90).optional(),
    maxLatitude: coordinateSchema.min(-90).max(90).optional(),
    query: z
      .string({ invalid_type_error: "Query must be a string" })
      .max(500, "Query must not exceed 500 characters")
      .optional(),
    q: z
      .string({ invalid_type_error: "Query must be a string" })
      .max(500, "Query must not exceed 500 characters")
      .optional(),
    category: z
      .string({ invalid_type_error: "Category must be a string" })
      .max(100, "Category must not exceed 100 characters")
      .optional(),
    limit: z
      .number({ invalid_type_error: "Limit must be a number" })
      .int("Limit must be an integer")
      .min(1, "Limit must be at least 1")
      .max(100, "Limit cannot exceed 100")
      .optional(),
    page: z
      .number({ invalid_type_error: "Page must be a number" })
      .int("Page must be an integer")
      .min(1, "Page must be at least 1")
      .optional(),
    offset: z
      .number({ invalid_type_error: "Offset must be a number" })
      .int("Offset must be an integer")
      .min(0, "Offset cannot be negative")
      .optional(),
  })
  .refine(
    (data) => {
      const minLat = data.minLat ?? data.minLatitude;
      const maxLat = data.maxLat ?? data.maxLatitude;
      if (minLat !== undefined && maxLat !== undefined) {
        return minLat <= maxLat;
      }
      return true;
    },
    {
      message: "minLat must be less than or equal to maxLat",
      path: ["minLat"],
    },
  );

export interface BoundingBoxQueryOptions {
  minLon?: number;
  maxLon?: number;
  minLongitude?: number;
  maxLongitude?: number;
  minLng?: number;
  maxLng?: number;
  minLat?: number;
  maxLat?: number;
  minLatitude?: number;
  maxLatitude?: number;
  query?: string;
  category?: string;
  limit?: number;
  page?: number;
  offset?: number;
}

/**
 * Detects whether a longitude bounding range crosses the International Date Line (anti-meridian, 180°/-180°).
 * When minLongitude > maxLongitude, the bounding box crosses the anti-meridian.
 */
export function isAntiMeridianCrossover(
  minLongitude: number,
  maxLongitude: number,
): boolean {
  return minLongitude > maxLongitude;
}

/**
 * Generates the compound SQL longitude condition for bounding box searches.
 * When minLongitude > maxLongitude (anti-meridian crossover), splits the condition
 * into two disjunctive bounding queries across hemispheres: (lon >= minLon OR lon <= maxLon).
 * Otherwise, generates standard conjunctive bounds: (lon >= minLon AND lon <= maxLon).
 */
export function buildLongitudeBoundingCondition(
  minLongitude: number,
  maxLongitude: number,
  columnName: string = 'v."longitude"',
): Prisma.Sql {
  if (isAntiMeridianCrossover(minLongitude, maxLongitude)) {
    return Prisma.sql`(${Prisma.raw(columnName)} >= ${minLongitude} OR ${Prisma.raw(columnName)} <= ${maxLongitude})`;
  }
  return Prisma.sql`(${Prisma.raw(columnName)} >= ${minLongitude} AND ${Prisma.raw(columnName)} <= ${maxLongitude})`;
}

/**
 * Builds the complete SQL bounding box query for venue spatial queries.
 */
export function buildBoundingBoxQuery(options: BoundingBoxQueryOptions): {
  sql: Prisma.Sql;
  isAntiMeridian: boolean;
  predicates: Prisma.Sql[];
} {
  const minLon = options.minLon ?? options.minLongitude ?? options.minLng;
  const maxLon = options.maxLon ?? options.maxLongitude ?? options.maxLng;
  const minLat = options.minLat ?? options.minLatitude;
  const maxLat = options.maxLat ?? options.maxLatitude;

  const predicates: Prisma.Sql[] = [];
  let isAntiMeridian = false;

  // Longitude condition: detect anti-meridian crossover and split across hemispheres
  if (minLon !== undefined && maxLon !== undefined) {
    isAntiMeridian = isAntiMeridianCrossover(minLon, maxLon);
    predicates.push(buildLongitudeBoundingCondition(minLon, maxLon));
  } else if (minLon !== undefined) {
    predicates.push(Prisma.sql`v."longitude" >= ${minLon}`);
  } else if (maxLon !== undefined) {
    predicates.push(Prisma.sql`v."longitude" <= ${maxLon}`);
  }

  // Latitude condition
  if (minLat !== undefined && maxLat !== undefined) {
    predicates.push(
      Prisma.sql`(v."latitude" >= ${minLat} AND v."latitude" <= ${maxLat})`,
    );
  } else if (minLat !== undefined) {
    predicates.push(Prisma.sql`v."latitude" >= ${minLat}`);
  } else if (maxLat !== undefined) {
    predicates.push(Prisma.sql`v."latitude" <= ${maxLat}`);
  }

  // Category filter
  if (
    typeof options.category === "string" &&
    options.category &&
    options.category !== "all"
  ) {
    predicates.push(Prisma.sql`v."category" = ${options.category}`);
  }

  // Free text query filter
  if (typeof options.query === "string" && options.query.trim()) {
    // Collapse repeated whitespace so "quiet   cafe" matches "quiet cafe".
    const sanitized = normalizeSearchQuery(sanitizeSearchQuery(options.query));
    if (sanitized) {
      const pattern = `%${sanitized}%`;
      predicates.push(
        Prisma.sql`(v."name" ILIKE ${pattern} OR v."address" ILIKE ${pattern})`,
      );
    }
  }

  const limit = Math.min(
    Math.max(
      1,
      typeof options.limit === "number" && !isNaN(options.limit)
        ? options.limit
        : 50,
    ),
    100,
  );
  const page = Math.max(
    1,
    typeof options.page === "number" && !isNaN(options.page) ? options.page : 1,
  );
  const offset =
    options.offset !== undefined
      ? Math.max(0, options.offset)
      : (page - 1) * limit;

  const whereClause =
    predicates.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(predicates, " AND ")}`
      : Prisma.empty;

  const sql = Prisma.sql`
    SELECT
      v."id",
      v."name",
      v."category",
      v."address",
      v."latitude",
      v."longitude",
      v."rating",
      v."wifiQuality",
      v."hasOutlets",
      v."noiseLevel",
      v."imageUrl"
    FROM "Venue" v
    ${whereClause}
    ORDER BY v."name" ASC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  return { sql, isAntiMeridian, predicates };
}

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;

    const parseNum = (val: string | null): number | undefined => {
      if (val === null || val === "") return undefined;
      const num = Number(val);
      return Number.isFinite(num) ? num : undefined;
    };

    const minLon =
      parseNum(searchParams.get("minLon")) ??
      parseNum(searchParams.get("minLongitude")) ??
      parseNum(searchParams.get("minLng"));
    const maxLon =
      parseNum(searchParams.get("maxLon")) ??
      parseNum(searchParams.get("maxLongitude")) ??
      parseNum(searchParams.get("maxLng"));
    const minLat =
      parseNum(searchParams.get("minLat")) ??
      parseNum(searchParams.get("minLatitude"));
    const maxLat =
      parseNum(searchParams.get("maxLat")) ??
      parseNum(searchParams.get("maxLatitude"));

    const query =
      searchParams.get("query") ?? searchParams.get("q") ?? undefined;
    const category = searchParams.get("category") ?? undefined;
    const limit = parseNum(searchParams.get("limit"));
    const page = parseNum(searchParams.get("page"));

    const queryOptions: BoundingBoxQueryOptions = {
      minLon,
      maxLon,
      minLat,
      maxLat,
      query,
      category,
      limit,
      page,
    };

    const { sql, isAntiMeridian } = buildBoundingBoxQuery(queryOptions);

    const venues = await prisma.$queryRaw<any[]>(sql);

    return NextResponse.json({
      success: true,
      venues,
      total: venues.length,
      isAntiMeridianCrossover: isAntiMeridian,
      bounds: {
        minLongitude: minLon,
        maxLongitude: maxLon,
        minLatitude: minLat,
        maxLatitude: maxLat,
      },
    });
  } catch (error) {
    console.error("[SearchAPI] Geo-bounding box search failed:", error);
    return NextResponse.json(
      { error: "Internal server error during spatial search" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 },
      );
    }

    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return NextResponse.json(
        { error: "Request body must be a JSON object" },
        { status: 400 },
      );
    }

    const validation = spatialSearchSchema.safeParse(rawBody);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Invalid search parameters",
          details: (
            validation.error.issues ??
            validation.error.errors ??
            []
          ).map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
        },
        { status: 400 },
      );
    }

    const validatedData = validation.data;
    const queryOptions: BoundingBoxQueryOptions = {
      ...validatedData,
      query: validatedData.query ?? validatedData.q,
    };

    const { sql, isAntiMeridian } = buildBoundingBoxQuery(queryOptions);

    const venues = await prisma.$queryRaw<any[]>(sql);

    return NextResponse.json({
      success: true,
      venues,
      total: venues.length,
      isAntiMeridianCrossover: isAntiMeridian,
      bounds: {
        minLongitude:
          queryOptions.minLon ??
          queryOptions.minLongitude ??
          queryOptions.minLng,
        maxLongitude:
          queryOptions.maxLon ??
          queryOptions.maxLongitude ??
          queryOptions.maxLng,
        minLatitude: queryOptions.minLat ?? queryOptions.minLatitude,
        maxLatitude: queryOptions.maxLat ?? queryOptions.maxLatitude,
      },
    });
  } catch (error) {
    console.error("[SearchAPI] Geo-bounding box search failed:", error);
    return NextResponse.json(
      { error: "Internal server error during spatial search" },
      { status: 500 },
    );
  }
}
