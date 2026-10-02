# AI Context Compression & Token Deduplication Engine

This document covers the context compression and deduplication utilities used by the
WorkSphere AI chat handler to keep LLM prompt token costs under control in long
sessions.

---

## Problem

LLM APIs charge per token. As a conversation grows, the full message history sent on
each turn grows proportionally. A 200-turn session can exceed 32k tokens before the
user has received a single venue recommendation.

WorkSphere solves this with a two-stage pipeline:

```
Raw conversation history
       │
       ▼
1. Deduplication  ← contextDeduplicator.ts
   Remove near-duplicate messages (cosine similarity > 0.82)
       │
       ▼
2. Compression    ← contextCompressor.ts
   LLM-summarise chunks that exceed token budget
       │
       ▼
Compressed context (~200–500 tokens)
```

---

## Files

| File | Role |
|------|------|
| `src/lib/context-compression/contextCompressor.ts` | Main compression pipeline |
| `src/lib/context-compression/contextDeduplicator.ts` | Embedding-based deduplication |
| `src/lib/hnsw/hnsw.ts` | In-memory HNSW vector index |
| `src/lib/cache/semanticCache.ts` | `generateEmbedding()` via Cohere API |

---

## Stage 1 — Deduplication (`contextDeduplicator.ts`)

### How it works

1. Each message is embedded using `generateEmbedding(content)` (Cohere `embed-english-v3.0`).
2. Embeddings are inserted into a per-user **HNSW index** for fast approximate nearest-neighbour search.
3. If a new message's embedding has cosine similarity > `SIMILARITY_THRESHOLD` (0.82) to an existing message, it is flagged as a duplicate and removed from the context.

### Configuration

```typescript
const SIMILARITY_THRESHOLD = 0.82; // lower = more aggressive deduplication
```

### API

```typescript
import { deduplicateContext } from "@/lib/context-compression/contextDeduplicator";

const { deduplicated, removedCount } = await deduplicateContext(
  messages,           // Array<{ role: string; content: string }>
  userId,             // used to key the HNSW index per user
);
```

---

## Stage 2 — Compression (`contextCompressor.ts`)

### How it works

1. The deduped messages are chunked into groups.
2. If a chunk's estimated token count exceeds `MAX_TOKENS_PER_COMPRESSED` (500), it is sent to the Groq LLM for compression.
3. The LLM is prompted to summarise the chunk into ≤ 100 words preserving: user preferences, constraints, and key decisions.
4. The compressed summaries replace the original chunks in the final context sent to the main AI pipeline.

### Configuration

```typescript
const MAX_TOKENS_PER_COMPRESSED = 500;
const SIMILARITY_THRESHOLD = 0.82;
```

Token estimation uses a simple heuristic: `Math.ceil(content.length / 4)`.

### API

```typescript
import { compressContext } from "@/lib/context-compression/contextCompressor";

const { compressed, originalTokens, compressedTokens } = await compressContext(
  deduplicated,   // output from deduplicateContext()
  userId,
);
```

---

## Wiring into an AI chat handler

```typescript
import { deduplicateContext } from "@/lib/context-compression/contextDeduplicator";
import { compressContext } from "@/lib/context-compression/contextCompressor";

export async function POST(req: Request) {
  const { messages, userId } = await req.json();

  // 1. Remove semantic duplicates
  const { deduplicated } = await deduplicateContext(messages, userId);

  // 2. Compress long chunks
  const { compressed } = await compressContext(deduplicated, userId);

  // 3. Forward compressed context to the LLM
  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: compressed,
    ...
  });
  ...
}
```

---

## HNSW Index

The `HNSWIndex` is an in-process, per-user approximate nearest-neighbour structure.
It is keyed by `userId` in a module-level `Map`, so it persists across requests in the
same Node.js process (in-memory, not persisted to a database).

```typescript
const hnswIndexes = new Map<string, HNSWIndex>();
```

**Limitations:**
- Indexes are lost on cold starts (serverless function restarts).
- Memory grows proportional to unique users × conversation length.
- For production, consider persisting index state to Redis or PostgreSQL + pgvector.

---

## Token Savings

Typical reduction on a 50-turn conversation:

| Stage | Tokens |
|-------|--------|
| Raw history | ~6 000 |
| After deduplication | ~4 200 |
| After compression | ~800 |

---

## Further Reading

- [`src/lib/context-compression/contextCompressor.ts`](../src/lib/context-compression/contextCompressor.ts)
- [`src/lib/context-compression/contextDeduplicator.ts`](../src/lib/context-compression/contextDeduplicator.ts)
- [`src/lib/hnsw/hnsw.ts`](../src/lib/hnsw/hnsw.ts) — HNSW implementation
- [`src/lib/cache/semanticCache.ts`](../src/lib/cache/semanticCache.ts) — embedding generation
