import { generateEmbedding } from "@/lib/cache/semanticCache";
import { HNSWIndex } from "@/lib/hnsw/hnsw";

interface DedupResult {
  deduplicated: { role: string; content: string }[];
  removedCount: number;
  savings: number;
}

const SEMANTIC_SIMILARITY_THRESHOLD = 0.88;
const EXACT_MATCH_THRESHOLD = 0.95;

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const promptPatterns = [
  /^system:?\s*you are/i,
  /^system:?\s*your task/i,
  /^system:?\s*you are an/i,
  /^system:?\s*act as/i,
  /^system:?\s*role:/i,
  /instruct:?\s*/i,
  /<s>/i,
  /\[INST\].*\[\/INST\]/s,
  /^###\s*(system|instruction|user):/im,
];

function isPromptTemplate(content: string): boolean {
  return promptPatterns.some((p) => p.test(content));
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, "").trim();
}

export class ContextDeduplicator {
  private index: HNSWIndex;
  private seenHashes: Set<string> = new Set();
  private recentContents: string[] = [];

  constructor() {
    this.index = new HNSWIndex({ dim: 1024 });
  }

  private contentHash(content: string): string {
    const normalized = normalizeText(content);
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `hash_${Math.abs(hash)}`;
  }

  private isExactDuplicate(content: string): boolean {
    const hash = this.contentHash(content);
    if (this.seenHashes.has(hash)) return true;
    this.seenHashes.add(hash);
    return false;
  }

  private async isSemanticDuplicate(
    content: string,
  ): Promise<{ isDuplicate: boolean; similarTo?: string }> {
    try {
      const embedding = await generateEmbedding(content);
      const results = this.index.search(embedding, 1);

      if (results.length > 0 && results[0].distance < 1 - SEMANTIC_SIMILARITY_THRESHOLD) {
        const node = this.index.getNode(results[0].id);
        return {
          isDuplicate: true,
          similarTo: node?.id,
        };
      }

      this.index.insert(`dedup_${Date.now()}_${Math.random().toString(36).slice(2)}`, embedding);
      return { isDuplicate: false };
    } catch {
      const normalized = normalizeText(content);
      const similar = this.recentContents.find(
        (rc) => {
          const sim = this.jaccardSimilarity(normalized, normalizeText(rc));
          return sim > EXACT_MATCH_THRESHOLD;
        },
      );

      if (similar) {
        return { isDuplicate: true, similarTo: similar.slice(0, 50) };
      }

      this.recentContents.push(content);
      if (this.recentContents.length > 50) {
        this.recentContents.shift();
      }

      return { isDuplicate: false };
    }
  }

  private jaccardSimilarity(a: string, b: string): number {
    const setA = new Set(a.split(/\s+/));
    const setB = new Set(b.split(/\s+/));
    const intersection = new Set([...setA].filter((x) => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    if (union.size === 0) return 1;
    return intersection.size / union.size;
  }

  async deduplicateMessages(
    messages: { role: string; content: string }[],
  ): Promise<DedupResult> {
    this.seenHashes.clear();
    this.recentContents = [];

    const deduplicated: { role: string; content: string }[] = [];
    let removedCount = 0;

    for (const msg of messages) {
      if (isPromptTemplate(msg.content)) {
        if (deduplicated.length > 0 && deduplicated[deduplicated.length - 1].role === msg.role) {
          const lastSame = deduplicated
            .filter((m) => m.role === msg.role)
            .pop();
          if (lastSame && isPromptTemplate(lastSame.content)) {
            removedCount++;
            continue;
          }
        }
        deduplicated.push(msg);
        continue;
      }

      if (this.isExactDuplicate(msg.content)) {
        removedCount++;
        continue;
      }

      const semDup = await this.isSemanticDuplicate(msg.content);
      if (semDup.isDuplicate) {
        removedCount++;
        continue;
      }

      deduplicated.push(msg);
    }

    const originalTokens = messages.reduce(
      (sum, m) => sum + estimateTokens(m.content),
      0,
    );
    const dedupTokens = deduplicated.reduce(
      (sum, m) => sum + estimateTokens(m.content),
      0,
    );

    return {
      deduplicated,
      removedCount,
      savings: originalTokens - dedupTokens,
    };
  }

  async deduplicateContextWindow(
    messages: { role: string; content: string }[],
    windowSize: number = 50,
  ): Promise<{ role: string; content: string }[]> {
    if (messages.length <= windowSize) {
      const result = await this.deduplicateMessages(messages);
      return result.deduplicated;
    }

    const recentMessages = messages.slice(-windowSize);
    const result = await this.deduplicateMessages(recentMessages);

    const olderSummary = messages.slice(0, -windowSize);
    const uniqueOlder: { role: string; content: string }[] = [];

    this.seenHashes.clear();
    this.recentContents = [];

    for (const msg of olderSummary) {
      const hash = this.contentHash(msg.content);
      if (!this.seenHashes.has(hash)) {
        this.seenHashes.add(hash);
        uniqueOlder.push(msg);
      }
    }

    return [...uniqueOlder, ...result.deduplicated];
  }

  clear(): void {
    this.index.clear();
    this.seenHashes.clear();
    this.recentContents = [];
  }
}

export async function deduplicatePromptHistory(
  messages: { role: string; content: string }[],
): Promise<{ role: string; content: string }[]> {
  const deduplicator = new ContextDeduplicator();
  const result = await deduplicator.deduplicateContextWindow(messages);
  return result;
}
