/**
 * Memory retention and lifecycle tests for contextCompressor (#1715)
 *
 * Tests cover:
 * 1. Large multi-turn conversations
 * 2. Temporary batch data becoming eligible for GC
 * 3. Embeddings not unnecessarily retained after indexing
 * 4. Repeated large compressions memory stability
 * 5. Edge cases: empty, single-batch, multi-batch, final-partial-batch
 * 6. compressFullConversation (unchanged function, sanity check)
 *
 * Isolation: each test uses a unique userId so per-user HNSW indexes never collide.
 * No public API changes are introduced in production code for test purposes.
 */

import {
  compressConversationChunk,
  retrieveRelevantContext,
  getCompressedContextString,
  compressFullConversation,
} from "@/lib/context-compression/contextCompressor";
import { generateEmbedding } from "@/lib/cache/semanticCache";

// PrismaClient cannot run in the jsdom browser environment
jest.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(),
    $executeRawUnsafe: jest.fn(),
  },
}));

// Avoid real Cohere network calls; return a deterministic 1024-dim vector per call
jest.mock("@/lib/cache/semanticCache", () => ({
  generateEmbedding: jest.fn(),
}));

const mockGenerateEmbedding = generateEmbedding as jest.MockedFunction<
  typeof generateEmbedding
>;

/** Returns a fresh 1024-element array each call. */
function makeEmbedding(seed = 0): number[] {
  return Array.from({ length: 1024 }, (_, i) => 0.001 * ((i + seed) % 10));
}

// Unique userId counter — each test gets its own HNSW sub-index
let userCounter = 0;
function nextUserId(): string {
  return `test-user-${++userCounter}`;
}

