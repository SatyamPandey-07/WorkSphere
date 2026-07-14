import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const upvoteSchema = z.object({
  folderId: z.string().min(1, "Folder ID is required"),
});

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const validation = upvoteSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error.format() }, { status: 400 });
    }

    const { folderId } = validation.data;

    // Verify folder exists and is public
    const folder = await prisma.folder.findUnique({
      where: { id: folderId },
    });

    if (!folder) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }
    if (!folder.isPublic) {
      return NextResponse.json({ error: "Cannot vote on private collections" }, { status: 400 });
    }

    // Check if user has already upvoted
    const existingUpvote = await prisma.folderUpvote.findUnique({
      where: {
        folderId_userId: {
          folderId,
          userId,
        },
      },
    });

    let hasUpvoted = false;
    let newUpvoteCount = folder.upvotes;

    if (existingUpvote) {
      // Toggle off: remove upvote
      await prisma.$transaction([
        prisma.folderUpvote.delete({
          where: {
            id: existingUpvote.id,
          },
        }),
        prisma.folder.update({
          where: { id: folderId },
          data: {
            upvotes: {
              decrement: 1,
            },
          },
        }),
      ]);
      newUpvoteCount -= 1;
      hasUpvoted = false;
    } else {
      // Toggle on: add upvote
      await prisma.$transaction([
        prisma.folderUpvote.create({
          data: {
            folderId,
            userId,
          },
        }),
        prisma.folder.update({
          where: { id: folderId },
          data: {
            upvotes: {
              increment: 1,
            },
          },
        }),
      ]);
      newUpvoteCount += 1;
      hasUpvoted = true;
    }

    return NextResponse.json({ 
      success: true, 
      hasUpvoted, 
      upvotes: newUpvoteCount 
    });
  } catch (error) {
    console.error("POST /api/collections/public/upvote error:", error);
    return NextResponse.json(
      { error: "Failed to process upvote" },
      { status: 500 }
    );
  }
}
