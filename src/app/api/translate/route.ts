import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { Groq } from "groq-sdk";
import { rateLimit } from "@/lib/rateLimit";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "dummy-key-for-build",
});

/** Maximum characters accepted per translation request */
const MAX_TEXT_LENGTH = 2000;

/** ISO 639-1 language codes + common names that are accepted as targetLanguage */
const ALLOWED_LANGUAGES = new Set([
  "en", "english",
  "es", "spanish",
  "fr", "french",
  "de", "german",
  "it", "italian",
  "pt", "portuguese",
  "nl", "dutch",
  "ru", "russian",
  "zh", "chinese",
  "ja", "japanese",
  "ko", "korean",
  "ar", "arabic",
  "hi", "hindi",
  "pl", "polish",
  "sv", "swedish",
  "tr", "turkish",
  "vi", "vietnamese",
  "th", "thai",
  "id", "indonesian",
]);

export async function POST(req: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit: 10 translation requests per minute per user
    const limited = await rateLimit(`translate:${userId}`, 10, 60_000);
    if (!limited) {
      return NextResponse.json(
        { error: "Too many requests. Please wait before translating again." },
        { status: 429 },
      );
    }

    const body = await req.json();
    const { text, targetLanguage } = body;

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid text field" },
        { status: 400 },
      );
    }

    if (!targetLanguage || typeof targetLanguage !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid targetLanguage field" },
        { status: 400 },
      );
    }

    // Input length guard — prevents token-cost abuse
    if (text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json(
        {
          error: `Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters`,
        },
        { status: 400 },
      );
    }

    // Language allowlist — prevents arbitrary targetLanguage prompt injection
    const normalised = targetLanguage.trim().toLowerCase();
    if (!ALLOWED_LANGUAGES.has(normalised)) {
      return NextResponse.json(
        { error: "Unsupported target language" },
        { status: 400 },
      );
    }

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a professional translator. Strictly translate the user's text into the language: ${normalised}. Do not provide any explanations, notes, or quotes. Output ONLY the translated text. Ensure the tone is natural and appropriate for a venue review.`,
        },
        {
          role: "user",
          content: text,
        },
      ],
      model: "llama-3.1-8b-instant",
      temperature: 0.3,
      max_tokens: 1024,
    });

    const translatedText = completion.choices[0]?.message?.content?.trim();

    if (!translatedText) {
      throw new Error("Failed to generate translation");
    }

    return NextResponse.json({ translatedText });
  } catch (error) {
    console.error("Translation API error:", error);
    return NextResponse.json({ error: "Translation failed" }, { status: 500 });
  }
}
