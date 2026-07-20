import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { z } from "zod";

const UPVOTE_RATE_LIMIT = 5;

const upvoteSchema = z.object({
  folderId: z.string().min(1, "Folder ID is required"),
});

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allowed = await rateLimit(`upvote:${userId}`, UPVOTE_RATE_LIMIT);
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        { status: 429 },
      );
    }

    const body = await req.json();
    const validation = upvoteSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error.format() }, { status: 400 });
    }

    const { folderId } = validation.data;

    const result = await prisma.$transaction(async (tx) => {
      const folder = await tx.folder.findUnique({
        where: { id: folderId },
      });

      if (!folder) {
        throw new Error("NOT_FOUND");
      }
      if (!folder.isPublic) {
        throw new Error("NOT_PUBLIC");
      }

      const existingUpvote = await tx.folderUpvote.findUnique({
        where: {
          folderId_userId: {
            folderId,
            userId,
          },
        },
      });

      if (existingUpvote) {
        await tx.folderUpvote.delete({
          where: { id: existingUpvote.id },
        });
        await tx.folder.update({
          where: { id: folderId },
          data: { upvotes: { decrement: 1 } },
        });
        return { hasUpvoted: false, upvotes: folder.upvotes - 1 };
      }

      await tx.folderUpvote.create({
        data: { folderId, userId },
      });
      await tx.folder.update({
        where: { id: folderId },
        data: { upvotes: { increment: 1 } },
      });
      return { hasUpvoted: true, upvotes: folder.upvotes + 1 };
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    if (error?.message === "NOT_FOUND") {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }
    if (error?.message === "NOT_PUBLIC") {
      return NextResponse.json({ error: "Cannot vote on private collections" }, { status: 400 });
    }
    console.error("POST /api/collections/public/upvote error:", error);
    return NextResponse.json(
      { error: "Failed to process upvote" },
      { status: 500 },
    );
  }
}
