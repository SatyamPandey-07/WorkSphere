import { POST } from "@/app/api/chat/route";
import {
  orchestratorAgent,
  contextAgent,
  dataAgent,
  reasoningAgent,
  actionAgent,
} from "@/lib/ai/chatAgents";
import { auth } from "@clerk/nextjs/server";
import { rateLimit, getRateLimitInfo } from "@/lib/rateLimit";
import { prisma } from "@/lib/prisma";

// Mock clerk auth
jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

// Mock rateLimit utilities
jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn(),
  getRateLimitInfo: jest.fn(),
}));

// Mock prisma client
jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    venue: {
      findMany: jest.fn(),
    },
    message: {
      create: jest.fn(),
    },
    conversation: {
      update: jest.fn(),
    },
    $queryRawUnsafe: jest.fn(),
  },
}));

// Create a mock completions function we can control per-test
const mockCreateCompletions = jest.fn();

// Mock groq-sdk client
jest.mock("groq-sdk", () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreateCompletions,
      },
    },
  }));
});

// Mock semantic cache
jest.mock("@/lib/cache/semanticCache", () => ({
  checkSemanticCache: jest.fn().mockResolvedValue(null),
  setSemanticCache: jest.fn().mockResolvedValue(true),
}));

// Mock backgroundSync
jest.mock("@/lib/backgroundSync", () => ({
  triggerBackgroundMemorySync: jest.fn(),
}));

// Mock global fetch for Overpass API and Cohere API
global.fetch = jest.fn();

describe("Chat API - Route Handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth as any).mockResolvedValue({ userId: "user_123" });
    (rateLimit as any).mockResolvedValue(true);
    process.env.GROQ_API_KEY = "test-key";

    // Default mock response for orchestrator agent
    mockCreateCompletions.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              agentsToUse: [
                "ContextAgent",
                "DataAgent",
                "ReasoningAgent",
                "ActionAgent",
              ],
              reasoning: "Test reasoning",
              skipAgents: false,
              complexity: "complex",
            }),
          },
        },
      ],
    });

    (prisma.venue.findMany as any).mockResolvedValue([]);
  });

  it("should return 400 if messages are missing", async () => {
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ location: { lat: 37.7749, lng: -122.4194 } }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("messages");
  });

  it("should process valid request and run pipeline successfully", async () => {
    // Mock Context Agent LLM response
    mockCreateCompletions
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                agentsToUse: [
                  "ContextAgent",
                  "DataAgent",
                  "ReasoningAgent",
                  "ActionAgent",
                ],
                reasoning: "Complex needs",
                skipAgents: false,
                complexity: "complex",
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                intent: "Find quiet cafe",
                parameters: {
                  workType: "focus",
                  amenities: ["wifi", "quiet"],
                  radius: 2000,
                  category: ["cafe"],
                },
                reasoning: "User is looking for quiet place to work",
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: "Here is the response." } }] };
        },
      });

    // Mock Overpass API response
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        elements: [
          {
            id: 1,
            lat: 37.7749,
            lon: -122.4194,
            tags: {
              name: "Mock Cafe",
              amenity: "cafe",
              internet_access: "wlan",
            },
          },
        ],
      }),
    });

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "user", content: "find quiet cafe" }],
        location: { lat: 37.7749, lng: -122.4194 },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("METADATA:");
    expect(text).toContain("TEXT:");
  });

  it("should return 429 when custom server rate limit is exceeded", async () => {
    (rateLimit as any).mockResolvedValue(false);
    (getRateLimitInfo as any).mockResolvedValue({
      resetTime: Date.now() + 60000,
    });

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "user", content: "hello" }],
        location: { lat: 37.7749, lng: -122.4194 },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain("Rate limit exceeded");
  });
});

describe("5-Agent Pipeline Unit Tests", () => {
  describe("Orchestrator Agent", () => {
    it("should parse Orchestrator decisions correctly", async () => {
      mockCreateCompletions.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                agentsToUse: [
                  "ContextAgent",
                  "DataAgent",
                  "ReasoningAgent",
                  "ActionAgent",
                ],
                reasoning: "Test reasoning",
                skipAgents: false,
                complexity: "complex",
              }),
            },
          },
        ],
      });

      const decision = await orchestratorAgent("Find cafes", {
        lat: 37.7749,
        lng: -122.4194,
      });
      expect(decision.agentsToUse).toContain("ContextAgent");
      expect(decision.skipAgents).toBe(false);
    });
  });

  describe("Context Agent", () => {
    it("should extract search parameters from user queries", async () => {
      mockCreateCompletions.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                intent: "Find quiet cafe",
                parameters: {
                  workType: "focus",
                  amenities: ["wifi", "quiet"],
                  radius: 2000,
                  category: ["cafe"],
                },
                reasoning: "User is looking for quiet place to work",
              }),
            },
          },
        ],
      });

      const context = await contextAgent(
        "Find quiet cafes",
        { lat: 37.7749, lng: -122.4194 },
        "user_123",
      );
      expect(context.parameters.workType).toBe("focus");
      expect(context.parameters.amenities).toContain("quiet");
    });
  });

  describe("Data Agent", () => {
    it("should query Overpass API or fallback to simulation if Overpass fails", async () => {
      (global.fetch as any).mockRejectedValue(new Error("Network Error"));

      const data = await dataAgent({
        location: { lat: 37.7749, lng: -122.4194 },
      });
      expect(data.venues.length).toBeGreaterThan(0);
      expect(data.meta.source).toBe("Simulation Fallback");
    });
  });

  describe("Reasoning Agent", () => {
    it("should score and rank venues based on preferences", () => {
      const mockVenues = [
        {
          id: "1",
          name: "Cafe A",
          lat: 37.7749,
          lng: -122.4194,
          category: "cafe",
          address: null,
          wifi: true,
          hasOutlets: true,
          noiseLevel: "quiet",
          rating: 4.5,
          wifiQuality: 5,
          openingHours: null,
          hasErgonomic: true,
          outletDensity: "some_tables",
          wifiSpeed: 50,
          hasPhoneBooths: false,
          hasNoMusic: false,
          hasQuietZone: false,
          hasAncHeadsetRental: false,
        },
      ];

      const ranked = reasoningAgent(mockVenues, {
        workType: "focus",
        amenities: ["wifi", "quiet"],
      });
      expect(ranked.rankedVenues[0].score).toBeGreaterThan(0);
    });
  });

  describe("Action Agent", () => {
    it("should generate clean action recommendations and map markers", async () => {
      const mockRanked = [
        {
          id: "1",
          name: "Cafe A",
          lat: 37.7749,
          lng: -122.4194,
          category: "cafe",
          address: null,
          wifi: true,
          hasOutlets: true,
          noiseLevel: "quiet",
          rating: 4.5,
          wifiQuality: 5,
          openingHours: null,
          hasErgonomic: true,
          outletDensity: "some_tables",
          wifiSpeed: 50,
          hasPhoneBooths: false,
          hasNoMusic: false,
          hasQuietZone: false,
          hasAncHeadsetRental: false,
          score: 8.5,
          scoreBreakdown: {},
        },
      ];

      const result = await actionAgent(mockRanked, "hello");
      expect(result.message).toContain("Cafe A");
      expect(result.mapUpdates.markers.length).toBe(1);
    });
  });
});
