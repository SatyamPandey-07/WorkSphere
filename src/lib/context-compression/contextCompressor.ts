import { CompressedContext, ContextChunk } from "@/lib/hnsw/types";
import { HNSWIndex } from "@/lib/hnsw/hnsw";
import { generateEmbedding } from "@/lib/cache/semanticCache";
import { Groq } from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "dummy-key-for-build",
});

const MAX_TOKENS_PER_COMPRESSED = 500;
const MAX_MESSAGES_PER_COMPRESSED = 20;
const SIMILARITY_THRESHOLD = 0.82;

const hnswIndexes = new Map<string, HNSWIndex>();

function getOrCreateIndex(userId: string): HNSWIndex {
  if (!hnswIndexes.has(userId)) {
    hnswIndexes.set(userId, new HNSWIndex({ dim: 1024 }));
  }
  return hnswIndexes.get(userId)!;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function compressWithLLM(chunks: ContextChunk[]): Promise<string> {
  const transcript = chunks
    .map((c) => `${c.role}: ${c.content}`)
    .join("\n");

  const completion = await groq.chat.completions.create({
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
    completion.choices[0]?.message?.content?.trim() ||
    "No summary generated."
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

  for (const msg of messages) {
    const tokenCount = estimateTokens(msg.content);
    const chunk: ContextChunk = {
      role: msg.role,
      content: msg.content,
      tokenCount,
    };

    if (currentTokens + tokenCount > MAX_TOKENS_PER_COMPRESSED && currentBatch.length > 0) {
      currentBatch.push(chunk);
      const summary = await compressWithLLM(currentBatch);
      const embedding = await generateEmbedding(summary);

      chunks.push({
        ...chunk,
        embedding,
        tokenCount: currentTokens,
      });

      currentBatch = [];
      currentTokens = 0;
    } else {
      currentBatch.push(chunk);
      currentTokens += tokenCount;
    }
  }

  if (currentBatch.length > 0) {
    const summary = await compressWithLLM(currentBatch);
    const embedding = await generateEmbedding(summary);

    chunks.push({
      role: "assistant",
      content: summary,
      tokenCount: currentTokens,
      embedding,
    });
  }

  const fullSummary = await compressWithLLM(
    chunks.map((c) => ({ role: c.role, content: c.content })),
  );
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

  const completion = await groq.chat.completions.create({
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
