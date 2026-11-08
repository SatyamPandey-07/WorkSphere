import {
  generateEmbedding,
  findRelevantMemories,
  storeUserMemory,
  searchUserMemories,
  getUserMemoryContext,
} from "@/lib/memory";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

describe("Vector Embeddings & pgvector / HNSW Memory Search", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("generates normalized 1024-dimensional vector embeddings for text", async () => {
    const embedding = await generateEmbedding("I prefer quiet coffee shops with standing desks");

    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding).toHaveLength(1024);

    // Verify L2 normalization: sum of squares ≈ 1
    const sumSq = embedding.reduce((sum, val) => sum + val * val, 0);
    expect(sumSq).toBeGreaterThan(0.98);
    expect(sumSq).toBeLessThan(1.02);
  });

  it("retrieves memories using pgvector cosine distance query", async () => {
    const mockRows = [
      { id: "mem-1", content: "Prefers quiet spaces", similarity: 0.88, createdAt: new Date() },
      { id: "mem-2", content: "Needs high-speed WiFi", similarity: 0.76, createdAt: new Date() },
    ];

    (prisma.$queryRaw as jest.Mock).mockResolvedValue(mockRows);

    const queryVec = new Array(1024).fill(0.03);
    const results = await findRelevantMemories("user_123", queryVec, 2, 0.7);

    expect(results).toHaveLength(2);
    expect(results[0].content).toBe("Prefers quiet spaces");
    expect(results[0].similarity).toBe(0.88);
  });

  it("formats user memory context for AI LLM prompts", async () => {
    const mockRows = [
      { id: "mem-1", content: "Likes vegan food and oat milk", similarity: 0.85 },
    ];
    (prisma.$queryRaw as jest.Mock).mockResolvedValue(mockRows);

    const context = await getUserMemoryContext("user_123", "vegan options");
    expect(context).toContain("RELEVANT USER MEMORIES");
    expect(context).toContain("Likes vegan food and oat milk");
  });

  it("stores new memory and indexes into pgvector and HNSW", async () => {
    const mockInsertResult = [{ id: "mem-new-1", content: "Always books private rooms", createdAt: new Date() }];
    (prisma.$queryRaw as jest.Mock).mockResolvedValue(mockInsertResult);

    const memory = await storeUserMemory("user_123", "Always books private rooms");
    expect(memory.id).toBe("mem-new-1");
    expect(memory.content).toBe("Always books private rooms");
  });
});
