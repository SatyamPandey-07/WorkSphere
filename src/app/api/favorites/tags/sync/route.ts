import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { syncFavoriteTagsSchema, validateRequest } from "@/lib/validations";
import { syncFavoriteTagsBulk } from "@/lib/favoriteTagSync";

// POST /api/favorites/tags/sync - Bulk-update tags across saved venues
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureUserExists(userId);

    const body = await req.json();
    const validation = validateRequest(syncFavoriteTagsSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { updates } = validation.data;
    const tagIds = updates.map((u) => u.id);

    const ownedTags = await prisma.favoriteTag.findMany({
      where: {
        id: { in: tagIds },
        favorite: { userId },
      },
      select: { id: true },
    });

    if (ownedTags.length !== new Set(tagIds).size) {
      return NextResponse.json(
        { error: "One or more tags were not found" },
        { status: 404 },
      );
    }

    const tags = await syncFavoriteTagsBulk(updates);

    return NextResponse.json({ tags });
  } catch (error: unknown) {
    console.error("POST /api/favorites/tags/sync error:", error);

    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: string }).code
        : undefined;

    if (code === "P2002") {
      return NextResponse.json(
        { error: "Tag with this name already exists" },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "Failed to sync tags" },
      { status: 500 },
    );
  }
}
