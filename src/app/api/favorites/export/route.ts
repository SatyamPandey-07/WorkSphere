import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import {
  GEO_EXPORT_FORMATS,
  GEOJSON_CONTENT_TYPE,
  KML_CONTENT_TYPE,
  parseGeoExportFormat,
  generateFavoritesGeoJson,
  generateFavoritesKml,
} from "@/lib/favoritesGeoExport";

// GET /api/favorites/export?format=geojson|kml - Export user favorites to GeoJSON or KML
export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureUserExists(userId);

    const rawFormat = req.nextUrl.searchParams.get("format");
    const format = parseGeoExportFormat(rawFormat);

    if (!format) {
      const supported = GEO_EXPORT_FORMATS.join(", ");
      return NextResponse.json(
        {
          error: rawFormat?.trim()
            ? `Unsupported export format. Supported formats: ${supported}`
            : `Missing required "format" query parameter. Supported formats: ${supported}`,
        },
        { status: 400 },
      );
    }

    const favorites = await prisma.favorite.findMany({
      where: { userId },
      include: {
        venue: {
          select: {
            id: true,
            placeId: true,
            name: true,
            latitude: true,
            longitude: true,
            category: true,
            address: true,
            rating: true,
            wifiQuality: true,
            wifiSpeed: true,
            hasOutlets: true,
            noiseLevel: true,
          },
        },
        tags: {
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const body =
      format === "geojson"
        ? JSON.stringify(generateFavoritesGeoJson(favorites), null, 2)
        : generateFavoritesKml(favorites, "WorkSphere Saved Venues");

    const contentType =
      format === "geojson" ? GEOJSON_CONTENT_TYPE : KML_CONTENT_TYPE;
    const filename = `worksphere-saved-venues.${format}`;

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("GET /api/favorites/export error:", error);
    return NextResponse.json(
      { error: "Failed to export favorites" },
      { status: 500 },
    );
  }
}
