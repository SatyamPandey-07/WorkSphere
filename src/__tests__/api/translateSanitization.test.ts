/**
 * Tests for the rate limiting and input validation added to /api/translate.
 * Uses mock auth and Groq to test the validation layer only.
 */

import { POST } from "@/app/api/translate/route";
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { rateLimit } from "@/lib/rateLimit";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn().mockResolvedValue({ userId: "user-123" }),
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockResolvedValue(true),
}));

// Don't actually call Groq
jest.mock("groq-sdk", () => ({
  __esModule: true,
  Groq: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{ message: { content: "Bonjour monde" } }],
        }),
      },
    },
  })),
}));

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/translate validation", () => {
  it("returns 400 when text is missing", async () => {
    const resp = await POST(makeRequest({ targetLanguage: "fr" }));
    expect(resp.status).toBe(400);
  });

  it("returns 400 when targetLanguage is missing", async () => {
    const resp = await POST(makeRequest({ text: "Hello" }));
    expect(resp.status).toBe(400);
  });

  it("returns 400 when text exceeds 2000 characters", async () => {
    const resp = await POST(
      makeRequest({ text: "a".repeat(2001), targetLanguage: "fr" }),
    );
    expect(resp.status).toBe(400);
  });

  it("returns 400 for unsupported target language", async () => {
    const resp = await POST(
      makeRequest({ text: "Hello", targetLanguage: "klingon" }),
    );
    expect(resp.status).toBe(400);
  });

  it("returns 200 for valid request with supported language", async () => {
    const resp = await POST(
      makeRequest({ text: "Hello world", targetLanguage: "fr" }),
    );
    expect(resp.status).toBe(200);
  });

  it("returns 200 for 'french' (case-insensitive language name)", async () => {
    const resp = await POST(
      makeRequest({ text: "Hello", targetLanguage: "French" }),
    );
    expect(resp.status).toBe(200);
  });

  it("returns 429 when rate limit exceeded", async () => {
    (rateLimit as unknown as jest.Mock).mockResolvedValueOnce(false);

    const resp = await POST(
      makeRequest({ text: "Hello", targetLanguage: "es" }),
    );
    expect(resp.status).toBe(429);
  });

  it("returns 401 when not authenticated", async () => {
    (auth as unknown as jest.Mock).mockResolvedValueOnce({ userId: null });

    const resp = await POST(
      makeRequest({ text: "Hello", targetLanguage: "de" }),
    );
    expect(resp.status).toBe(401);
  });
});
