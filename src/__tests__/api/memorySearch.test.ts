/**
 * POST /api/memory/search bounds query length and clamps numeric options
 * before embedding generation runs. Auth and the search lib run through
 * mocks so only the route validation is exercised.
 */

import { POST } from "@/app/api/memory/search/route";
import { auth } from "@clerk/nextjs/server";
import { searchUserMemories } from "@/lib/memory";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn().mockResolvedValue({ userId: "user-123" }),
}));

jest.mock("@/lib/memory", () => ({
  searchUserMemories: jest.fn(),
}));

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/memory/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/memory/search", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user-123" });
    (searchUserMemories as unknown as jest.Mock).mockResolvedValue([]);
  });

  it("returns 401 without an authenticated session", async () => {
    (auth as unknown as jest.Mock).mockResolvedValueOnce({ userId: null });

    const res = await POST(makeRequest({ query: "quiet corners" }));

    expect(res.status).toBe(401);
    expect(searchUserMemories).not.toHaveBeenCalled();
  });

  it("returns 400 when query is missing", async () => {
    const res = await POST(makeRequest({}));

    expect(res.status).toBe(400);
    expect(searchUserMemories).not.toHaveBeenCalled();
  });

  it("returns 400 for an oversized query", async () => {
    const res = await POST(makeRequest({ query: "x".repeat(1001) }));

    expect(res.status).toBe(400);
    expect(searchUserMemories).not.toHaveBeenCalled();
  });

  it("returns 400 for a non numeric limit", async () => {
    const res = await POST(
      makeRequest({ query: "quiet corners", limit: "many" }),
    );

    expect(res.status).toBe(400);
    expect(searchUserMemories).not.toHaveBeenCalled();
  });

  it("returns 400 for a limit outside the allowed range", async () => {
    const res = await POST(
      makeRequest({ query: "quiet corners", limit: 5000 }),
    );

    expect(res.status).toBe(400);
    expect(searchUserMemories).not.toHaveBeenCalled();
  });

  it("returns 400 for a threshold outside 0 to 1", async () => {
    const res = await POST(
      makeRequest({ query: "quiet corners", threshold: 7 }),
    );

    expect(res.status).toBe(400);
    expect(searchUserMemories).not.toHaveBeenCalled();
  });

  it("searches with parsed options for a valid request", async () => {
    (searchUserMemories as unknown as jest.Mock).mockResolvedValue([
      { id: "m1", content: "quiet corner", similarity: 0.9 },
    ]);

    const res = await POST(
      makeRequest({ query: "quiet corners", limit: 10, threshold: 0.6 }),
    );

    expect(res.status).toBe(200);
    expect(searchUserMemories).toHaveBeenCalledWith("user-123", "quiet corners", {
      limit: 10,
      similarityThreshold: 0.6,
    });
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.count).toBe(1);
  });
});
