import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { Groq } from "groq-sdk";

export const dynamic = "force-dynamic";

let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!_groq) {
    const key = process.env.GROQ_API_KEY || "dummy_groq_key";
    _groq = new Groq({ apiKey: key });
  }
  return _groq;
}

export async function POST(req: NextRequest) {
  try {
    const _user = await currentUser().catch(() => null);
    const body = await req.json().catch(() => ({}));
    const prompt =
      body.prompt || "Suggest top quiet workspaces tailored to my preferences.";
    const memories = Array.isArray(body.memories) ? body.memories : [];

    const memoryContext =
      memories.length > 0
        ? `User Stated Preferences:\n${memories.map((m: string) => `- ${m}`).join("\n")}\n\n`
        : "";

    const systemPrompt = `You are WorkSphere's intelligent workspace concierge. Generate tailored workspace suggestions and advice based on user preferences. Keep responses structured, helpful, and concise.`;

    const groqKey = process.env.GROQ_API_KEY;

    // Create ReadableStream for SSE
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        const sendEvent = (data: Record<string, unknown>) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        };

        try {
          if (!groqKey) {
            // Simulated fallback stream for test/offline environments
            const simulatedChunks = [
              "Based on your preferences, ",
              "we recommend visiting quiet library lounges ",
              "with dedicated power outlets and fast fiber WiFi. ",
              "Consider booking a morning desk slot at WeWork Central or Spaces.",
            ];

            for (const chunk of simulatedChunks) {
              sendEvent({ chunk });
              // Small delay simulation
              await new Promise((r) => setTimeout(r, 20));
            }

            sendEvent({ done: true });
            controller.close();
            return;
          }

          const groq = getGroq();
          const groqStream = await groq.chat.completions.create({
            messages: [
              { role: "system", content: systemPrompt },
              {
                role: "user",
                content: `${memoryContext}User Request: ${prompt}`,
              },
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.7,
            stream: true,
          });

          for await (const chunk of groqStream) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
              sendEvent({ chunk: content });
            }
          }

          sendEvent({ done: true });
          controller.close();
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Stream error";
          sendEvent({ error: errMsg, done: true });
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[AI Memory Suggestions Stream API]", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
