import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "dummy-key-for-build",
});

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Allow longer execution for LLM streaming

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { prompt, clauseText } = body;

    if (!prompt || !clauseText) {
      return NextResponse.json(
        { error: "Missing prompt or clause text" },
        { status: 400 },
      );
    }

    // Proxy to Groq securely without exposing API keys to the client
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: clauseText },
      ],
      model: "llama3-70b-8192",
      temperature: 0.2,
      max_tokens: 1024,
      response_format: { type: "json_object" },
    });

    const llmResponse = completion.choices[0]?.message?.content || "{}";

    return NextResponse.json(
      {
        success: true,
        analysis: JSON.parse(llmResponse),
        tokensUsed: completion.usage?.total_tokens || 0,
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("[LEGAL_REDLINE_API]", error);
    return NextResponse.json(
      {
        error: "Failed to generate redline analysis",
        details: error.message,
      },
      { status: 500 },
    );
  }
}
