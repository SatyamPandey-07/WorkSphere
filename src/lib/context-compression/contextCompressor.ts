import { CompressedContext, ContextChunk } from "@/lib/hnsw/types";
import { HNSWIndex } from "@/lib/hnsw/hnsw";
import { generateEmbedding } from "@/lib/cache/semanticCache";
import Groq from "groq-sdk";

function getGroqClient(): any {
  const GroqCtor = (Groq as any)?.Groq || Groq;
  try {
    return new GroqCtor({
      apiKey: process.env.GROQ_API_KEY || "dummy-key-for-build",
    });
  } catch {
    return null;
  }
}

const MAX_TOKENS_PER_COMPRESSED = 500;
const _MAX_MESSAGES_PER_COMPRESSED = 20;
const SIMILARITY_THRESHOLD = 0.82;

const hnswIndexes = new Map<string, HNSWIndex>();

export function getOrCreateIndex(userId: string): HNSWIndex {
  if (!hnswIndexes.has(userId)) {
    hnswIndexes.set(userId, new HNSWIndex({ dim: 1024 }));
  }
  return hnswIndexes.get(userId)!;
}

export function clearIndexes(): void {
  hnswIndexes.clear();
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface ExtractedParameters {
  workType?: string;
  category?: string[];
  amenities?: string[];
  location?: string;
  radius?: number;
  constraints?: string[];
  decisions?: string[];
}

export interface CompressContextOptions {
  maxTokens?: number;
  recentTurnsToKeep?: number; // default: 4 messages (2 user + 2 assistant)
  thresholdTokens?: number; // default: 400 tokens
}

export interface CompressContextResult {
  compressed: Array<{ role: string; content: string }>;
  originalTokens: number;
  compressedTokens: number;
  savedTokens: number;
  reductionPercentage: number;
  extractedParameters: ExtractedParameters;
  summary?: string;
}

/**
 * Extracts key user intent and parameters (amenities, work type, location, constraints, decisions)
 * from conversation messages so they can be explicitly preserved across compression.
 */
export function extractIntentParameters(
  messages: Array<{ role: string; content: string }>,
): ExtractedParameters {
  const params: ExtractedParameters = {
    category: [],
    amenities: [],
    constraints: [],
    decisions: [],
  };

  const fullText = messages.map((m) => m.content).join(" ");
  const lower = fullText.toLowerCase();

  // 1. Work Type
  if (/\b(call|calls|zoom|phone|meeting|interview)\b/i.test(lower)) {
    params.workType = "calls";
  } else if (/\b(focus|deep work|quiet work|study|studying|exam)\b/i.test(lower)) {
    params.workType = "focus";
  } else if (/\b(team|group|collaborat\w+|co-working)\b/i.test(lower)) {
    params.workType = "team";
  } else if (/\b(casual|reading|browse|light work)\b/i.test(lower)) {
    params.workType = "casual";
  }

  // 2. Categories
  const categories = new Set<string>();
  if (/\b(cafe|cafes|coffee shop|coffee)\b/i.test(lower)) categories.add("cafe");
  if (/\b(coworking|co-working|shared office|hot desk)\b/i.test(lower)) categories.add("coworking");
  if (/\b(library|libraries|public library)\b/i.test(lower)) categories.add("library");
  params.category = Array.from(categories);

  // 3. Amenities
  const amenities = new Set<string>();
  if (/\b(wifi|wi-fi|internet|fast connection)\b/i.test(lower)) amenities.add("wifi");
  if (/\b(outlet|outlets|power|plug|charging)\b/i.test(lower)) amenities.add("outlets");
  if (/\b(quiet|silent|low noise|calm)\b/i.test(lower)) amenities.add("quiet");
  if (/\b(ergonomic|chair|ergonomic seat|standing desk)\b/i.test(lower)) amenities.add("ergonomic");
  if (/\b(phone booth|call booth|private booth)\b/i.test(lower)) amenities.add("phoneBooths");
  if (/\b(24\/7|late night|open late)\b/i.test(lower)) amenities.add("24/7");
  params.amenities = Array.from(amenities);

  // 4. Location & Radius
  const radiusMatch = lower.match(/(?:within|in|radius of)\s*(\d+(?:\.\d+)?)\s*(km|kilometer|kilometers|m|meter|meters|mile|miles)/i);
  if (radiusMatch) {
    const val = parseFloat(radiusMatch[1]);
    const unit = radiusMatch[2].toLowerCase();
    if (unit.startsWith("k") || unit.startsWith("mile")) {
      params.radius = Math.round(val * 1000);
    } else {
      params.radius = Math.round(val);
    }
  }

  const locMatch = fullText.match(/(?:in|near|around|at)\s+([A-Z][a-zA-Z\s]+?)(?:,|\.|\bwith\b|\bfor\b|\bwithin\b|$)/);
  if (locMatch && locMatch[1].trim().length > 2) {
    params.location = locMatch[1].trim();
  }

  // 5. Constraints & Decisions
  for (const msg of messages) {
    const decisionMatch = msg.content.match(/\b(booked [^,.]*|reserved [^,.]*|selected [^,.]*)/i);
    if (decisionMatch) {
      params.decisions?.push(decisionMatch[0].trim());
    }
    const constraintMatch = msg.content.match(/\b(under \$\d+|budget[^,.]*|free[^,.]*|strict[^,.]*|must have[^,.]*)/i);
    if (constraintMatch) {
      params.constraints?.push(constraintMatch[0].trim());
    }
  }

  return params;
}

function buildDeterministicSummary(
  turns: Array<{ role: string; content: string }>,
  params: ExtractedParameters,
): string {
  const elements: string[] = [];
  if (params.workType) elements.push(`Work: ${params.workType}`);
  if (params.category && params.category.length > 0) elements.push(`Type: ${params.category.join(", ")}`);
  if (params.amenities && params.amenities.length > 0) elements.push(`Amenities: ${params.amenities.join(", ")}`);
  if (params.location) elements.push(`Location: ${params.location}${params.radius ? ` (${params.radius}m)` : ""}`);
  if (params.constraints && params.constraints.length > 0) elements.push(`Constraints: ${params.constraints.slice(0, 2).join("; ")}`);
  if (params.decisions && params.decisions.length > 0) elements.push(`Decisions: ${params.decisions.slice(0, 2).join("; ")}`);

  if (elements.length > 0) {
    return `Prior Context: ${elements.join(" | ")}`;
  }
  return "Prior Context: User explored workspace options.";
}

async function compressOlderTurnsWithLLM(
  olderTurns: Array<{ role: string; content: string }>,
  params: ExtractedParameters,
): Promise<string> {
  const transcript = olderTurns.map((c) => `${c.role}: ${c.content}`).join("\n");

  try {
    const client = getGroqClient();
    if (!client) throw new Error("Groq client not available");
    const completion = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `You are a Context Compression Engine. Compress the following earlier conversation turns into a high-density summary (under 100 words).
You MUST explicitly preserve:
1. User Intent and search goals
2. Extracted Parameters:
   - Work type: ${params.workType || "unspecified"}
   - Categories: ${params.category?.join(", ") || "unspecified"}
   - Amenities: ${params.amenities?.join(", ") || "unspecified"}
   - Location/Radius: ${params.location || "unspecified"}
3. Any confirmed decisions or user feedback
Output ONLY the structured summary.`,
        },
        {
          role: "user",
          content: `<transcript>\n${transcript}\n</transcript>`,
        },
      ],
      temperature: 0.1,
      max_tokens: 200,
    });

    const content = completion.choices[0]?.message?.content?.trim();
    if (content) return content;
  } catch {
    // Graceful fallback if Groq API call fails or is mocked
  }

  return buildDeterministicSummary(olderTurns, params);
}

