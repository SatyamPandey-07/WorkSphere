import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { hasFolderAccess } from "@/lib/folders";
import { createShortLinkSchema } from "@/lib/validations";
import crypto from "crypto";

const RESERVED_WORDS = new Set([
  "api",
  "collections",
  "s",
  "sign-in",
  "sign-up",
  "admin",
  "ai",
  "reserve",
  "static",
  "public",
  "favicon",
  "icon",
  "assets",
]);

function generateRandomShortCode(): string {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// GET /api/folders/[id]/short-links - List all short links for a folder
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: folderId } = await params;
    const access = await hasFolderAccess(folderId, userId);

    if (!access.folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    if (
      !access.hasAccess ||
      (access.role !== "OWNER" && access.role !== "EDITOR")
    ) {
      return NextResponse.json(
        { error: "Forbidden: Only owners and editors can view short links" },
        { status: 403 },
      );
    }

    const shortLinks = await prisma.shortLink.findMany({
      where: { folderId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ success: true, shortLinks });
  } catch (error) {
    console.error("GET /api/folders/[id]/short-links error:", error);
    return NextResponse.json(
      { error: "Failed to fetch short links" },
      { status: 500 },
    );
  }
}

// POST /api/folders/[id]/short-links - Create a new short link for a folder
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: folderId } = await params;
    const access = await hasFolderAccess(folderId, userId);

    if (!access.folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    if (
      !access.hasAccess ||
      (access.role !== "OWNER" && access.role !== "EDITOR")
    ) {
      return NextResponse.json(
        {
          error:
            "Forbidden: Only folder owners and editors can generate short links",
        },
        { status: 403 },
      );
    }

    const body = await request.json();
    const validationResult = createShortLinkSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: validationResult.error.issues.map((i) => i.message).join(", "),
        },
        { status: 400 },
      );
    }

    const { customCode, expiration } = validationResult.data;

    let finalShortCode = "";

    if (customCode) {
      const normalizedCode = customCode.trim().toLowerCase();

      // Check reserved words
      if (RESERVED_WORDS.has(normalizedCode)) {
        return NextResponse.json(
          { error: "This custom code is a reserved word and cannot be used" },
          { status: 400 },
        );
      }

      // Check uniqueness in database
      const existing = await prisma.shortLink.findUnique({
        where: { shortCode: normalizedCode },
      });

      if (existing) {
        return NextResponse.json(
          { error: "This custom short code is already in use" },
          { status: 409 },
        );
      }

      finalShortCode = normalizedCode;
    } else {
      // Generate a unique random code
      let attempts = 0;
      const maxAttempts = 10;
      while (attempts < maxAttempts) {
        const candidate = generateRandomShortCode();
        const existing = await prisma.shortLink.findUnique({
          where: { shortCode: candidate },
        });

        if (!existing) {
          finalShortCode = candidate;
          break;
        }
        attempts++;
      }

      if (!finalShortCode) {
        return NextResponse.json(
          {
            error: "Failed to generate a unique short link. Please try again.",
          },
          { status: 500 },
        );
      }
    }

    // Calculate expiration
    let expiresAt: Date | null = null;
    const now = new Date();
    if (expiration === "24h") {
      expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    } else if (expiration === "7d") {
      expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    }

    // Ensure folder has an inviteToken (required for the redirect URL target)
    let inviteToken = access.folder.inviteToken;
    if (!inviteToken) {
      inviteToken = crypto.randomBytes(6).toString("hex");
      await prisma.folder.update({
        where: { id: folderId },
        data: {
          inviteToken,
        },
      });
    }

    // Create ShortLink
    const shortLink = await prisma.shortLink.create({
      data: {
        shortCode: finalShortCode,
        folderId,
        expiresAt,
      },
    });

    return NextResponse.json({ success: true, shortLink }, { status: 201 });
  } catch (error) {
    console.error("POST /api/folders/[id]/short-links error:", error);
    return NextResponse.json(
      { error: "Failed to generate short link" },
      { status: 500 },
    );
  }
}
