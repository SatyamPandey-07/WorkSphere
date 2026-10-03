import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { translateVenueDescription } from "@/lib/deeplTranslation";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    const { targetLang, text } = body;

    if (!targetLang) {
      return NextResponse.json(
        { error: "Target language (targetLang) is required" },
        { status: 400 }
      );
    }

    let descriptionToTranslate = text;
    if (!descriptionToTranslate) {
      const venue = await prisma.venue.findUnique({
        where: { id },
        select: { description: true },
      });
      descriptionToTranslate = venue?.description || "";
    }

    if (!descriptionToTranslate) {
      return NextResponse.json({ translatedDescription: "" });
    }

    const translatedDescription = await translateVenueDescription({
      text: descriptionToTranslate,
      targetLang,
    });

    return NextResponse.json({
      venueId: id,
      targetLang: targetLang.toUpperCase(),
      translatedDescription,
      success: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("Venue Translation API Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 }
    );
  }
}