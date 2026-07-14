import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Internal endpoint for PartyKit to verify user roles.
// In production, you should secure this with a shared secret to prevent abuse.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  const folderId = searchParams.get("folderId");

  if (!userId || !folderId) {
    return NextResponse.json({ role: "VIEWER" });
  }

  try {
    const membership = await prisma.folderMember.findUnique({
      where: {
        folderId_userId: {
          folderId,
          userId,
        },
      },
    });

    if (membership) {
      return NextResponse.json({ role: membership.role });
    }

    // Check if they are the owner
    const folder = await prisma.folder.findUnique({
      where: { id: folderId },
      select: { ownerId: true },
    });

    if (folder && folder.ownerId === userId) {
      return NextResponse.json({ role: "OWNER" });
    }

    return NextResponse.json({ role: "VIEWER" });
  } catch (err) {
    console.error("PartyKit Auth API error:", err);
    return NextResponse.json({ role: "VIEWER" });
  }
}
