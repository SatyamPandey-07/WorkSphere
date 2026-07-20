import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { createFavoriteTagSchema, validateRequest } from "@/lib/validations";

interface RouteContext {
  params: Promise<{ favoriteId: string }>;
}

// GET /api/favorites/[favoriteId]/tags - List tags for a favorite
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureUserExists(userId);

    const { favoriteId } = await context.params;

    const favorite = await prisma.favorite.findFirst({
      where: { id: favoriteId, userId },
    });

    if (!favorite) {
      return NextResponse.json({ error: "Favorite not found" }, { status: 404 });
    }

    const tags = await prisma.favoriteTag.findMany({
      where: { favoriteId },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ tags });
  } catch (error) {
    console.error("GET /api/favorites/[favoriteId]/tags error:", error);
    return NextResponse.json(
      { error: "Failed to fetch tags" },
      { status: 500 },
    );
  }
}

// POST /api/favorites/[favoriteId]/tags - Create a tag
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureUserExists(userId);

    const { favoriteId } = await context.params;
    const body = await req.json();

    const validation = validateRequest(createFavoriteTagSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const favorite = await prisma.favorite.findFirst({
      where: { id: favoriteId, userId },
    });

    if (!favorite) {
      return NextResponse.json({ error: "Favorite not found" }, { status: 404 });
    }

    const tag = await prisma.favoriteTag.create({
      data: {
        favoriteId,
        name: validation.data.name,
        color: validation.data.color,
      },
    });

    return NextResponse.json({ tag }, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/favorites/[favoriteId]/tags error:", error);

    if (error.code === "P2002") {
      return NextResponse.json(
        { error: "Tag with this name already exists" },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "Failed to create tag" },
      { status: 500 },
    );
  }
}
