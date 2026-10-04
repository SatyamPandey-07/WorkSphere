import {
  cosineSimilarity,
  clusterMemoryStatements,
  synthesizeMemoryCluster,
  compactUserMemories,
  updateUserPreferencesSummary,
  estimateTokens,
  MEMORY_COMPACTION_THRESHOLD,
  MEMORY_SIMILARITY_THRESHOLD,
  type MemoryStatement,
} from "@/lib/agents/MemoryAgent";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    userMemory: {
      findMany: jest.fn(),
      count: jest.fn(),
      deleteMany: jest.fn(),
      create: jest.fn(),
    },
    favorite: {
      findMany: jest.fn(),
    },
    venueRating: {
      findMany: jest.fn(),
    },
    user: {
      update: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $executeRawUnsafe: jest.fn(),
  },
}));

const mockCreateCompletion = jest.fn();

jest.mock("groq-sdk", () => {
  return {
    Groq: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreateCompletion,
        },
      },
    })),
  };
});

describe("MemoryAgent - Episodic Memory Compaction (#3449)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content:
              "User requires quiet environments with standing desks and non-dairy milk options.",
          },
        },
      ],
    });
  });

  describe("Cosine Similarity Thresholding", () => {
    it("computes 1.0 for identical vectors and 0.0 for orthogonal vectors", () => {
      const vecA = [1, 0, 0];
      const vecB = [1, 0, 0];
      const vecC = [0, 1, 0];

      expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(1.0, 4);
      expect(cosineSimilarity(vecA, vecC)).toBeCloseTo(0.0, 4);
    });

    it("evaluates similarity against 0.82 threshold correctly", () => {
      // Vectors with angle ~25 degrees -> cosine ~0.906 (> 0.82)
      const highSimA = [1.0, 0.4, 0.1];
      const highSimB = [0.95, 0.45, 0.1];
      expect(cosineSimilarity(highSimA, highSimB)).toBeGreaterThan(
        MEMORY_SIMILARITY_THRESHOLD,
      );

      // Vectors with lower similarity (< 0.82)
      const lowSimA = [1.0, 0.0, 0.0];
      const lowSimB = [0.5, 0.8, 0.3];
      expect(cosineSimilarity(lowSimA, lowSimB)).toBeLessThan(
        MEMORY_SIMILARITY_THRESHOLD,
      );
    });

    it("handles empty or mismatched vectors safely", () => {
      expect(cosineSimilarity([], [])).toBe(0);
      expect(cosineSimilarity([1, 2], [1])).toBe(0);
    });
  });

  describe("Semantic Clustering", () => {
    it("groups statements with similarity > 0.82 into thematic clusters", () => {
      // Acoustic preferences cluster
      const acoustic1: MemoryStatement = {
        id: "1",
        content: "Prefers quiet spaces after 2pm",
        embedding: [1.0, 0.2, 0.1],
      };
      const acoustic2: MemoryStatement = {
        id: "2",
        content: "Likes silent library environments",
        embedding: [0.98, 0.22, 0.09], // High similarity to acoustic1 (> 0.82)
      };

      // Amenities cluster
      const amenity1: MemoryStatement = {
        id: "3",
        content: "Requires standing desks",
        embedding: [0.0, 1.0, 0.1],
      };
      const amenity2: MemoryStatement = {
        id: "4",
        content: "Needs ergonomic standing desk with monitor",
        embedding: [0.05, 0.96, 0.12], // High similarity to amenity1 (> 0.82)
      };

      // Nutrition cluster
      const nutrition1: MemoryStatement = {
        id: "5",
        content: "Needs oat milk for coffee",
        embedding: [0.1, 0.0, 1.0],
      };

      const clusters = clusterMemoryStatements([
        acoustic1,
        acoustic2,
        amenity1,
        amenity2,
        nutrition1,
      ]);

      expect(clusters).toHaveLength(3);
      const acousticCluster = clusters.find(
        (c) => c.theme === "Acoustic Preferences",
      );
      expect(acousticCluster?.items).toHaveLength(2);
      expect(acousticCluster?.items.map((i) => i.id)).toEqual(["1", "2"]);

      const amenityCluster = clusters.find(
        (c) => c.theme === "Amenities & Ergonomics",
      );
      expect(amenityCluster?.items).toHaveLength(2);
      expect(amenityCluster?.items.map((i) => i.id)).toEqual(["3", "4"]);

      const nutritionCluster = clusters.find(
        (c) => c.theme === "Nutrition & Beverages",
      );
      expect(nutritionCluster?.items).toHaveLength(1);
      expect(nutritionCluster?.items[0].id).toBe("5");
    });
  });

  describe("LLM Synthesis", () => {
    it("synthesizes clustered items into a single comprehensive persona statement", async () => {
      const items: MemoryStatement[] = [
        { id: "1", content: "Prefers standing desks" },
        { id: "2", content: "Likes quiet spaces after 2pm" },
        { id: "3", content: "Needs oat milk" },
      ];

      const result = await synthesizeMemoryCluster(
        items,
        "Workspace Habits",
      );

      expect(mockCreateCompletion).toHaveBeenCalled();
      expect(result).toBe(
        "User requires quiet environments with standing desks and non-dairy milk options.",
      );
    });

    it("returns single statement unchanged without calling LLM", async () => {
      const items: MemoryStatement[] = [
        { id: "1", content: "Prefers quiet spaces" },
      ];

      const result = await synthesizeMemoryCluster(items);
      expect(result).toBe("Prefers quiet spaces");
      expect(mockCreateCompletion).not.toHaveBeenCalled();
    });
  });

  describe("Compaction Pipeline & Database Retention", () => {
    it("skips compaction when memory items count is <= 40", async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { id: "1", content: "Needs fast wifi", embedding: "[1,0,0]" },
      ]);

      const result = await compactUserMemories("user-1");
      expect(result.status).toBe("skipped");
      expect(result.initialCount).toBe(1);
      expect(prisma.userMemory.deleteMany).not.toHaveBeenCalled();
    });

    it("executes compaction when memory items exceed N > 40 and archives granular entries", async () => {
      // Generate 45 memory statements (e.g. 15 acoustic, 15 amenities, 15 nutrition)
      const mockMemories = [];
      for (let i = 1; i <= 45; i++) {
        let emb = [0, 0, 0];
        let content = `Statement ${i}`;
        if (i <= 15) {
          emb = [1.0, 0.1 * (i / 15), 0.0];
          content = `User prefers quiet acoustic environment variant ${i} with no loud music`;
        } else if (i <= 30) {
          emb = [0.0, 1.0, 0.1 * ((i - 15) / 15)];
          content = `User requires standing desks with dual monitors variant ${i}`;
        } else {
          emb = [0.0, 0.1 * ((i - 30) / 15), 1.0];
          content = `User always needs oat milk and vegan snacks variant ${i}`;
        }

        mockMemories.push({
          id: `mem-${i}`,
          content,
          embedding: JSON.stringify(emb),
          createdAt: new Date(),
        });
      }

      (prisma.$queryRaw as jest.Mock).mockResolvedValue(mockMemories);
      (prisma.userMemory.deleteMany as jest.Mock).mockResolvedValue({
        count: 45,
      });
      (prisma.userMemory.create as jest.Mock).mockResolvedValue({
        id: "new-summary-id",
      });

      const result = await compactUserMemories("power-user");

      expect(result.status).toBe("compacted");
      expect(result.initialCount).toBe(45);
      expect(result.finalCount).toBeLessThan(45);
      // Acceptance Criteria: Reduces prompt token usage by >= 50%
      expect(result.tokenReductionPercent).toBeGreaterThanOrEqual(50);

      // Database retention: Granular entries archived (deleted from active table)
      expect(prisma.userMemory.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: expect.any(Array) } },
      });
      // Compacted summary statement persisted in Prisma
      expect(result.compactedStatements.length).toBeGreaterThan(0);
    });
  });

  describe("MemoryAgent - updateUserPreferencesSummary", () => {
    it("should return null if there are no memories, favorites, or ratings", async () => {
      (prisma.userMemory.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.favorite.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.venueRating.findMany as jest.Mock).mockResolvedValue([]);

      const result = await updateUserPreferencesSummary("test-user");
      expect(result).toBeNull();
    });

    it("should query databases, call LLM, and update preferencesSummary", async () => {
      (prisma.userMemory.findMany as jest.Mock).mockResolvedValue([
        { content: "I like silent work areas." },
      ]);
      (prisma.favorite.findMany as jest.Mock).mockResolvedValue([
        { venue: { name: "Central Library", category: "library" } },
      ]);
      (prisma.venueRating.findMany as jest.Mock).mockResolvedValue([
        {
          venue: { name: "Starbucks" },
          wifiQuality: 4,
          noiseLevel: "moderate",
          hasOutlets: true,
        },
      ]);
      mockCreateCompletion.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: "I prefer quiet libraries with outlets.",
            },
          },
        ],
      });

      const result = await updateUserPreferencesSummary("test-user");

      expect(prisma.userMemory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "test-user" } }),
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "test-user" },
        data: { preferencesSummary: "I prefer quiet libraries with outlets." },
      });
      expect(result).toBe("I prefer quiet libraries with outlets.");
    });
  });
});
