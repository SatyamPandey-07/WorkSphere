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
  calculateMemoryDecay,
  computeMemoryItemScore,
  pruneSessionMemoriesLRU,
  addSessionMemory,
  getSessionMemories,
  touchSessionMemory,
  clearSessionMemories,
  REDIS_MEMORY_LRU_CAP,
  MEMORY_DECAY_HALF_LIFE_DAYS,
  MEMORY_DECAY_HALF_LIFE_HOURS,
  DEFAULT_DECAY_LAMBDA,
  HIGH_SALIENCE_THRESHOLD,
  type SessionMemoryItem,
} from "@/lib/agents/MemoryAgent";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/redis", () => ({
  getRedis: jest.fn(() => null),
}));

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

  describe("Redis Session Memory Store - Decay & LRU Pruning (#6468)", () => {
    const mockUserId = "test-session-user";

    beforeEach(async () => {
      await clearSessionMemories(mockUserId);
    });

    describe("Exponential Time-Decay Scoring", () => {
      it("calculates exponential decay using formula score = baseScore * Math.exp(-lambda * deltaHours)", () => {
        const baseScore = 1.0;
        const deltaHours = 24;
        const lambda = 0.01;
        const expectedScore = baseScore * Math.exp(-lambda * deltaHours);

        const calculated = calculateMemoryDecay(baseScore, deltaHours, lambda);
        expect(calculated).toBeCloseTo(expectedScore, 5);
      });

      it("preserves exact base score when deltaHours is 0 or negative", () => {
        expect(calculateMemoryDecay(0.85, 0)).toBe(0.85);
        expect(calculateMemoryDecay(0.85, -5)).toBe(0.85);
      });

      it("decays memories older than 7 days (168 hours) to half relevance with default lambda", () => {
        const baseScore = 1.0;
        const sevenDaysHours = MEMORY_DECAY_HALF_LIFE_HOURS; // 168 hours

        const scoreAt7Days = calculateMemoryDecay(baseScore, sevenDaysHours);
        // Half-life: at 7 days, score should be ~0.50
        expect(scoreAt7Days).toBeCloseTo(0.5, 3);

        const fourteenDaysHours = sevenDaysHours * 2; // 336 hours
        const scoreAt14Days = calculateMemoryDecay(baseScore, fourteenDaysHours);
        // After two half-lives (14 days), score should be ~0.25
        expect(scoreAt14Days).toBeCloseTo(0.25, 3);
      });

      it("preserves pinned preferences without decaying regardless of age", () => {
        const now = Date.now();
        const tenDaysAgo = now - 10 * 24 * 60 * 60 * 1000;

        const pinnedItem: SessionMemoryItem = {
          id: "pinned-1",
          userId: mockUserId,
          content: "Always need standing desks",
          baseScore: 1.0,
          timestamp: tenDaysAgo,
          lastAccessedAt: tenDaysAgo,
          isPinned: true,
        };

        const unpinnedItem: SessionMemoryItem = {
          id: "unpinned-1",
          userId: mockUserId,
          content: "Asked for today's weather",
          baseScore: 1.0,
          timestamp: tenDaysAgo,
          lastAccessedAt: tenDaysAgo,
          isPinned: false,
        };

        const pinnedScore = computeMemoryItemScore(pinnedItem, now);
        const unpinnedScore = computeMemoryItemScore(unpinnedItem, now);

        expect(pinnedScore).toBe(1.0);
        expect(unpinnedScore).toBeLessThan(0.4);
      });
    });

    describe("LRU Eviction & Pruning Cap (Max 50 Memories)", () => {
      it("does not evict items when total memories count is <= 50", () => {
        const items: SessionMemoryItem[] = Array.from({ length: 30 }, (_, i) => ({
          id: `item-${i}`,
          userId: mockUserId,
          content: `Dialogue turn ${i}`,
          baseScore: 0.8,
          timestamp: Date.now() - i * 1000,
          lastAccessedAt: Date.now() - i * 1000,
        }));

        const pruned = pruneSessionMemoriesLRU(items, REDIS_MEMORY_LRU_CAP);
        expect(pruned).toHaveLength(30);
      });

      it("enforces strict cap of 50 active items and evicts stale, low-relevance turns first", () => {
        const now = Date.now();
        // Generate 60 memories: 10 stale low-relevance from 10 days ago, 50 recent items
        const items: SessionMemoryItem[] = [];

        // 10 stale items (older than 7 days, low salience)
        for (let i = 0; i < 10; i++) {
          items.push({
            id: `stale-${i}`,
            userId: mockUserId,
            content: `Stale message ${i}`,
            baseScore: 0.5,
            timestamp: now - (8 + i) * 24 * 60 * 60 * 1000,
            lastAccessedAt: now - (8 + i) * 24 * 60 * 60 * 1000,
            isPinned: false,
            salience: 0.2,
          });
        }

        // 50 fresh items
        for (let i = 0; i < 50; i++) {
          items.push({
            id: `fresh-${i}`,
            userId: mockUserId,
            content: `Active concierge prompt ${i}`,
            baseScore: 0.9,
            timestamp: now - i * 60 * 1000,
            lastAccessedAt: now - i * 60 * 1000,
            isPinned: false,
            salience: 0.6,
          });
        }

        expect(items).toHaveLength(60);

        const pruned = pruneSessionMemoriesLRU(items, REDIS_MEMORY_LRU_CAP, now);
        expect(pruned).toHaveLength(50);

        // Stale items should have been evicted first
        const prunedIds = new Set(pruned.map((p) => p.id));
        for (let i = 0; i < 10; i++) {
          expect(prunedIds.has(`stale-${i}`)).toBe(false);
        }
      });

      it("preserves pinned preferences and high-salience workspace constraints during LRU eviction", () => {
        const now = Date.now();
        const items: SessionMemoryItem[] = [];

        // 1 Pinned preference (old timestamp)
        items.push({
          id: "pinned-preference",
          userId: mockUserId,
          content: "User prefers ergonomic seating and dual monitors",
          baseScore: 1.0,
          timestamp: now - 15 * 24 * 60 * 60 * 1000,
          lastAccessedAt: now - 15 * 24 * 60 * 60 * 1000,
          isPinned: true,
          salience: 0.5,
        });

        // 1 High-salience workspace constraint (salience >= 0.8)
        items.push({
          id: "high-salience-constraint",
          userId: mockUserId,
          content: "Requires HIPAA-compliant private booth for calls",
          baseScore: 0.8,
          timestamp: now - 12 * 24 * 60 * 60 * 1000,
          lastAccessedAt: now - 12 * 24 * 60 * 60 * 1000,
          isPinned: false,
          salience: 0.95,
        });

        // 55 standard unpinned dialogue turns
        for (let i = 0; i < 55; i++) {
          items.push({
            id: `turn-${i}`,
            userId: mockUserId,
            content: `Turn ${i}`,
            baseScore: 0.7,
            timestamp: now - (i + 1) * 60 * 1000,
            lastAccessedAt: now - (i + 1) * 60 * 1000,
            isPinned: false,
            salience: 0.3,
          });
        }

        expect(items).toHaveLength(57);

        const pruned = pruneSessionMemoriesLRU(items, REDIS_MEMORY_LRU_CAP, now);
        expect(pruned).toHaveLength(50);

        const prunedIds = new Set(pruned.map((p) => p.id));
        // Both the pinned item and high salience item MUST be preserved!
        expect(prunedIds.has("pinned-preference")).toBe(true);
        expect(prunedIds.has("high-salience-constraint")).toBe(true);
      });
    });

    describe("Redis Session Store Integration", () => {
      it("adds dialogue turns, retrieves active context, and evicts at 50 cap", async () => {
        // Mock Redis client with in-memory map
        const redisStore = new Map<string, string>();
        const mockRedis = {
          get: jest.fn(async (key: string) => redisStore.get(key) || null),
          set: jest.fn(async (key: string, val: string) => {
            redisStore.set(key, val);
            return "OK";
          }),
          del: jest.fn(async (key: string) => {
            redisStore.delete(key);
            return 1;
          }),
        };

        // Add 52 memories sequentially
        for (let i = 1; i <= 52; i++) {
          await addSessionMemory(
            mockUserId,
            {
              id: `dialogue-${i}`,
              content: `Turn content ${i}`,
              baseScore: 1.0,
              timestamp: Date.now() + i * 100,
              lastAccessedAt: Date.now() + i * 100,
            },
            { redisClient: mockRedis, maxCap: 50 },
          );
        }

        const activeMemories = await getSessionMemories(mockUserId, {
          redisClient: mockRedis,
        });

        expect(activeMemories).toHaveLength(50);
        expect(mockRedis.set).toHaveBeenCalled();
        expect(mockRedis.get).toHaveBeenCalled();
      });

      it("updates item lastAccessedAt on touchSessionMemory", async () => {
        await addSessionMemory(mockUserId, {
          id: "item-to-touch",
          content: "Needs quiet focus pod",
          timestamp: 1000,
          lastAccessedAt: 1000,
        });

        const updated = await touchSessionMemory(mockUserId, "item-to-touch", {
          accessTime: 99999,
        });
        expect(updated).toBe(true);

        const memories = await getSessionMemories(mockUserId);
        const item = memories.find((m) => m.id === "item-to-touch");
        expect(item?.lastAccessedAt).toBe(99999);
      });
    });
  });
});