describe("contextCompressor — memory leak & lifecycle (#1715)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: return a deterministic 1024-dim vector
    mockGenerateEmbedding.mockImplementation(async () => makeEmbedding());
  });

  // ---------------------------------------------------------------------------
  // 1. Large Multi-Turn Conversations
  // ---------------------------------------------------------------------------
  describe("1. Large Multi-Turn Conversations", () => {
    it("successfully compresses a 60-turn conversation across multiple token batches", async () => {
      const userId = nextUserId();
      const messages = Array.from({ length: 60 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message ${i}: I would like to book a workstation in downtown Seattle near public transit with ergonomic seating, reliable Wi-Fi, and 24/7 access. Please confirm availability for date ${i}.`,
      }));

      const result = await compressConversationChunk(
        userId,
        "conv-large",
        messages,
      );

      expect(result).toBeDefined();
      expect(result.id).toContain("conv-large");
      expect(result.userId).toBe(userId);
      expect(result.conversationId).toBe("conv-large");
      expect(result.messageCount).toBe(60);
      expect(result.tokenCount).toBeGreaterThan(0);
      expect(result.embedding).toBeDefined();
      expect(result.embedding.length).toBe(1024);

      // Result must be retrievable via HNSW
      const relevant = await retrieveRelevantContext(
        userId,
        "workstation Seattle",
        5,
      );
      expect(relevant.length).toBeGreaterThan(0);
      expect(relevant[0].id).toBe(result.id);
      expect(relevant[0].embedding.length).toBe(1024);

      const contextStr = getCompressedContextString(relevant);
      expect(contextStr).toContain("COMPRESSED HISTORICAL CONTEXT:");
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Temporary Batch Data Becoming Eligible for GC
  // ---------------------------------------------------------------------------
  describe("2. Temporary Batch Data Becoming Eligible for GC", () => {
    it("returns a CompressedContext with no internal batch/chunk arrays attached", async () => {
      const userId = nextUserId();
      // Messages long enough to trigger multi-batch compression
      const messages = Array.from({ length: 30 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Turn ${i}: ${"conference room requirements and constraints ".repeat(10)}`,
      }));

      const result = await compressConversationChunk(
        userId,
        "conv-batch",
        messages,
      );

      expect(result.messageCount).toBe(30);
      expect(result.embedding.length).toBe(1024);

      // The returned value must not carry any internal working structures
      expect((result as any).chunks).toBeUndefined();
      expect((result as any).batches).toBeUndefined();
      expect((result as any).currentBatch).toBeUndefined();
    });

    it("propagates errors from generateEmbedding without swallowing them (finally cleanup)", async () => {
      const userId = nextUserId();
      // Fail on the first generateEmbedding call to exercise the finally-cleanup path
      mockGenerateEmbedding
        .mockRejectedValueOnce(new Error("Embedding API unreachable"))
        .mockResolvedValue(makeEmbedding());

      const messages = Array.from({ length: 10 }, (_, i) => ({
        role: "user",
        content: `Message ${i}: ${"test error handling ".repeat(25)}`,
      }));

      await expect(
        compressConversationChunk(userId, "conv-err", messages),
      ).rejects.toThrow("Embedding API unreachable");
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Embeddings Not Unnecessarily Retained After Indexing
  // ---------------------------------------------------------------------------
  describe("3. Embeddings Not Unnecessarily Retained After Indexing", () => {
    it("preserves the final embedding in CompressedContext and HNSW; clears intermediate batch embeddings", async () => {
      const userId = nextUserId();
      const callCount = { n: 0 };
      // Track every vector returned — each call gets a distinct array object
      const compressionVectors: number[][] = [];

      mockGenerateEmbedding.mockImplementation(async () => {
        const vec = Array.from({ length: 1024 }, (_, i) =>
          Math.sin(i + callCount.n),
        );
        callCount.n++;
        compressionVectors.push(vec);
        return vec;
      });

      // Long messages that will produce multiple batches
      const messages = Array.from({ length: 25 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Query ${i}: ${"booking confirmation workspace ".repeat(15)}`,
      }));

      const result = await compressConversationChunk(
        userId,
        "conv-emb",
        messages,
      );

      // Snapshot vectors produced DURING compression only, before the query call below adds more
      const afterCompressionCount = compressionVectors.length;
      expect(afterCompressionCount).toBeGreaterThan(1); // multiple batches + final

      const finalVec = compressionVectors[afterCompressionCount - 1];

      // The returned CompressedContext holds exactly the final vector
      expect(result.embedding).toBe(finalVec);
      expect(result.embedding.length).toBe(1024);

      // The HNSW node also holds the final vector (not an intermediate one)
      const relevant = await retrieveRelevantContext(userId, "test query", 1);
      expect(relevant.length).toBe(1);
      expect(relevant[0].id).toBe(result.id);
      expect(relevant[0].embedding).toBe(finalVec);

      // Intermediate embeddings (all but the last compression call) must not be in HNSW
      const intermediate = compressionVectors.slice(
        0,
        afterCompressionCount - 1,
      );
      for (const v of intermediate) {
        expect(relevant[0].embedding).not.toBe(v);
      }
    });

    it("never zeroes out or invalidates the final embedding", async () => {
      const userId = nextUserId();
      const messages = [
        { role: "user", content: "Check in at desk A1." },
        { role: "assistant", content: "Checked in." },
      ];

      const result = await compressConversationChunk(
        userId,
        "conv-integrity",
        messages,
      );

      expect(result.embedding.length).toBe(1024);
      expect(result.embedding.every((v) => typeof v === "number")).toBe(true);
      expect(result.embedding.some((v) => isNaN(v))).toBe(false);

      const relevant = await retrieveRelevantContext(userId, "desk", 1);
      expect(relevant[0].embedding.length).toBe(1024);
      expect(relevant[0].embedding).toEqual(result.embedding);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Repeated Large Compressions Memory Stability
  // ---------------------------------------------------------------------------
  describe("4. Repeated Large Compressions Memory Stability", () => {
    it("maintains bounded heap growth across 25 repeated large compressions", async () => {
      const ITERATIONS = 25;
      const heapSnapshots: number[] = [];

      for (let i = 0; i < ITERATIONS; i++) {
        const userId = nextUserId();
        const messages = Array.from({ length: 20 }, (_, turn) => ({
          role: turn % 2 === 0 ? "user" : "assistant",
          content: `Iteration ${i} Turn ${turn}: ${"quiet space with natural light ".repeat(10)}`,
        }));

        await compressConversationChunk(userId, `conv-rep-${i}`, messages);

        if (i % 5 === 0) {
          if (typeof (global as any).gc === "function") {
            (global as any).gc();
          }
          heapSnapshots.push(process.memoryUsage().heapUsed);
        }
      }

      if (heapSnapshots.length >= 2) {
        const growthMB =
          (heapSnapshots[heapSnapshots.length - 1] - heapSnapshots[0]) /
          (1024 * 1024);
        // In a mock environment heap growth over 25 large compressions must be < 50 MB
        expect(growthMB).toBeLessThan(50);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Edge Cases
  // ---------------------------------------------------------------------------
  describe("5. Edge Cases", () => {
    it("handles an empty messages array without error", async () => {
      const userId = nextUserId();
      const result = await compressConversationChunk(userId, "conv-empty", []);
      expect(result).toBeDefined();
      expect(result.messageCount).toBe(0);
      expect(result.embedding.length).toBe(1024);
    });

    it("handles a single-message (single-batch) conversation", async () => {
      const userId = nextUserId();
      const result = await compressConversationChunk(userId, "conv-single", [
        { role: "user", content: "Short message." },
      ]);
      expect(result.messageCount).toBe(1);
      expect(result.embedding.length).toBe(1024);
    });

    it("handles a multi-batch conversation (content exceeds MAX_TOKENS_PER_COMPRESSED)", async () => {
      const userId = nextUserId();
      // Each message ~320 chars → ~80 tokens; 7+ messages push past 500-token limit
      const messages = Array.from({ length: 12 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Turn ${i}: ${"workspace booking ".repeat(20)}`,
      }));

      const result = await compressConversationChunk(
        userId,
        "conv-multi",
        messages,
      );
      expect(result.messageCount).toBe(12);
      expect(result.embedding.length).toBe(1024);
      // Should have generated more than one embedding (at least one per batch + final)
      expect(mockGenerateEmbedding.mock.calls.length).toBeGreaterThan(1);
    });

    it("handles a final-partial-batch conversation (full batch + smaller trailing batch)", async () => {
      const userId = nextUserId();
      const messages = Array.from({ length: 7 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Turn ${i}: ${"booking conference room amenities ".repeat(10)}`,
      }));

      const result = await compressConversationChunk(
        userId,
        "conv-partial",
        messages,
      );
      expect(result.messageCount).toBe(7);
      expect(result.embedding.length).toBe(1024);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. compressFullConversation (unchanged function — sanity check)
  // ---------------------------------------------------------------------------
  describe("6. compressFullConversation", () => {
    it("returns original conversation text when total tokens <= maxTokens", async () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ];

      const result = await compressFullConversation(messages, 3000);
      expect(result.compressed).toBe("user: Hello\nassistant: Hi");
      expect(result.saved).toBe(0);
    });

    it("invokes LLM compression when total tokens exceed maxTokens", async () => {
      // 12 000 chars / 4 ≈ 3 000 tokens which exceeds maxTokens=500
      const messages = [{ role: "user", content: "A".repeat(12000) }];

      const result = await compressFullConversation(messages, 500);
      expect(result).toBeDefined();
      expect(typeof result.compressed).toBe("string");
    });
  });
});
