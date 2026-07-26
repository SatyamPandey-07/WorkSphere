import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, getRateLimitInfo } from "@/lib/rateLimit";
import { timingSafeEqual } from "crypto";

function verifySharedSecret(req: NextRequest): boolean {
  const secret = process.env.PARTYKIT_SHARED_SECRET;
  if (!secret) {
    console.warn(
      "PARTYKIT_SHARED_SECRET is not set — rejecting PartyKit auth request",
    );
    return false;
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }

  const token = authHeader.slice(7);
  if (token.length !== secret.length) return false;

  return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
}

// Internal endpoint for PartyKit to verify user roles.
// Secured with PARTYKIT_SHARED_SECRET to prevent abuse.
export async function GET(req: NextRequest) {
  if (!verifySharedSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
