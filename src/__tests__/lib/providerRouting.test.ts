import {
  classifyQueryComplexity,
  getProviderForComplexity,
  getFallbackProvider,
  getModelForProvider,
  isRateLimitError,
  executeProviderCompletion,
  executeProviderStream,
  routeChatCompletion,
  routeChatStream,
  GROQ_MODEL,
  GEMINI_MODEL,
} from "@/lib/ai/providerRouting";

// Mock Groq SDK
const mockGroqCreate = jest.fn();
jest.mock("groq-sdk", () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockGroqCreate,
      },
    },
  }));
});

// Mock Gemini client
const mockGeminiGenerateContent = jest.fn();
const mockGeminiGenerateContentStream = jest.fn();
jest.mock("@google/genai", () => {
  return {
    GoogleGenAI: jest.fn().mockImplementation(() => ({
      models: {
        generateContent: mockGeminiGenerateContent,
        generateContentStream: mockGeminiGenerateContentStream,
      },
    })),
  };
});

describe("AI Provider Routing & Complexity Classification (#3364)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      GROQ_API_KEY: "test-groq-key",
      GEMINI_API_KEY: "test-gemini-key",
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // =========================================================================
  // 1. Complexity Classification
  // =========================================================================
  describe("Complexity classification", () => {
    it("classifies simple factual lookup as simple -> Groq", () => {
      const result = classifyQueryComplexity(
        "what is the wifi speed at Blue Bottle?",
      );
      expect(result).toBe("simple");
      expect(getProviderForComplexity(result)).toBe("groq");
    });

    it("classifies simple navigation/filter query as simple -> Groq", () => {
      const filterResult = classifyQueryComplexity("show cafes with wifi");
      expect(filterResult).toBe("simple");
      expect(getProviderForComplexity(filterResult)).toBe("groq");

      const navResult = classifyQueryComplexity(
        "directions to Central Library",
      );
      expect(navResult).toBe("simple");
      expect(getProviderForComplexity(navResult)).toBe("groq");
    });

    it("classifies simple conversational / CRUD queries as simple -> Groq", () => {
      expect(classifyQueryComplexity("hello")).toBe("simple");
      expect(classifyQueryComplexity("thanks")).toBe("simple");
      expect(classifyQueryComplexity("book a desk for tomorrow")).toBe("simple");
    });

    it("classifies complex comparison as complex -> Gemini", () => {
      const comp1 = classifyQueryComplexity(
        "compare Blue Bottle and City Library for a 4 hour focus session",
      );
      expect(comp1).toBe("complex");
      expect(getProviderForComplexity(comp1)).toBe("gemini");

      const comp2 = classifyQueryComplexity(
        "which is better between Workspace A and Workspace B for calls?",
      );
      expect(comp2).toBe("complex");
      expect(getProviderForComplexity(comp2)).toBe("gemini");

      const comp3 = classifyQueryComplexity(
        "what is the difference between these two coworking spots?",
      );
      expect(comp3).toBe("complex");
      expect(getProviderForComplexity(comp3)).toBe("gemini");
    });

    it("classifies long-context query as complex -> Gemini", () => {
      const longContextMessages = [
        { role: "user", content: "I am looking for a spot" },
        { role: "assistant", content: "Here are some cafes" },
        { role: "user", content: "What about libraries?" },
        { role: "assistant", content: "Here are some libraries" },
        { role: "user", content: "Can you filter by outlets?" },
        { role: "assistant", content: "Filtered list" },
        { role: "user", content: "Which one do you recommend now?" },
      ];
      const result = classifyQueryComplexity(
        "Which one do you recommend?",
        longContextMessages,
      );
      expect(result).toBe("complex");
      expect(getProviderForComplexity(result)).toBe("gemini");

      const textContext = "A".repeat(550);
      expect(classifyQueryComplexity("summarize these", textContext)).toBe(
        "complex",
      );
    });

    it("classifies multi-constraint query as complex -> Gemini", () => {
      const multiConstraint = classifyQueryComplexity(
        "find a quiet cafe with fast wifi, standing desk, and power outlets",
      );
      expect(multiConstraint).toBe("complex");
      expect(getProviderForComplexity(multiConstraint)).toBe("gemini");

      const multiConstraint2 = classifyQueryComplexity(
        "need a workspace with phone booth, ergonomic chair, and open late",
      );
      expect(multiConstraint2).toBe("complex");
      expect(getProviderForComplexity(multiConstraint2)).toBe("gemini");
    });

    it("classifies complex planning query as complex -> Gemini", () => {
      const planResult = classifyQueryComplexity(
        "plan my workday schedule across three different coffee shops",
      );
      expect(planResult).toBe("complex");
      expect(getProviderForComplexity(planResult)).toBe("gemini");
    });

    it("classifies boundary/ordinary query deterministically -> simple", () => {
      // 1 or 2 constraints is ordinary search -> simple
      expect(classifyQueryComplexity("find a quiet cafe")).toBe("simple");
      expect(
        classifyQueryComplexity("coworking space with wifi and outlets"),
      ).toBe("simple");
      expect(classifyQueryComplexity("cheap cafe nearby")).toBe("simple");
    });

    it("handles edge cases and invalid inputs safely", () => {
      expect(classifyQueryComplexity("")).toBe("simple");
      expect(classifyQueryComplexity(null as any)).toBe("simple");
      expect(classifyQueryComplexity(undefined as any)).toBe("simple");
    });
  });

  // =========================================================================
  // 2. Provider Routing
  // =========================================================================
  describe("Provider routing", () => {
    it("routes simple query to Groq (llama-3.3-70b-versatile)", async () => {
      mockGroqCreate.mockResolvedValueOnce({
        choices: [{ message: { content: "Groq response" } }],
      });

      const res = await routeChatCompletion({
        complexity: "simple",
        messages: [{ role: "user", content: "show cafes with wifi" }],
      });

      expect(res.provider).toBe("groq");
      expect(res.text).toBe("Groq response");
      expect(mockGroqCreate).toHaveBeenCalledTimes(1);
      expect(mockGroqCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: GROQ_MODEL,
        }),
      );
      expect(mockGeminiGenerateContent).not.toHaveBeenCalled();
    });

    it("routes complex query to Gemini (gemini-3.6-flash)", async () => {
      mockGeminiGenerateContent.mockResolvedValueOnce({
        text: "Gemini response",
      });

      const res = await routeChatCompletion({
        complexity: "complex",
        messages: [
          {
            role: "user",
            content: "compare Blue Bottle and City Library for deep work",
          },
        ],
      });

      expect(res.provider).toBe("gemini");
      expect(res.text).toBe("Gemini response");
      expect(mockGeminiGenerateContent).toHaveBeenCalledTimes(1);
      expect(mockGeminiGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: GEMINI_MODEL,
        }),
      );
      expect(mockGroqCreate).not.toHaveBeenCalled();
    });

    it("does not call both providers for a successful primary request", async () => {
      mockGroqCreate.mockResolvedValueOnce({
        choices: [{ message: { content: "Success from Groq" } }],
      });

      await routeChatCompletion({
        complexity: "simple",
        messages: [{ role: "user", content: "hello" }],
      });

      expect(mockGroqCreate).toHaveBeenCalledTimes(1);
      expect(mockGeminiGenerateContent).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. Failover
  // =========================================================================
  describe("Failover (HTTP 429 rate limit)", () => {
    it("fails over from Groq -> 429 -> Gemini transparently", async () => {
      const rateLimitError: any = new Error("Rate limit exceeded. Try again in 5s");
      rateLimitError.status = 429;

      mockGroqCreate.mockRejectedValueOnce(rateLimitError);
      mockGeminiGenerateContent.mockResolvedValueOnce({
        text: "Gemini fallback response",
      });

      const res = await routeChatCompletion({
        complexity: "simple",
        messages: [{ role: "user", content: "find quiet place" }],
      });

      expect(res.provider).toBe("gemini");
      expect(res.text).toBe("Gemini fallback response");
      expect(res.fallbackUsed).toBe(true);
      expect(mockGroqCreate).toHaveBeenCalledTimes(1);
      expect(mockGeminiGenerateContent).toHaveBeenCalledTimes(1);
    });

    it("fails over from Gemini -> 429 -> Groq transparently", async () => {
      const gemini429: any = new Error("Resource exhausted (quota exceeded)");
      gemini429.status = 429;

      mockGeminiGenerateContent.mockRejectedValueOnce(gemini429);
      mockGroqCreate.mockResolvedValueOnce({
        choices: [{ message: { content: "Groq fallback response" } }],
      });

      const res = await routeChatCompletion({
        complexity: "complex",
        messages: [
          {
            role: "user",
            content: "compare cafe A and cafe B with wifi and outlets",
          },
        ],
      });

      expect(res.provider).toBe("groq");
      expect(res.text).toBe("Groq fallback response");
      expect(res.fallbackUsed).toBe(true);
      expect(mockGeminiGenerateContent).toHaveBeenCalledTimes(1);
      expect(mockGroqCreate).toHaveBeenCalledTimes(1);
    });

    it("does NOT trigger fallback on non-429 errors (e.g. 500 error)", async () => {
      const serverError: any = new Error("Internal Server Error");
      serverError.status = 500;

      mockGroqCreate.mockRejectedValueOnce(serverError);

      await expect(
        routeChatCompletion({
          complexity: "simple",
          messages: [{ role: "user", content: "hi" }],
        }),
      ).rejects.toThrow("Internal Server Error");

      expect(mockGroqCreate).toHaveBeenCalledTimes(1);
      expect(mockGeminiGenerateContent).not.toHaveBeenCalled();
    });

    it("does NOT trigger fallback on non-429 Gemini errors", async () => {
      const badRequest: any = new Error("Invalid argument");
      badRequest.status = 400;

      mockGeminiGenerateContent.mockRejectedValueOnce(badRequest);

      await expect(
        routeChatCompletion({
          complexity: "complex",
          messages: [{ role: "user", content: "compare venues" }],
        }),
      ).rejects.toThrow("Invalid argument");

      expect(mockGeminiGenerateContent).toHaveBeenCalledTimes(1);
      expect(mockGroqCreate).not.toHaveBeenCalled();
    });

    it("ensures fallback happens at most once without infinite loop", async () => {
      const groq429: any = new Error("Groq 429 rate limit");
      groq429.status = 429;
      const gemini429: any = new Error("Gemini 429 rate limit");
      gemini429.status = 429;

      mockGroqCreate.mockRejectedValueOnce(groq429);
      mockGeminiGenerateContent.mockRejectedValueOnce(gemini429);

      await expect(
        routeChatCompletion({
          complexity: "simple",
          messages: [{ role: "user", content: "test" }],
        }),
      ).rejects.toThrow("Gemini 429 rate limit");

      expect(mockGroqCreate).toHaveBeenCalledTimes(1);
      expect(mockGeminiGenerateContent).toHaveBeenCalledTimes(1);
    });

    it("handles streaming failover from Groq -> 429 -> Gemini", async () => {
      const rateLimitError: any = new Error("Groq stream 429");
      rateLimitError.status = 429;

      mockGroqCreate.mockRejectedValueOnce(rateLimitError);

      mockGeminiGenerateContentStream.mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield { text: "Chunk 1" };
          yield { text: " Chunk 2" };
        },
      });

      const chunks: string[] = [];
      const res = await routeChatStream({
        complexity: "simple",
        messages: [{ role: "user", content: "streaming test" }],
        onChunk: (text) => chunks.push(text),
      });

      expect(res.provider).toBe("gemini");
      expect(res.text).toBe("Chunk 1 Chunk 2");
      expect(chunks).toEqual(["Chunk 1", " Chunk 2"]);
      expect(mockGroqCreate).toHaveBeenCalledTimes(1);
      expect(mockGeminiGenerateContentStream).toHaveBeenCalledTimes(1);
    });

    it("handles streaming failover from Gemini -> 429 -> Groq", async () => {
      const rateLimitError: any = new Error("Gemini stream 429");
      rateLimitError.status = 429;

      mockGeminiGenerateContentStream.mockRejectedValueOnce(rateLimitError);

      mockGroqCreate.mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: "Groq stream chunk" } }] };
        },
      });

      const chunks: string[] = [];
      const res = await routeChatStream({
        complexity: "complex",
        messages: [{ role: "user", content: "compare venues" }],
        onChunk: (text) => chunks.push(text),
      });

      expect(res.provider).toBe("groq");
      expect(res.text).toBe("Groq stream chunk");
      expect(chunks).toEqual(["Groq stream chunk"]);
      expect(mockGeminiGenerateContentStream).toHaveBeenCalledTimes(1);
      expect(mockGroqCreate).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // 4. Configuration and Credential Validation
  // =========================================================================
  describe("Configuration & Error handling", () => {
    it("fails clearly when Groq API key is missing", async () => {
      delete process.env.GROQ_API_KEY;

      await expect(
        executeProviderCompletion("groq", {
          messages: [{ role: "user", content: "hello" }],
        }),
      ).rejects.toThrow("GROQ_API_KEY is not configured");
    });

    it("fails clearly when Gemini API key is missing", async () => {
      delete process.env.GEMINI_API_KEY;

      await expect(
        executeProviderCompletion("gemini", {
          messages: [{ role: "user", content: "hello" }],
        }),
      ).rejects.toThrow("GEMINI_API_KEY is not configured");
    });

    it("fails clearly when an unsupported provider is requested", async () => {
      await expect(
        executeProviderCompletion("unsupported" as any, {
          messages: [{ role: "user", content: "hello" }],
        }),
      ).rejects.toThrow("Unsupported AI provider: unsupported");

      expect(() => getModelForProvider("unknown" as any)).toThrow(
        "Unsupported AI provider: unknown",
      );
    });

    it("identifies rate limit errors across various error shapes", () => {
      expect(isRateLimitError({ status: 429 })).toBe(true);
      expect(isRateLimitError({ statusCode: 429 })).toBe(true);
      expect(isRateLimitError({ status: "RESOURCE_EXHAUSTED" })).toBe(true);
      expect(isRateLimitError({ name: "RateLimitError" })).toBe(true);
      expect(isRateLimitError(new Error("Rate limit exceeded"))).toBe(true);
      expect(isRateLimitError(new Error("Resource exhausted (quota exceeded)"))).toBe(
        true,
      );
      expect(isRateLimitError(new Error("Internal Server Error"))).toBe(false);
      expect(isRateLimitError(null)).toBe(false);
    });

    it("returns correct model and fallback mapping", () => {
      expect(getModelForProvider("groq")).toBe(GROQ_MODEL);
      expect(getModelForProvider("gemini")).toBe(GEMINI_MODEL);
      expect(getFallbackProvider("groq")).toBe("gemini");
      expect(getFallbackProvider("gemini")).toBe("groq");
    });
  });
});
