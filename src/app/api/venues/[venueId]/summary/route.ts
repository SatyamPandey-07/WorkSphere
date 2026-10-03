import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateGeminiText } from "@/lib/ai/gemini";
import {
  checkTieredRateLimit,
  createRateLimitResponse,
  applyRateLimitHeaders,
} from "@/lib/rateLimit";

interface RouteContext {
  params: Promise<{ venueId: string }>;
}

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const rateLimitResult = await checkTieredRateLimit(request);
    if (!rateLimitResult.allowed) {
      return createRateLimitResponse(rateLimitResult);
    }

    const { venueId } = await params;

    if (!venueId) {
      return NextResponse.json(
        { error: "Venue ID is required" },
        { status: 400 },
      );
    }

    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
    });

    if (!venue) {
      return NextResponse.json({ error: "Venue not found" }, { status: 404 });
    }

    const venueContext = {
      category: venue.category,
      wifiQuality: venue.wifiQuality,
      hasOutlets: venue.hasOutlets,
      noiseLevel: venue.noiseLevel,
      hasErgonomic: venue.hasErgonomic,
      hasPhoneBooths: venue.hasPhoneBooths,
      hasQuietZone: venue.hasQuietZone,
      outletDensity: venue.outletDensity,
    };

    const prompt = `
Generate a concise 2-3 sentence summary of a venue for its detail page.

Use only the information provided below.
Do not invent facts or make claims about the venue that are not supported by these attributes.
Write naturally for someone deciding whether the venue is suitable for remote work.

Venue attributes:
${JSON.stringify(venueContext, null, 2)}

Return only the summary text.
`;

    const summary = await generateGeminiText(prompt);

    const response = NextResponse.json({ summary });
    return applyRateLimitHeaders(response, rateLimitResult);
  } catch (error) {
    console.error("Failed to generate venue summary:", error);

    return NextResponse.json(
      { error: "Failed to generate venue summary" },
      { status: 500 },
    );
  }
}