/**
 * Public high-level context compression API matching docs/CONTEXT_COMPRESSION.md
 * Summarizes older conversation turns while preserving key user intent and extracted parameters.
 * Reduces prompt token count by >= 50% for extended conversation sessions.
 */
export async function compressContext(
  messages: Array<{ role: string; content: string }>,
  userId?: string,
  options?: CompressContextOptions,
): Promise<CompressContextResult> {
  const originalTokens = messages.reduce((s, m) => s + estimateTokens(m.content), 0);
  const extractedParameters = extractIntentParameters(messages);

  const recentCount = options?.recentTurnsToKeep ?? 4;
  const thresholdTokens = options?.thresholdTokens ?? 400;

  // If the conversation is short, keep as is
  if (messages.length <= recentCount || originalTokens <= thresholdTokens) {
    return {
      compressed: messages,
      originalTokens,
      compressedTokens: originalTokens,
      savedTokens: 0,
      reductionPercentage: 0,
      extractedParameters,
    };
  }

  // Split into older turns to compress and recent turns to preserve verbatim
  const recentTurns = messages.slice(-recentCount);
  const olderTurns = messages.slice(0, messages.length - recentCount);

  // Compress older turns preserving user intent & parameters
  const summaryText = await compressOlderTurnsWithLLM(olderTurns, extractedParameters);

  const summaryMessage = {
    role: "system" as const,
    content: `[PRIOR CONTEXT & PARAMETERS]\n${summaryText}`,
  };

  const compressed = [summaryMessage, ...recentTurns];
  const compressedTokens = compressed.reduce((s, m) => s + estimateTokens(m.content), 0);
  const savedTokens = Math.max(0, originalTokens - compressedTokens);
  const reductionPercentage = Math.round((savedTokens / originalTokens) * 100);

  // Index the compressed summary into the user's HNSW vector index
  if (userId) {
    try {
      const embedding = await generateEmbedding(summaryText);
      const index = getOrCreateIndex(userId);
      index.insert(`ctx_${Date.now()}_${Math.random().toString(36).slice(2)}`, embedding);
    } catch {
      // Ignore indexing failure
    }
  }

  return {
    compressed,
    originalTokens,
    compressedTokens,
    savedTokens,
    reductionPercentage,
    extractedParameters,
    summary: summaryText,
  };
}

