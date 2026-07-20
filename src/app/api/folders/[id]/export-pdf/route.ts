import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { hasFolderAccess } from "@/lib/folders";
import { generateFolderSummaryPdf } from "@/lib/folderPdfExport";

// GET /api/folders/[id]/export-pdf — styled PDF summary of folder venues
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { id } = await params;
    const { folder, hasAccess } = await hasFolderAccess(id, userId);

    if (!folder) {
      return new NextResponse("Folder not found", { status: 404 });
    }
    if (!hasAccess) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    const folderVenues = await prisma.folderVenue.findMany({
      where: { folderId: id },
      include: {
        venue: {
          select: {
            id: true,
            name: true,
            wifiQuality: true,
            hasOutlets: true,
            address: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const venueIds = folderVenues.map((fv) => fv.venue.id);
    const favorites =
      venueIds.length === 0
        ? []
        : await prisma.favorite.findMany({
            where: { userId, venueId: { in: venueIds } },
            select: { venueId: true, notes: true },
          });

    const notesByVenue = new Map(
      favorites.map((f) => [f.venueId, f.notes ?? ""]),
    );

    const pdfBytes = await generateFolderSummaryPdf({
      folderName: folder.name,
      folderDescription: folder.description,
      venues: folderVenues.map((fv) => ({
        name: fv.venue.name,
        wifiQuality: fv.venue.wifiQuality,
        hasOutlets: fv.venue.hasOutlets,
        address: fv.venue.address,
        notes: notesByVenue.get(fv.venue.id) || "",
      })),
    });

    const slug = folder.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="collection-${slug || "report"}.pdf"`,
      },
    });
  } catch (error) {
    console.error("GET /api/folders/[id]/export-pdf error:", error);
    return new NextResponse("Failed to export PDF", { status: 500 });
  }
}
