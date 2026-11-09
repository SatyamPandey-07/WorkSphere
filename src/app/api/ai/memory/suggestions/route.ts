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

function isAbortOrDisconnectError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (!err) return false;
  if (typeof err === "object") {
    const error = err as Record<string, unknown>;
    const name = String(error.name || "");
    const code = String(error.code || "");
    const message = String(error.message || "").toLowerCase();

    if (
      name === "AbortError" ||
      code === "ABORT_ERR" ||
      code === "ECONNRESET" ||
      code === "ERR_STREAM_PREMATURE_CLOSE" ||
      message.includes("abort") ||
      message.includes("aborted") ||
      message.includes("closed") ||
      message.includes("cancel") ||
      message.includes("connection reset")
    ) {
      return true;
    }
  }
  return false;
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

    // Create ReadableStream for SSE with robust abort & disconnect handling
    const stream = new ReadableStream({
      async start(controller) {
        let isClosed = false;
        let isAborted = req.signal.aborted;

        const onAbort = () => {
          isAborted = true;
          isClosed = true;
        };

        if (req.signal) {
          req.signal.addEventListener("abort", onAbort, { once: true });
        }

        const encoder = new TextEncoder();

        const sendEvent = (data: Record<string, unknown>) => {
          if (isClosed || isAborted || req.signal.aborted) return;
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
            );
          } catch {
            isClosed = true;
          }
        };

        const safeClose = () => {
          if (isClosed) return;
          isClosed = true;
          try {
            controller.close();
          } catch {
            // Already closed or controller cancelled
          }
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
              if (isAborted || req.signal.aborted) break;
              sendEvent({ chunk });
              // Small delay simulation
              await new Promise((r) => setTimeout(r, 20));
            }

            if (!isAborted && !req.signal.aborted) {
              sendEvent({ done: true });
            }
            safeClose();
            return;
          }

          if (isAborted || req.signal.aborted) {
            safeClose();
            return;
          }

          const groq = getGroq();
          const groqStream = await groq.chat.completions.create(
            {
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
            },
            { signal: req.signal },
          );

          for await (const chunk of groqStream) {
            if (isAborted || req.signal.aborted) break;
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
              sendEvent({ chunk: content });
            }
          }

          if (!isAborted && !req.signal.aborted) {
            sendEvent({ done: true });
          }
          safeClose();
        } catch (err: unknown) {
          if (!isAbortOrDisconnectError(err, req.signal)) {
            const errMsg =
              err instanceof Error ? err.message : "Stream error";
            sendEvent({ error: errMsg, done: true });
          }
          safeClose();
        } finally {
          if (req.signal) {
            req.signal.removeEventListener("abort", onAbort);
          }
        }
      },
      cancel() {
        // Stream cancelled on client disconnect
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error: unknown) {
    if (isAbortOrDisconnectError(error, req.signal)) {
      return new NextResponse(null, { status: 499 });
    }
    console.error("[AI Memory Suggestions Stream API]", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
