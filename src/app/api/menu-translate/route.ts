import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { text, targetLanguage } = await req.json();

    if (!text || !targetLanguage) {
      return NextResponse.json(
        { error: "Missing text or targetLanguage" },
        { status: 400 },
      );
    }

    // Map common languages to Google Translate codes if needed (or assume targetLanguage is valid)
    const langMap: Record<string, string> = {
      English: "en",
      Hindi: "hi",
      French: "fr",
      German: "de",
      Spanish: "es",
    };

    const tl = langMap[targetLanguage] || targetLanguage;

    // Google Translate Free API endpoint
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(
      text,
    )}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Failed to fetch translation from Google");
    }

    const data = await response.json();
    // The response is an array where the first element is an array of translated segments
    const translatedText = data[0].map((item: any) => item[0]).join("");

    if (!translatedText) {
      throw new Error("Failed to generate translation");
    }

    return NextResponse.json({ translatedText });
  } catch (error) {
    console.error("Translation API error:", error);
    return NextResponse.json({ error: "Translation failed" }, { status: 500 });
  }
}
