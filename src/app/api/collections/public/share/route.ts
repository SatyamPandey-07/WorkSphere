import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { hasFolderAccess } from "@/lib/folders";
import crypto from "crypto";

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { folderId } = body;

    if (!folderId) {
      return NextResponse.json({ error: "Folder ID is required" }, { status: 400 });
    }

    const access = await hasFolderAccess(folderId, userId);
    if (!access.folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    if (!access.hasAccess || (access.role !== "OWNER" && access.role !== "EDITOR")) {
      return NextResponse.json({ error: "Only folder owners and editors can share" }, { status: 403 });
    }

    let token = access.folder.inviteToken;
    if (!token) {
      token = crypto.randomBytes(6).toString("hex");
      await prisma.folder.update({
        where: { id: folderId },
        data: {
          inviteToken: token,
          isPublic: true,
        },
      });
    } else if (!access.folder.isPublic) {
      await prisma.folder.update({
        where: { id: folderId },
        data: { isPublic: true },
      });
    }

    return NextResponse.json({ success: true, token });
  } catch (error) {
    console.error("POST /api/collections/public/share error:", error);
    return NextResponse.json({ error: "Failed to generate share link" }, { status: 500 });
  }
}
