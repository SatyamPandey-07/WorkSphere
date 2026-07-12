import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { hasFolderAccess } from "@/lib/folders";

// DELETE /api/folders/[id]/venues/[venueId] - Remove venue from folder
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; venueId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, venueId } = await params;
    const { folder, hasAccess, role } = await hasFolderAccess(id, userId);

    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    if (!hasAccess || (role !== "OWNER" && role !== "EDITOR" && role !== "MEMBER")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Only allow if owner/editor OR if the member is the one who added it
    if (role === "MEMBER") {
      const folderVenue = await prisma.folderVenue.findUnique({
        where: { folderId_venueId: { folderId: id, venueId: venueId } }
      });
      if (!folderVenue) {
         return NextResponse.json({ error: "Venue not in folder" }, { status: 404 });
      }
      if (folderVenue.addedById !== userId) {
        return NextResponse.json({ error: "Forbidden. Only owner, editor, or the person who added it can remove." }, { status: 403 });
      }
    }

    await prisma.folderVenue.delete({
      where: {
        folderId_venueId: {
          folderId: id,
          venueId: venueId,
        },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error(`DELETE /api/folders/venues error:`, error);
    if (error.code === 'P2025') {
       return NextResponse.json({ error: "Venue not in folder" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Failed to remove venue from folder" },
      { status: 500 }
    );
  }
}
