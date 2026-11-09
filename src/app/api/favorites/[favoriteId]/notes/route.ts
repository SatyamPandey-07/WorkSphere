import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { favoriteNotesSchema, validateRequest } from "@/lib/validations";

interface RouteContext {
  params: Promise<{ favoriteId: string }>;
}

// PATCH /api/favorites/[favoriteId]/notes - Update notes
export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureUserExists(userId);

    const { favoriteId } = await context.params;
    const body = await req.json();

    const validation = validateRequest(favoriteNotesSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const favorite = await prisma.favorite.findFirst({
      where: { id: favoriteId, userId },
    });

    if (!favorite) {
      return NextResponse.json({ error: "Favorite not found" }, { status: 404 });
    }

    const notesToStore =
      typeof validation.data.notes === "object" && validation.data.notes !== null
        ? JSON.stringify(validation.data.notes)
        : validation.data.notes;

    const updated = await prisma.favorite.update({
      where: { id: favoriteId },
      data: { notes: notesToStore },
      include: { tags: true, venue: true },
    });

    return NextResponse.json({ favorite: updated });
  } catch (error) {
    console.error("PATCH /api/favorites/[favoriteId]/notes error:", error);
    return NextResponse.json(
      { error: "Failed to update notes" },
      { status: 500 },
    );
  }
}