async function compressWithLLM(chunks: ContextChunk[]): Promise<string> {
  const transcript = chunks.map((c) => `${c.role}: ${c.content}`).join("\n");

  const client = getGroqClient();
  if (!client) return "No summary generated.";

  const completion = await client.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: `You are a Context Compression Agent. Compress the following conversation transcript into a concise summary (under 100 words) that preserves:
1. The user's stated preferences and requirements
2. Key constraints (location, time, amenities)
3. Any decisions or actions taken
4. The overall context of the conversation

Output ONLY the compressed summary, no additional text.`,
      },
      {
        role: "user",
        content: `<transcript>\n${transcript}\n</transcript>`,
      },
    ],
    temperature: 0.1,
    max_tokens: 200,
  });

  return (
    completion.choices[0]?.message?.content?.trim() || "No summary generated."
  );
}

export async function compressConversationChunk(
  userId: string,
  conversationId: string,
  messages: { role: string; content: string }[],
): Promise<CompressedContext> {
  const chunks: ContextChunk[] = [];
  let currentBatch: ContextChunk[] = [];
  let currentTokens = 0;

  try {
    for (const msg of messages) {
      const tokenCount = estimateTokens(msg.content);
      const chunk: ContextChunk = {
        role: msg.role,
        content: msg.content,
        tokenCount,
      };

      if (
        currentTokens + tokenCount > MAX_TOKENS_PER_COMPRESSED &&
        currentBatch.length > 0
      ) {
        // Original behavior: the boundary-crossing chunk is added to the current
        // batch before it is summarized, exactly as in the pre-fix code.
        currentBatch.push(chunk);

        // Capture batch token count (pre-overflow, matching original chunks.push below)
        const batchTokenCount = currentTokens;

        // Move the batch reference out and reset state immediately so the array
        // becomes eligible for GC as soon as the LLM call finishes.
        let batchRef: ContextChunk[] | null = currentBatch;
        currentBatch = [];
        currentTokens = 0;

        let summary: string;
        try {
          summary = await compressWithLLM(batchRef);
        } finally {
          // Release batch data immediately after the LLM call (success or error).
          batchRef.length = 0;
          batchRef = null;
        }

        const embedding = await generateEmbedding(summary);

        // Preserve original semantics: spread chunk (role/content from the overflow
        // chunk) and use the pre-overflow accumulated token count.
        chunks.push({
          ...chunk,
          embedding,
          tokenCount: batchTokenCount,
        });
      } else {
        currentBatch.push(chunk);
        currentTokens += tokenCount;
      }
    }

    if (currentBatch.length > 0) {
      // Capture the trailing batch's token count before resetting state,
      // matching the original behaviour where tokenCount: currentTokens
      // was read before any reset occurred.
      const trailingBatchTokenCount = currentTokens;

      let batchRef: ContextChunk[] | null = currentBatch;
      currentBatch = [];
      currentTokens = 0;

      let summary: string;
      try {
        summary = await compressWithLLM(batchRef);
      } finally {
        batchRef.length = 0;
        batchRef = null;
      }

      const embedding = await generateEmbedding(summary);

      chunks.push({
        role: "assistant",
        content: summary,
        tokenCount: trailingBatchTokenCount,
        embedding,
      });
    }

    const fullSummary = await compressWithLLM(
      chunks.map((c) => ({
        role: c.role,
        content: c.content,
        tokenCount: c.tokenCount,
      })),
    );

    // Release intermediate chunk content and embeddings immediately after they have
    // been used by compressWithLLM above and before the final embedding is generated.
    for (const c of chunks) {
      c.embedding = undefined;
      c.content = "";
    }
    chunks.length = 0;

    const fullEmbedding = await generateEmbedding(fullSummary);

    const compressed: CompressedContext = {
      id: `${conversationId}-${Date.now()}`,
      summary: fullSummary,
      userId,
      conversationId,
      embedding: fullEmbedding,
      tokenCount: estimateTokens(fullSummary),
      createdAt: Date.now(),
      messageCount: messages.length,
    };

    const index = getOrCreateIndex(userId);
    index.insert(compressed.id, fullEmbedding);

    return compressed;
  } finally {
    // Guarantee cleanup even on error paths — does not swallow any thrown error.
    if (currentBatch.length > 0) {
      currentBatch.length = 0;
    }
    for (const c of chunks) {
      c.embedding = undefined;
      c.content = "";
    }
    chunks.length = 0;
  }
}

