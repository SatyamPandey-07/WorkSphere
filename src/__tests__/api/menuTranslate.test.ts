/**
 * Guards added to /api/menu-translate: JSON body parsing, text length cap,
 * target-language allowlist and per-user rate limiting. Auth, the rate limiter
 * and the outbound fetch are all mocked so only the validation layer runs.
 */

import { POST } from "@/app/api/menu-translate/route";
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { rateLimit } from "@/lib/rateLimit";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn().mockResolvedValue({ userId: "user-123" }),
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockResolvedValue(true),
}));

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/menu-translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeRawRequest(raw: string): NextRequest {
  return new NextRequest("http://localhost/api/menu-translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw,
  });
}

const mockFetch = jest.fn();

describe("POST /api/menu-translate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user-123" });
    (rateLimit as unknown as jest.Mock).mockResolvedValue(true);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([[["Hola mundo", "Hello", null, null, 10]], null, "en"]),
    });
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it("returns 401 when unauthenticated", async () => {
    (auth as unknown as jest.Mock).mockResolvedValueOnce({ userId: null });
    const res = await POST(
      makeRequest({ text: "Hello", targetLanguage: "Spanish" }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    (rateLimit as unknown as jest.Mock).mockResolvedValueOnce(false);
    const res = await POST(
      makeRequest({ text: "Hello", targetLanguage: "Spanish" }),
    );
    expect(res.status).toBe(429);
  });

  it("returns 400 for a malformed JSON body", async () => {
    const res = await POST(makeRawRequest("{"));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid JSON body");
  });

  it("returns 400 when text is missing", async () => {
    const res = await POST(makeRequest({ targetLanguage: "Spanish" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when text is not a string", async () => {
    const res = await POST(
      makeRequest({ text: 42, targetLanguage: "Spanish" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for oversized text without calling the upstream", async () => {
    const res = await POST(
      makeRequest({ text: "a".repeat(2001), targetLanguage: "Spanish" }),
    );
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 400 for an unsupported language name", async () => {
    const res = await POST(
      makeRequest({ text: "Hello", targetLanguage: "klingon" }),
    );
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects a crafted language value instead of forwarding it upstream", async () => {
    const res = await POST(
      makeRequest({ text: "Hello", targetLanguage: "fr&key=leak" }),
    );
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("translates when the target is a mapped display name", async () => {
    const res = await POST(
      makeRequest({ text: "Hello", targetLanguage: "French" }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.translatedText).toBe("Hola mundo");
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("tl=fr");
    expect(calledUrl).toContain("q=Hello");
  });

  it("accepts a plain ISO code and lowercases it", async () => {
    const res = await POST(
      makeRequest({ text: "Hello", targetLanguage: "PT-BR" }),
    );
    expect(res.status).toBe(200);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("tl=pt-br");
  });

  it("returns 500 when the upstream translation fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({}),
    });
    const res = await POST(
      makeRequest({ text: "Hello", targetLanguage: "Spanish" }),
    );
    expect(res.status).toBe(500);
  });
});
