import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, getRateLimitInfo } from "@/lib/rateLimit";

// Internal endpoint for PartyKit to verify user roles.
// In production, you should secure this with a shared secret to prevent abuse.
export async function GET(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "anonymous";
  const identifier = `partykit-auth:${ip}`;

  const allowed = await rateLimit(identifier, 30);
  if (!allowed) {
    const info = await getRateLimitInfo(identifier, 30);
    const retryAfter = info?.resetTime
      ? Math.ceil((info.resetTime - Date.now()) / 1000)
      : 60;

    return NextResponse.json(
      {
        error: "Too many authentication requests. Please try again later.",
        retryAfter,
      },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

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