export async function retrieveRelevantContext(
  userId: string,
  query: string,
  topK: number = 5,
): Promise<CompressedContext[]> {
  const queryEmbedding = await generateEmbedding(query);
  const index = getOrCreateIndex(userId);

  const results = index.search(queryEmbedding, topK);

  return results.map((r) => {
    const node = index.getNode(r.id);
    return {
      id: r.id,
      summary: "",
      userId,
      conversationId: "",
      embedding: node?.vector || [],
      tokenCount: 0,
      createdAt: 0,
      messageCount: 0,
      _distance: r.distance,
    } as CompressedContext & { _distance: number };
  });
}

export function getCompressedContextString(
  contexts: CompressedContext[],
  threshold: number = SIMILARITY_THRESHOLD,
): string {
  const relevant = contexts.filter((ctx) => {
    const dist = (ctx as any)._distance;
    return dist !== undefined ? dist < 1 - threshold : true;
  });

  if (relevant.length === 0) return "";

  const summaryLines = relevant.map(
    (ctx, i) =>
      `[Past Context ${i + 1}] (${ctx.messageCount || "?"} messages, ${ctx.tokenCount || "?"} tokens): ${ctx.summary}`,
  );

  return `\n\nCOMPRESSED HISTORICAL CONTEXT:\n${summaryLines.join("\n")}`;
}

export async function compressFullConversation(
  messages: { role: string; content: string }[],
  maxTokens: number = 3000,
): Promise<{ compressed: string; saved: number }> {
  const totalTokens = messages.reduce(
    (sum, m) => sum + estimateTokens(m.content),
    0,
  );
  const fullText = messages.map((m) => `${m.role}: ${m.content}`).join("\n");

  if (totalTokens <= maxTokens) {
    return { compressed: fullText, saved: 0 };
  }

  const client = getGroqClient();
  if (!client) return { compressed: fullText, saved: 0 };

  const completion = await client.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: `Compress the following conversation to fit within ${maxTokens} tokens while preserving all critical context: user preferences, constraints, decisions, and the current intent. Prioritize recent messages. Output the compressed conversation with speaker labels.`,
      },
      {
        role: "user",
        content: `<conversation>\n${fullText}\n</conversation>`,
      },
    ],
    temperature: 0.1,
    max_tokens: Math.min(maxTokens, 2048),
  });

  const compressed =
    completion.choices[0]?.message?.content?.trim() || fullText;
  const compressedTokens = estimateTokens(compressed);
  const saved = totalTokens - compressedTokens;

  return { compressed, saved };
}

export { HNSWIndex };
