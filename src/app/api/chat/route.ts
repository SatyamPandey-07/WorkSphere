import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import Groq from "groq-sdk";
import { rateLimit, getRateLimitInfo } from "@/lib/rateLimit";
import { triggerBackgroundMemorySync } from "@/lib/backgroundSync";
import { chatRequestSchema, validateRequest } from "@/lib/validations";
import { applyFilters } from "@/lib/filters";
import {
  checkSemanticCache,
  setSemanticCache,
} from "@/lib/cache/semanticCache";
import {
  LLM_MODEL,
  actionAgent,
  contextAgent,
  dataAgent,
  getGroqClient,
  isLlmConfigured,
  isRateLimitError,
  offlineConversationReply,
  orchestratorAgent,
  parseSearchQuery,
  reasoningAgent,
  sanitizeUserInput,
  type RankedVenue,
} from "@/lib/ai/chatAgents";
import { generateGeminiStream, generateGeminiText } from "@/lib/ai/gemini";
import { emitWebhookEvent } from "@/lib/webhooks/deliver";
import {
  deduplicateContext,
  deduplicateVenueResults,
} from "@/lib/context-compression/contextDeduplicator";
import { compressContext } from "@/lib/context-compression/contextCompressor";

export const maxDuration = 60;

const MAX_HISTORY_MESSAGES = 12;
const encoder = new TextEncoder();

type ChatMessage = { role: "user" | "assistant"; content: string };

const ALLOWED_UI_COMPONENTS = ["DataTable", "DataChart", "Map"];

/** Drops generative-UI tags that aren't whitelisted or don't carry valid JSON. */
function sanitizeAssistantContent(content: string): string {
  return content.replace(
    /<ui-component\s+name="([^"]+)"\s+props='([^']*)'\s*\/>/g,
    (tag, name, props) => {
      if (!ALLOWED_UI_COMPONENTS.includes(name)) return "";
      try {
        JSON.parse(props.replace(/&quot;/g, '"').replace(/&#x27;/g, "'"));
        return tag;
      } catch {
        return "";
      }
    },
  );
}

/** Rounds coordinates (~1 km) so nearby users share semantic-cache entries. */
function cacheLocationKey(location: { lat: number; lng: number } | null) {
  return location
    ? `${location.lat.toFixed(2)},${location.lng.toFixed(2)}`
    : null;
}

