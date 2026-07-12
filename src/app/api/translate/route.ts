import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { Groq } from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { text, targetLanguage } = await req.json();

    if (!text || !targetLanguage) {
      return NextResponse.json({ error: "Missing text or targetLanguage" }, { status: 400 });
    }

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a professional translator. Strictly translate the user's text into the language: ${targetLanguage}. Do not provide any explanations, notes, or quotes. Output ONLY the translated text. Ensure the tone is natural and appropriate for a venue review.`,
        },
        {
          role: "user",
          content: text,
        },
      ],
      model: "llama-3.1-8b-instant", // Using a fast model for translation
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
