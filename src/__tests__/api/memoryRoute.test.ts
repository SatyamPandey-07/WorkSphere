/**
 * POST /api/memory validates embedding shape against the vector(1024)
 * column and bounds content before any SQL runs. Auth and Prisma run
 * through mocks so only the validation layer is exercised.
 */

import { POST } from "@/app/api/memory/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn().mockResolvedValue({ userId: "user-123" }),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $executeRaw: jest.fn(),
  },
}));

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/memory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validEmbedding(): number[] {
  return Array.from({ length: 1024 }, (_, i) => i / 1024);
}

describe("POST /api/memory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user-123" });
    (prisma.$executeRaw as unknown as jest.Mock).mockResolvedValue(1);
  });

  it("returns 401 without an authenticated session", async () => {
    (auth as unknown as jest.Mock).mockResolvedValueOnce({ userId: null });

    const res = await POST(
      makeRequest({ content: "hello", embedding: validEmbedding() }),
    );

    expect(res.status).toBe(401);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("returns 400 when content is missing", async () => {
    const res = await POST(
      makeRequest({ embedding: validEmbedding() }),
    );

    expect(res.status).toBe(400);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("returns 400 when content exceeds the length cap", async () => {
    const res = await POST(
      makeRequest({ content: "x".repeat(20001), embedding: validEmbedding() }),
    );

    expect(res.status).toBe(400);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("returns 400 for an embedding of the wrong length", async () => {
    const res = await POST(
      makeRequest({ content: "hello", embedding: [0.1, 0.2] }),
    );

    expect(res.status).toBe(400);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("returns 400 for non finite embedding entries", async () => {
    const embedding = validEmbedding();
    embedding[0] = Number.NaN;

    const res = await POST(makeRequest({ content: "hello", embedding }));

    expect(res.status).toBe(400);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("stores a well formed memory", async () => {
    const res = await POST(
      makeRequest({ content: "hello", embedding: validEmbedding() }),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
