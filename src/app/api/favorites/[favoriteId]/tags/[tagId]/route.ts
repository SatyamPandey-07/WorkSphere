import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { updateFavoriteTagSchema, validateRequest } from "@/lib/validations";

interface RouteContext {
  params: Promise<{ favoriteId: string; tagId: string }>;
}

// PATCH /api/favorites/[favoriteId]/tags/[tagId] - Update tag
export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureUserExists(userId);

    const { favoriteId, tagId } = await context.params;
    const body = await req.json();

    const validation = validateRequest(updateFavoriteTagSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const favorite = await prisma.favorite.findFirst({
      where: { id: favoriteId, userId },
    });

    if (!favorite) {
      return NextResponse.json({ error: "Favorite not found" }, { status: 404 });
    }

    const existingTag = await prisma.favoriteTag.findFirst({
      where: { id: tagId, favoriteId },
    });

    if (!existingTag) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    }

    const updated = await prisma.favoriteTag.update({
      where: { id: tagId },
      data: validation.data,
    });

    return NextResponse.json({ tag: updated });
  } catch (error: any) {
    console.error("PATCH /api/favorites/[favoriteId]/tags/[tagId] error:", error);

    if (error.code === "P2002") {
      return NextResponse.json(
        { error: "Tag with this name already exists" },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "Failed to update tag" },
      { status: 500 },
    );
  }
}

// DELETE /api/favorites/[favoriteId]/tags/[tagId] - Delete tag
export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureUserExists(userId);

    const { favoriteId, tagId } = await context.params;

    const favorite = await prisma.favorite.findFirst({
      where: { id: favoriteId, userId },
    });

    if (!favorite) {
      return NextResponse.json({ error: "Favorite not found" }, { status: 404 });
    }

    const existingTag = await prisma.favoriteTag.findFirst({
      where: { id: tagId, favoriteId },
    });

    if (!existingTag) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    }

    await prisma.favoriteTag.delete({
      where: { id: tagId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/favorites/[favoriteId]/tags/[tagId] error:", error);
    return NextResponse.json(
      { error: "Failed to delete tag" },
      { status: 500 },
    );
  }
}
