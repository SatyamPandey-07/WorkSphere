import { GoogleGenAI } from "@google/genai";

export const GEMINI_MODEL = "gemini-3.6-flash";

let geminiClient: GoogleGenAI | null = null;

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey });
  }

  return geminiClient;
}

export async function generateGeminiText(prompt: string): Promise<string> {
  const gemini = getGeminiClient();

  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
  });

  const text = response.text?.trim();

  if (!text) {
    throw new Error("Gemini returned an empty response");
  }

  return text;
}

/**
 * Yields Gemini output as soon as each chunk arrives so callers can flush
 * partial text to the client without waiting for the whole completion.
 *
 * Network, quota and safety errors are surfaced to the caller; this function
 * does not swallow them, because the caller decides whether to retry with the
 * non-streaming path.
 */
export async function* generateGeminiStream(
  prompt: string,
): AsyncGenerator<string, void, unknown> {
  const gemini = getGeminiClient();

  const stream = await gemini.models.generateContentStream({
    model: GEMINI_MODEL,
    contents: prompt,
  });

  for await (const chunk of stream) {
    const text = chunk.text;
    if (text) {
      yield text;
    }
  }
}