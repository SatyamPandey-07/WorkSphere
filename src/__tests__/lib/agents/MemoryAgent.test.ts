import { updateUserPreferencesSummary } from "@/lib/agents/MemoryAgent";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    userMemory: {
      findMany: jest.fn(),
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
  },
}));

jest.mock("groq-sdk", () => {
  return {
    Groq: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: "I prefer quiet libraries with outlets.",
                },
              },
            ],
          }),
        },
      },
    })),
  };
});

describe("MemoryAgent - updateUserPreferencesSummary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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
      { venue: { name: "Starbucks" }, wifiQuality: 4, noiseLevel: "moderate", hasOutlets: true },
    ]);

    const result = await updateUserPreferencesSummary("test-user");

    expect(prisma.userMemory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "test-user" } })
    );
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "test-user" },
      data: { preferencesSummary: "I prefer quiet libraries with outlets." },
    });
    expect(result).toBe("I prefer quiet libraries with outlets.");
  });
});