async function persistExchange(
  userId: string | null,
  conversationId: string | null | undefined,
  userMessage: string,
  assistantContent: string,
  agentName: string,
) {
  if (!userId || !conversationId || !assistantContent) return;
  try {
    // Only write into conversations the caller owns.
    const owned = await prisma.conversation.findFirst({
      where: { id: conversationId, userId },
      select: { id: true },
    });
    if (!owned) return;

    await prisma.message.createMany({
      data: [
        { conversationId, role: "user", content: userMessage },
        {
          conversationId,
          role: "assistant",
          content: sanitizeAssistantContent(assistantContent),
          agentName,
        },
      ],
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
    triggerBackgroundMemorySync(conversationId, userId);
  } catch (dbError) {
    console.error("Database save error:", dbError);
  }
}

/**
 * Streams the response in the format the chat client expects:
 * `METADATA:{json}\n\n` followed by `TEXT:<chunk>` frames.
 */
function streamResponse(
  metadata: Record<string, unknown>,
  produceText: (emit: (text: string) => void) => Promise<string>,
  onComplete: (fullText: string) => Promise<void>,
): Response {
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(
        encoder.encode(`METADATA:${JSON.stringify(metadata)}\n\n`),
      );
      let fullText = "";
      try {
        fullText = await produceText((text) => {
          if (text) controller.enqueue(encoder.encode(`TEXT:${text}`));
        });
      } catch (e) {
        console.error("Stream error:", e);
      }
      await onComplete(fullText);
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/** Converts chat turns into one prompt for providers that take plain text. */
function promptFromMessages(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
) {
  const label = { system: "System", user: "User", assistant: "Assistant" };
  return messages.map((m) => `${label[m.role]}: ${m.content}`).join("\n\n");
}

/**
 * Streams Gemini as the secondary provider. When the stream fails before any
 * text was emitted we retry once without streaming so the user still gets an
 * answer instead of a silent empty reply.
 */
async function streamGemini(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  emit: (text: string) => void,
): Promise<string> {
  if (!process.env.GEMINI_API_KEY) return "";

  const prompt = promptFromMessages(messages);
  let full = "";
  try {
    for await (const chunk of generateGeminiStream(prompt)) {
      full += chunk;
      emit(chunk);
    }
    return full;
  } catch (err) {
    console.error("Gemini stream failed:", err);
  }

  // Keep whatever already reached the client instead of re-sending it.
  if (full.trim()) return full;

  try {
    const text = await generateGeminiText(prompt);
    emit(text);
    return text;
  } catch (err) {
    console.error("Gemini fallback generation failed:", err);
    return "";
  }
}

/** Streams Groq first, then Gemini, then the deterministic reply. */
async function streamLlm(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  emit: (text: string) => void,
  fallbackText: string,
): Promise<string> {
  if (isLlmConfigured()) {
    let full = "";
    try {
      const completion = await getGroqClient().chat.completions.create({
        model: LLM_MODEL,
        stream: true,
        temperature: 0.5,
        messages,
      });
      for await (const chunk of completion) {
        const text = chunk.choices[0]?.delta?.content || "";
        if (text) {
          full += text;
          emit(text);
        }
      }
    } catch (err) {
      console.error("Groq stream failed, trying Gemini:", err);
    }

    if (full.trim()) return full;
  }

  const geminiText = await streamGemini(messages, emit);
  if (geminiText.trim()) return geminiText;

  emit(fallbackText);
  return fallbackText;
}

function historyForLlm(messages: ChatMessage[]) {
  return messages.slice(-MAX_HISTORY_MESSAGES).map((m) => ({
    role: m.role,
    content: sanitizeUserInput(m.content),
  }));
}

async function prepareCompressedHistory(
  messages: ChatMessage[],
  userId?: string | null,
): Promise<Array<{ role: "system" | "user" | "assistant"; content: string }>> {
  try {
    const rawMessages = messages.map((m) => ({ role: m.role, content: m.content }));
    const { deduplicated } = await deduplicateContext(rawMessages, userId ?? undefined);
    const { compressed } = await compressContext(deduplicated, userId ?? undefined);

    return compressed.map((m) => ({
      role: (m.role === "system" || m.role === "user" || m.role === "assistant" ? m.role : "assistant") as "system" | "user" | "assistant",
      content: sanitizeUserInput(m.content),
    }));
  } catch (err) {
    console.error("Context compression fallback:", err);
    return historyForLlm(messages);
  }
}

function venueFacts(venues: RankedVenue[]) {
  return venues.slice(0, 8).map((v) => ({
    name: v.name,
    category: v.category,
    score: v.score,
    distanceKm: v.distanceKm,
    address: v.address,
    highlights: v.highlights,
    openingHours: v.openingHours,
  }));
}

// ============================================================
// MAIN API HANDLER
// ============================================================
export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    const forwarded = req.headers.get("x-forwarded-for");
    const identifier = userId || forwarded?.split(",")[0] || "anonymous";

    if (!(await rateLimit(identifier, 10))) {
      const info = await getRateLimitInfo(identifier, 10);
      const retryAfter = info?.resetTime
        ? Math.ceil((info.resetTime - Date.now()) / 1000)
        : 60;
      const resetTimeSec = info?.resetTime
        ? Math.ceil(info.resetTime / 1000)
        : Math.ceil((Date.now() + 60000) / 1000);

      return Response.json(
        {
          error:
            "Rate limit exceeded. Please wait before sending more messages.",
          retryAfter,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfter),
            "X-RateLimit-Reset": String(resetTimeSec),
          },
        },
      );
    }

    const body = await req.json();
    const validation = validateRequest(chatRequestSchema, body);
    if (!validation.success) {
      return Response.json({ error: validation.error }, { status: 400 });
    }

    const { location, conversationId } = validation.data;
    // Clients may only speak as the user or replay assistant turns — never as "system".
    const messages: ChatMessage[] = validation.data.messages
      .filter(
        (m): m is ChatMessage => m.role === "user" || m.role === "assistant",
      )
      .map((m) => ({ role: m.role, content: m.content }));
    const filters =
      body.filters && typeof body.filters === "object"
        ? body.filters
        : undefined;

    const validLocation =
      location &&
      typeof location.lat === "number" &&
      typeof location.lng === "number"
        ? location
        : null;

    const userMessage =
      messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
    if (!userMessage.trim()) {
      return Response.json(
        { error: "messages must include a user message" },
        { status: 400 },
      );
    }

    const agentSteps: Array<Record<string, unknown>> = [];
    const step = async <T>(
      agent: string,
      run: () => Promise<T> | T,
      summarize?: (r: T) => unknown,
    ) => {
      const start = Date.now();
      const result = await run();
      agentSteps.push({
        agent,
        result: summarize ? summarize(result) : result,
        timestamp: Date.now(),
        latencyMs: Date.now() - start,
      });
      return result;
    };

    // ====== STEP 1: ORCHESTRATOR ======
    const decision = await step("Orchestrator", () =>
      orchestratorAgent(userMessage, { hasLocation: Boolean(validLocation) }),
    );

    // ====== GENERAL CONVERSATION ======
    if (decision.skipAgents) {
      const fallback = offlineConversationReply(userMessage);
      const compressedHistory = await prepareCompressedHistory(messages, userId);
      return streamResponse(
        {
          venues: [],
          agentSteps,
          cached: false,
          suggestions: [
            "Quiet cafe near me",
            "Coworking space within 3 km",
            "Library with outlets",
          ],
          complexity: decision.complexity,
        },
        (emit) =>
          streamLlm(
            [
              {
                role: "system",
                content:
                  "You are WorkSphere's assistant. WorkSphere helps people find cafes, coworking spaces and libraries to work from, and book a spot. Be friendly and brief (2–4 sentences). If the user wants a workspace, ask what area and what they need (Wi-Fi, quiet, outlets, calls). Never invent specific venues.",
              },
              ...compressedHistory,
            ],
            emit,
            fallback,
          ),
        (full) =>
          persistExchange(
            userId,
            conversationId,
            userMessage,
            full,
            "GeneralChat",
          ),
      );
    }

    // ====== SEARCH ======
    if (!validLocation) {
      const text =
        "I need your location to find nearby workspaces. Allow location access in your browser, or move the map to the area you want to search.";
      return streamResponse(
        {
          venues: [],
          agentSteps,
          cached: false,
          suggestions: [],
          complexity: decision.complexity,
        },
        async (emit) => {
          emit(text);
          return text;
        },
        (full) =>
          persistExchange(
            userId,
            conversationId,
            userMessage,
            full,
            "ActionAgent",
          ),
      );
    }

    const cacheKey = cacheLocationKey(validLocation);
    const useCache =
      decision.complexity === "complex" &&
      !filters &&
      Boolean(process.env.COHERE_API_KEY);
    let rankedVenues: RankedVenue[] | null = null;
    let isCached = false;
    let highTraffic = false;
    let parameters = {
      ...parseSearchQuery(userMessage).parameters,
      ...(decision.parameters ?? {}),
    };

    if (useCache) {
      const cached = await checkSemanticCache(userMessage, cacheKey);
      if (cached?.rankedVenues) {
        isCached = true;
        rankedVenues = cached.rankedVenues;
        agentSteps.push({
          agent: "Cache",
          result: { hit: true, venues: rankedVenues?.length ?? 0 },
          timestamp: Date.now(),
          latencyMs: 0,
        });
      }
    }

    if (!rankedVenues) {
      // ====== STEP 2: CONTEXT ======
      if (decision.complexity === "complex") {
        const context = await step("Context", () =>
          contextAgent(userMessage, validLocation, userId),
        );
        parameters = { ...parameters, ...context.parameters };
      } else {
        agentSteps.push({
          agent: "Context",
          result: { skipped: true, parameters },
          timestamp: Date.now(),
          latencyMs: 0,
        });
      }

      // ====== STEP 3: DATA ======
      const data = await step(
        "Data",
        () => dataAgent({ ...parameters, location: validLocation }, filters),
        (r) => ({
          venueCount: r.venues.length,
          meta: r.meta,
          reasoning: r.reasoning,
        }),
      );
      highTraffic = Boolean(data.meta.highTraffic);

      // ====== STEP 4: REASONING ======
      const reasoning = await step(
        "Reasoning",
        () =>
          reasoningAgent(
            filters ? applyFilters(data.venues, filters) : data.venues,
            parameters,
          ),
        (r) => ({
          summary: r.summary,
          reasoning: r.reasoning,
          topVenues: r.rankedVenues
            .slice(0, 3)
            .map((v) => ({ name: v.name, score: v.score })),
        }),
      );
      rankedVenues = reasoning.rankedVenues;

      if (useCache && rankedVenues.length > 0) {
        await setSemanticCache(userMessage, cacheKey, { rankedVenues });
      }
    }

    // ====== STEP 5: ACTION ======
    const venues = rankedVenues ?? [];
    const action = await step(
      "Action",
      () =>
        actionAgent(venues, userMessage, {
          highTraffic,
          radius: parameters.radius,
        }),
      (r) => ({
        markerCount: r.mapUpdates.markers.length,
        suggestions: r.suggestions,
      }),
    );

    if (userId) {
      emitWebhookEvent(userId, "AI_WORKFLOW_COMPLETED", {
        query: userMessage.slice(0, 500),
        parameters: {
          workType: parameters.workType,
          categories: parameters.category,
          amenities: parameters.amenities,
          radiusMeters: parameters.radius,
        },
        resultCount: venues.length,
        topVenues: venues
          .slice(0, 5)
          .map((v) => ({ id: v.id, name: v.name, score: v.score })),
        cached: isCached,
      });
    }

    // Deduplicate repetitive venue query results before passing context to Groq LLM
    const { deduplicated: dedupedVenues } = deduplicateVenueResults(venues, {
      existingHistory: messages,
    });
    const compressedHistory = await prepareCompressedHistory(messages, userId);

    const llmMessages =
      dedupedVenues.length > 0
        ? [
            {
              role: "system" as const,
              content: `You are WorkSphere's assistant. The user asked for a place to work. These venues were found and ranked (best first); the map already shows them:
${JSON.stringify(venueFacts(dedupedVenues))}
Reply in 2–5 short sentences or a brief list: recommend the best 2–3 for the user's needs and say why using only the facts above. Never invent venues, prices, ratings or amenities. Mention that they can tap a pin for details, directions or booking.`,
            },
            ...compressedHistory,
          ]
        : null;

    return streamResponse(
      {
        venues,
        mapUpdates: action.mapUpdates,
        suggestions: action.suggestions,
        agentSteps,
        cached: isCached,
        complexity: decision.complexity,
        highTraffic,
      },
      async (emit) => {
        if (!llmMessages) {
          emit(action.message);
          return action.message;
        }
        return streamLlm(llmMessages, emit, action.message);
      },
      (full) =>
        persistExchange(
          userId,
          conversationId,
          userMessage,
          full,
          "ActionAgent",
        ),
    );
  } catch (error) {
    console.error("Chat API error:", error);
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred";

    if (isRateLimitError(error) || error instanceof Groq.RateLimitError) {
      let retryAfter = 60;
      const err = error as any;
      if (typeof err?.retryAfter === "number" && err.retryAfter > 0) {
        retryAfter = err.retryAfter;
      } else {
        const headers = err?.headers || err?.response?.headers;
        let rawHeader: unknown = null;
        if (headers) {
          if (typeof headers.get === "function") {
            try {
              rawHeader =
                headers.get("retry-after") ??
                headers.get("x-ratelimit-reset-requests") ??
                headers.get("x-ratelimit-reset-tokens");
            } catch {
              // ignore
            }
          }
          if (!rawHeader && typeof headers === "object") {
            rawHeader =
              headers["retry-after"] ??
              headers["Retry-After"] ??
              headers["x-ratelimit-reset-requests"] ??
              headers["x-ratelimit-reset-tokens"];
          }
        }
        const parsed =
          rawHeader != null ? parseInt(String(rawHeader), 10) : NaN;
        if (!isNaN(parsed) && parsed > 0) {
          retryAfter = parsed;
        } else {
          const match =
            message.match(/try again in ([0-9.]+)\s*s/i) ||
            message.match(/retry after ([0-9.]+)/i);
          if (match?.[1])
            retryAfter = Math.ceil(parseFloat(match[1])) || retryAfter;
        }
      }

      return Response.json(
        {
          error: "Groq AI rate limit exceeded. Please try again shortly.",
          retryAfter,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfter),
            "X-RateLimit-Reset": String(
              Math.ceil(Date.now() / 1000) + retryAfter,
            ),
          },
        },
      );
    }

    if (
      message.includes("SCRAM") ||
      message.includes("DATABASE_URL") ||
      message.includes("Prisma")
    ) {
      return Response.json(
        {
          error:
            "Database is not configured correctly. Please verify your DATABASE_URL.",
        },
        { status: 503 },
      );
    }

    return Response.json(
      { error: "An unexpected server error occurred. Please try again later." },
      { status: 500 },
    );
  }
}
