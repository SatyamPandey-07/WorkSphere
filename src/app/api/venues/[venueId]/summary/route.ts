import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateGeminiText } from "@/lib/ai/gemini";
import {
  checkTieredRateLimit,
  applyRateLimitHeaders,
} from "@/lib/rateLimit";
import { apiError } from "@/lib/apiResponse";

interface RouteContext {
  params: Promise<{ venueId: string }>;
}

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const rateLimitResult = await checkTieredRateLimit(request);
    if (!rateLimitResult.allowed) {
      return applyRateLimitHeaders(
        apiError(
          "Too many requests. Please try again later.",
          429,
          "RATE_LIMITED",
        ),
        rateLimitResult,
      );
    }

    const { venueId } = await params;

    if (!venueId) {
      return apiError("Venue ID is required", 400, "VALIDATION_FAILED");
    }

    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
    });

    if (!venue) {
      return apiError("Venue not found", 404, "VENUE_NOT_FOUND");
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

    return apiError("Failed to generate venue summary", 500, "INTERNAL_ERROR");
  }
}
