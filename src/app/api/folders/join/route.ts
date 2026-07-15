import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { ensureUserExists } from "@/lib/auth";

const joinSchema = z.object({
  token: z.string(),
});

// POST /api/folders/join - Join a folder using an invite token
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Ensure the guest user exists in the local database to avoid foreign key violations
    await ensureUserExists(userId);

    const body = await req.json();
    const validation = joinSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid token format" },
        { status: 400 },
      );
    }

    const { token } = validation.data;

    const folder = await prisma.folder.findUnique({
      where: { inviteToken: token },
      include: { members: true },
    });

    if (!folder) {
      return NextResponse.json(
        { error: "Invalid or expired invite token" },
        { status: 404 },
      );
    }

    // Check validity timestamp (48 hours validity)
    const parts = token.split("_");
    const timestamp = Number(parts[parts.length - 1]);
    const fortyEightHours = 48 * 60 * 60 * 1000;
    if (isNaN(timestamp) || Date.now() - timestamp > fortyEightHours) {
      return NextResponse.json(
        { error: "Invalid or expired invite token" },
        { status: 410 },
      );
    }

    // Check if already a member
    const existingMember = folder.members.find((m) => m.userId === userId);
    if (existingMember) {
      return NextResponse.json(
        { message: "Already a member", folderId: folder.id },
        { status: 200 },
      );
    }

    // Add user as member
    await prisma.folderMember.create({
      data: {
        folderId: folder.id,
        userId: userId,
        role: "MEMBER",
      },
    });

    return NextResponse.json(
      { success: true, folderId: folder.id },
      { status: 200 },
    );
  } catch (error) {
    console.error("POST /api/folders/join error:", error);
    return NextResponse.json(
      { error: "Failed to join folder" },
      { status: 500 },
    );
  }
}
