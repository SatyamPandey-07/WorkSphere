import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { hasFolderAccess } from "@/lib/folders";
import crypto from "crypto";

const MAX_TOKEN_CLAIM_ATTEMPTS = 3;

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

async function ensurePublicShareToken(
  folderId: string,
  initialToken: string | null,
  initialIsPublic: boolean,
): Promise<{ token: string } | null> {
  if (initialToken) {
    if (!initialIsPublic) {
      const updated = await prisma.folder.updateMany({
        where: { id: folderId, isPublic: false },
        data: { isPublic: true },
      });
      if (updated.count === 0) {
        const current = await prisma.folder.findUnique({
          where: { id: folderId },
          select: { inviteToken: true, isPublic: true },
        });
        if (!current) return null;
        if (current.inviteToken) {
          return { token: current.inviteToken };
        }
      }
    }
    return { token: initialToken };
  }

  for (let attempt = 0; attempt < MAX_TOKEN_CLAIM_ATTEMPTS; attempt += 1) {
    const candidateToken = crypto.randomBytes(6).toString("hex");
    try {
      const claimed = await prisma.folder.updateMany({
        where: { id: folderId, inviteToken: null },
        data: {
          inviteToken: candidateToken,
          isPublic: true,
        },
      });

      if (claimed.count > 0) {
        return { token: candidateToken };
      }
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        continue;
      }
      throw error;
    }

    const existing = await prisma.folder.findUnique({
      where: { id: folderId },
      select: { inviteToken: true, isPublic: true },
    });

    if (!existing) {
      return null;
    }

    if (existing.inviteToken) {
      if (!existing.isPublic) {
        await prisma.folder.updateMany({
          where: { id: folderId, isPublic: false },
          data: { isPublic: true },
        });
      }
      return { token: existing.inviteToken };
    }
  }

  throw new Error("Unable to atomically assign a unique share token");
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request body" },
        { status: 400 },
      );
    }

    const rawFolderId =
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      "folderId" in body
        ? (body as { folderId?: unknown }).folderId
        : undefined;
    const folderId = typeof rawFolderId === "string" ? rawFolderId.trim() : "";

    if (!folderId) {
      return NextResponse.json(
        { error: "Folder ID is required" },
        { status: 400 },
      );
    }

    const access = await hasFolderAccess(folderId, userId);
    if (!access.folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    if (
      !access.hasAccess ||
      (access.role !== "OWNER" && access.role !== "EDITOR")
    ) {
      return NextResponse.json(
        { error: "Only folder owners and editors can share" },
        { status: 403 },
      );
    }

    const result = await ensurePublicShareToken(
      folderId,
      access.folder.inviteToken,
      access.folder.isPublic,
    );

    if (!result) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, token: result.token });
  } catch (error) {
    console.error("POST /api/collections/public/share error:", error);
    return NextResponse.json(
      { error: "Failed to generate share link" },
      { status: 500 },
    );
  }
}
