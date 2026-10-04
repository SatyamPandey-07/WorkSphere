import { GoogleGenAI } from "@google/genai";
import {
  GEMINI_MODEL,
  generateGeminiStream,
  generateGeminiText,
} from "@/lib/ai/gemini";

const mockGenerateContent = jest.fn();
const mockGenerateContentStream = jest.fn();

jest.mock("@google/genai", () => ({
  GoogleGenAI: jest.fn(() => ({
    models: {
      generateContent: mockGenerateContent,
      generateContentStream: mockGenerateContentStream,
    },
  })),
}));

const originalApiKey = process.env.GEMINI_API_KEY;

describe("Gemini client", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GEMINI_API_KEY = "test-gemini-key";
  });

  afterAll(() => {
    if (originalApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalApiKey;
    }
  });

  it("returns trimmed text from a single generation call", async () => {
    mockGenerateContent.mockResolvedValue({ text: "  hello world  " });

    await expect(generateGeminiText("hi")).resolves.toBe("hello world");
    expect(GoogleGenAI).toHaveBeenCalledWith({ apiKey: "test-gemini-key" });
    expect(mockGenerateContent).toHaveBeenCalledWith({
      model: GEMINI_MODEL,
      contents: "hi",
    });
  });

  it("throws when the API key is missing", async () => {
    delete process.env.GEMINI_API_KEY;

    await expect(generateGeminiText("hi")).rejects.toThrow(
      "GEMINI_API_KEY is not configured",
    );
  });

  it("throws when the model returns blank text", async () => {
    mockGenerateContent.mockResolvedValue({ text: "   " });

    await expect(generateGeminiText("hi")).rejects.toThrow(
      "Gemini returned an empty response",
    );
  });

  it("yields streamed chunks in order and skips empty ones", async () => {
    mockGenerateContentStream.mockResolvedValue(
      (async function* () {
        yield { text: "Hel" };
        yield { text: "" };
        yield { text: "lo" };
      })(),
    );

    const chunks: string[] = [];
    for await (const chunk of generateGeminiStream("hi")) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["Hel", "lo"]);
    expect(mockGenerateContentStream).toHaveBeenCalledWith({
      model: GEMINI_MODEL,
      contents: "hi",
    });
  });

  it("propagates stream errors to the caller", async () => {
    mockGenerateContentStream.mockRejectedValue(new Error("quota exceeded"));

    const iterate = generateGeminiStream("hi");

    await expect(iterate.next()).rejects.toThrow("quota exceeded");
  });
});
