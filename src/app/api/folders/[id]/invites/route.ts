import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { hasFolderAccess } from "@/lib/folders";
import crypto from "crypto";

// POST /api/folders/[id]/invites - Generate or regenerate invite token
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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
      return NextResponse.json(
        { error: "Forbidden. Only owner or editor can generate invites." },
        { status: 403 },
      );
    }

    const timestamp = Date.now();
    const inviteToken = `${crypto.randomBytes(16).toString("hex")}_${timestamp}`;

    const updatedFolder = await prisma.folder.update({
      where: { id },
      data: { inviteToken },
    });

    return NextResponse.json({ inviteToken: updatedFolder.inviteToken });
  } catch (error) {
    console.error(`POST /api/folders/invites error:`, error);
    return NextResponse.json(
      { error: "Failed to generate invite token" },
      { status: 500 },
    );
  }
}
