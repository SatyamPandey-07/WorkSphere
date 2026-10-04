/**
 * Bounds added to /api/sync CRDT ingestion: batch count, payload budget and
 * entry shape are enforced before any base64 decoding or Y.applyUpdate runs.
 * Auth, Prisma, user ensure and check-in recording are mocked.
 */

import { POST } from "@/app/api/sync/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { recordCheckIn } from "@/lib/checkIn";
import * as Y from "yjs";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn().mockResolvedValue({ userId: "user-123" }),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    venue: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock("@/lib/auth", () => ({
  ensureUserExists: jest.fn(),
}));

jest.mock("@/lib/checkIn", () => ({
  recordCheckIn: jest.fn(),
  CHECK_IN_TTL_MS: 30 * 60 * 1000,
}));

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function tinyUpdate(): string {
  const doc = new Y.Doc();
  doc.getText("t").insert(0, "hi");
  const bytes = Y.encodeStateAsUpdate(doc);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

describe("POST /api/sync", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user-123" });
    (prisma.user.findUnique as unknown as jest.Mock).mockResolvedValue({
      crdtState: null,
    });
    (prisma.user.update as unknown as jest.Mock).mockResolvedValue({});
  });

  it("returns 401 without an authenticated session", async () => {
    (auth as unknown as jest.Mock).mockResolvedValueOnce({ userId: null });

    const res = await POST(makeRequest({ updates: [] }));

    expect(res.status).toBe(401);
  });

  it("returns 400 when the batch exceeds the update cap", async () => {
    const res = await POST(
      makeRequest({ updates: Array.from({ length: 101 }, () => tinyUpdate()) }),
    );

    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("returns 400 for a non string update entry", async () => {
    const res = await POST(makeRequest({ updates: [42] }));

    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("merges a valid update batch and persists state", async () => {
    const res = await POST(makeRequest({ updates: [tinyUpdate()] }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-123" },
      }),
    );
    expect(ensureUserExists).toHaveBeenCalledWith("user-123");
    expect(recordCheckIn).not.toHaveBeenCalled();
  });
});
