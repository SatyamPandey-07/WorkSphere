import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { rateLimit } from "@/lib/rateLimit";

/** Maximum characters accepted per translation request, matching /api/translate. */
const MAX_TEXT_LENGTH = 2000;

/** Display names the menu UI exposes, mapped to ISO 639-1 codes. */
const LANGUAGE_ALIASES: Record<string, string> = {
  english: "en",
  hindi: "hi",
  french: "fr",
  german: "de",
  spanish: "es",
};

/** A plain ISO 639-1 code, optionally with a region suffix (en, pt-BR). */
const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(-[a-z]{2,4})?$/i;

/** Resolves a user-supplied language to a code safe to interpolate into a URL. */
function resolveTargetLanguage(value: string): string | null {
  const normalised = value.trim().toLowerCase();
  if (!normalised) return null;
  if (LANGUAGE_ALIASES[normalised]) return LANGUAGE_ALIASES[normalised];
  return LANGUAGE_CODE_PATTERN.test(normalised) ? normalised : null;
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit: 10 translation requests per minute per user, as /api/translate does.
    const allowed = await rateLimit(`menu-translate:${userId}`, 10, 60_000);
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait before translating again." },
        { status: 429 },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { text, targetLanguage } =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as { text?: unknown; targetLanguage?: unknown })
        : ({} as { text?: unknown; targetLanguage?: unknown });

    if (typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json({ error: "Missing text" }, { status: 400 });
    }

    if (text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json(
        { error: `Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters` },
        { status: 400 },
      );
    }

    if (typeof targetLanguage !== "string") {
      return NextResponse.json(
        { error: "Missing targetLanguage" },
        { status: 400 },
      );
    }

    const target = resolveTargetLanguage(targetLanguage);
    if (!target) {
      return NextResponse.json(
        { error: "Unsupported target language" },
        { status: 400 },
      );
    }

    // Google Translate Free API endpoint
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(
      target,
    )}&dt=t&q=${encodeURIComponent(text)}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Failed to fetch translation from Google");
    }

    const data = await response.json();
    // The response is an array whose first element holds the translated segments.
    const translatedText = Array.isArray(data?.[0])
      ? data[0]
          .map((item: unknown) => (Array.isArray(item) ? item[0] : ""))
          .join("")
      : "";

    if (!translatedText) {
      throw new Error("Failed to generate translation");
    }

    return NextResponse.json({ translatedText });
  } catch (error) {
    console.error("Translation API error:", error);
    return NextResponse.json({ error: "Translation failed" }, { status: 500 });
  }
}
