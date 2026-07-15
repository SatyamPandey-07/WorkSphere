import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { hasFolderAccess } from "@/lib/folders";

const addVenueSchema = z.object({
  venue: z.object({
    id: z.string(),
    placeId: z.string().optional(),
    name: z.string(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    category: z.string().optional(),
    address: z.string().optional(),
  }),
});

// POST /api/folders/[id]/venues - Add venue to folder
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { folder, hasAccess, role } = await hasFolderAccess(id, userId);

    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    if (!hasAccess || (role !== "OWNER" && role !== "EDITOR" && role !== "MEMBER")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const validation = addVenueSchema.safeParse(body);
    
    if (!validation.success) {
      return NextResponse.json({ error: validation.error.format() }, { status: 400 });
    }

    const { venue } = validation.data;

    const effectivePlaceId = venue.placeId || venue.id;

    let dbVenue = await prisma.venue.findFirst({
      where: {
        OR: [
          { id: venue.id },
          { placeId: effectivePlaceId }
        ]
      }
    });

    if (!dbVenue) {
      dbVenue = await prisma.venue.create({
        data: {
          id: venue.id,
          placeId: effectivePlaceId,
          name: venue.name,
          latitude: venue.latitude || 0,
          longitude: venue.longitude || 0,
          category: venue.category || "cafe",
          address: venue.address || "",
        }
      });
    }

    // Add to folder
    const folderVenue = await prisma.folderVenue.create({
      data: {
        folderId: id,
        venueId: dbVenue.id,
        addedById: userId,
      },
      include: {
        venue: true,
      }
    });

    return NextResponse.json({ folderVenue }, { status: 201 });
  } catch (error: any) {
    console.error(`POST /api/folders/venues error:`, error);
    if (error.code === 'P2002') { // Unique constraint
      return NextResponse.json({ error: "Venue already in folder" }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Failed to add venue to folder" },
      { status: 500 }
    );
  }
}
