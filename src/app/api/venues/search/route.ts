import { NextResponse } from "next/server";
import { searchVenuesPhonetic } from "@/lib/search/phoneticVenueSearch";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q");
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 20;

    if (!q) {
      return NextResponse.json({ results: [] });
    }

    const results = await searchVenuesPhonetic(q, limit);
    return NextResponse.json({ results });
  } catch (error: any) {
    console.error("Phonetic Venue Search Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}