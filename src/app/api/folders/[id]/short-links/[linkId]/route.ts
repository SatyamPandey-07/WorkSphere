import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { hasFolderAccess } from "@/lib/folders";

// DELETE /api/folders/[id]/short-links/[linkId] - Revoke a short link
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: folderId, linkId } = await params;
    const access = await hasFolderAccess(folderId, userId);

    if (!access.folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    if (
      !access.hasAccess ||
      (access.role !== "OWNER" && access.role !== "EDITOR")
    ) {
      return NextResponse.json(
        {
          error:
            "Forbidden: Only folder owners and editors can delete short links",
        },
        { status: 403 },
      );
    }

    // Verify the short link belongs to this folder
    const shortLink = await prisma.shortLink.findUnique({
      where: { id: linkId },
    });

    if (!shortLink || shortLink.folderId !== folderId) {
      return NextResponse.json(
        { error: "Short link not found or does not belong to this folder" },
        { status: 404 },
      );
    }

    await prisma.shortLink.delete({
      where: { id: linkId },
    });

    return NextResponse.json({
      success: true,
      message: "Short link revoked successfully",
    });
  } catch (error) {
    console.error(
      "DELETE /api/folders/[id]/short-links/[linkId] error:",
      error,
    );
    return NextResponse.json(
      { error: "Failed to delete short link" },
      { status: 500 },
    );
  }
}
