import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { translateVenueDescription } from "@/lib/deeplTranslation";
import {
  checkTieredRateLimit,
  createRateLimitResponse,
  applyRateLimitHeaders,
} from "@/lib/rateLimit";

interface RouteContext {
  params: Promise<{ venueId: string }>;
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const rateLimitResult = await checkTieredRateLimit(req);
    if (!rateLimitResult.allowed) {
      return createRateLimitResponse(rateLimitResult);
    }

    const { venueId } = await context.params;
    const body = await req.json();
    const { targetLang, text } = body;

    if (!targetLang) {
      return NextResponse.json(
        { error: "Target language (targetLang) is required" },
        { status: 400 },
      );
    }

    let descriptionToTranslate = text;
    if (!descriptionToTranslate) {
      const venue = await prisma.venue.findUnique({
        where: { id: venueId },
        select: { hostMessage: true, name: true },
      });
      descriptionToTranslate = venue?.hostMessage || venue?.name || "";
    }

    if (!descriptionToTranslate) {
      const emptyResponse = NextResponse.json({ translatedDescription: "" });
      return applyRateLimitHeaders(emptyResponse, rateLimitResult);
    }

    const translatedDescription = await translateVenueDescription({
      text: descriptionToTranslate,
      targetLang,
    });

    const response = NextResponse.json({
      venueId,
      targetLang: targetLang.toUpperCase(),
      translatedDescription,
      success: true,
      timestamp: new Date().toISOString(),
    });
    return applyRateLimitHeaders(response, rateLimitResult);
  } catch (error: any) {
    console.error("Venue Translation API Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 },
    );
  }
}
