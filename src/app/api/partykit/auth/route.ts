import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, getRateLimitInfo } from "@/lib/rateLimit";
import { timingSafeEqual } from "crypto";

const ALLOWED_ORIGINS = [
  process.env.NEXT_PUBLIC_APP_URL,
  process.env.NEXT_PUBLIC_PARTYKIT_URL,
  "http://127.0.0.1:1999",
  "http://localhost:3000",
].filter(Boolean) as string[];

function getCorsHeaders(req: NextRequest): HeadersInit {
  const origin = req.headers.get("origin") ?? "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] ?? "*";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(req) });
}

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
  const corsHeaders = getCorsHeaders(req);

  if (!verifySharedSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
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
      { status: 429, headers: { ...corsHeaders, "Retry-After": String(retryAfter) } },
    );
  }

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  const folderId = searchParams.get("folderId");

  if (!userId || !folderId) {
    return NextResponse.json({ role: "VIEWER" }, { headers: corsHeaders });
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
      return NextResponse.json({ role: membership.role }, { headers: corsHeaders });
    }

    // Check if they are the owner
    const folder = await prisma.folder.findUnique({
      where: { id: folderId },
      select: { ownerId: true },
    });

    if (folder && folder.ownerId === userId) {
      return NextResponse.json({ role: "OWNER" }, { headers: corsHeaders });
    }

    return NextResponse.json({ role: "VIEWER" }, { headers: corsHeaders });
  } catch (err) {
    console.error("PartyKit Auth API error:", err);
    return NextResponse.json({ role: "VIEWER" }, { headers: corsHeaders });
  }
}
