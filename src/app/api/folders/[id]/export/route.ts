import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { hasFolderAccess } from "@/lib/folders";
import {
  GEO_EXPORT_FORMATS,
  GEO_EXPORT_VENUE_SELECT,
  GEOJSON_CONTENT_TYPE,
  KML_CONTENT_TYPE,
  buildGeoExportFilename,
  generateGeoJson,
  generateKml,
  parseGeoExportFormat,
} from "@/lib/folderGeoExport";

// GET /api/folders/[id]/export?format=geojson|kml — geographic export of folder venues
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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

    const { id } = await params;
    const { folder, hasAccess } = await hasFolderAccess(id, userId);

    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Single query for every venue in the folder (no per-venue lookups),
    // selecting only the columns the exporters need.
    const folderVenues = await prisma.folderVenue.findMany({
      where: { folderId: id },
      select: { venue: { select: GEO_EXPORT_VENUE_SELECT } },
      orderBy: { createdAt: "desc" },
    });
    const venues = folderVenues.map((fv) => fv.venue);

    const body =
      format === "geojson"
        ? JSON.stringify(generateGeoJson(venues))
        : generateKml(venues, {
            name: folder.name,
            description: folder.description,
          });

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type":
          format === "geojson" ? GEOJSON_CONTENT_TYPE : KML_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${buildGeoExportFilename(folder.name, format)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("GET /api/folders/[id]/export error:", error);
    return NextResponse.json(
      { error: "Failed to export folder" },
      { status: 500 },
    );
  }
}
