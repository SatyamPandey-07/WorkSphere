import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { deleteFolderWithRelations, hasFolderAccess } from "@/lib/folders";

const updateFolderSchema = z.object({
  name: z.string().min(1, "Folder name is required").max(100).optional(),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().optional(),
});

// GET /api/folders/[id] - Get folder details
export async function GET(
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
    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fetch full details
    const folderDetails = await prisma.folder.findUnique({
      where: { id },
      include: {
        venues: {
          include: {
            venue: true,
            addedBy: {
              select: { id: true, firstName: true, lastName: true, imageUrl: true }
            }
          },
          orderBy: { createdAt: 'desc' }
        },
        members: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, imageUrl: true }
            }
          }
        },
        owner: {
          select: { id: true, firstName: true, lastName: true, imageUrl: true }
        }
      }
    });

    return NextResponse.json({ folder: folderDetails, role });
  } catch (error) {
    console.error(`GET /api/folders/id error:`, error);
    return NextResponse.json(
      { error: "Failed to fetch folder" },
      { status: 500 }
    );
  }
}

// PUT /api/folders/[id] - Update folder
export async function PUT(
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
    if (!hasAccess || (role !== "OWNER" && role !== "EDITOR")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const validation = updateFolderSchema.safeParse(body);
    
    if (!validation.success) {
      return NextResponse.json({ error: validation.error.format() }, { status: 400 });
    }

    const { name, description, isPublic } = validation.data;

    const updatedFolder = await prisma.folder.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(isPublic !== undefined && { isPublic }),
      }
    });

    return NextResponse.json({ folder: updatedFolder });
  } catch (error) {
    console.error(`PUT /api/folders/id error:`, error);
    return NextResponse.json(
      { error: "Failed to update folder" },
      { status: 500 }
    );
  }
}

// DELETE /api/folders/[id] - Delete folder
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { folder } = await hasFolderAccess(id, userId);

    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    // Only owner can delete
    if (folder.ownerId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await deleteFolderWithRelations(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`DELETE /api/folders/id error:`, error);
    return NextResponse.json(
      { error: "Failed to delete folder" },
      { status: 500 }
    );
  }
}
