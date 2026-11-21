/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { GET } from "@/app/api/zkp/deepwork/route";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/db", () => ({
  db: {
    deepWorkCredential: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

const mockAuth = auth as unknown as jest.Mock;
const mockFindUnique = db.deepWorkCredential.findUnique as jest.Mock;
const mockFindFirst = db.deepWorkCredential.findFirst as jest.Mock;
const mockFindMany = db.deepWorkCredential.findMany as jest.Mock;

function makeRequest(sessionId?: string): NextRequest {
  const url = new URL("http://localhost:3000/api/zkp/deepwork");

  if (sessionId) {
    url.searchParams.set("sessionId", sessionId);
  }

  return new NextRequest(url);
}

describe("GET /api/zkp/deepwork - credential ownership", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "user-a" });
  });

  it("allows an authenticated owner to retrieve their credential", async () => {
    const credential = {
      id: "credential-1",
      userId: "user-a",
      sessionId: "session-1",
      durationMinutes: 60,
      focusThreshold: 90,
      commitmentHash: "commitment-1",
      proofData: "{}",
      mintedAt: new Date("2026-01-01T00:00:00.000Z"),
    };

    mockFindUnique.mockResolvedValue(credential);
    mockFindFirst.mockResolvedValue(credential);

    const response = await GET(makeRequest("session-1"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      credential: {
        ...credential,
        mintedAt: credential.mintedAt.toISOString(),
      },
    });

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: {
        sessionId: "session-1",
        userId: "user-a",
      },
    });
  });

  it("does not expose another user's credential", async () => {
    const foreignCredential = {
      id: "credential-2",
      userId: "user-b",
      sessionId: "another-users-session",
      durationMinutes: 90,
      focusThreshold: 95,
      commitmentHash: "commitment-2",
      proofData: "{}",
      mintedAt: new Date("2026-01-02T00:00:00.000Z"),
    };

    mockFindUnique.mockResolvedValue(foreignCredential);
    mockFindFirst.mockResolvedValue(null);

    const response = await GET(makeRequest("another-users-session"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Credential not found",
    });

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: {
        sessionId: "another-users-session",
        userId: "user-a",
      },
    });
  });

  it("returns 401 when the requester is unauthenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const response = await GET(makeRequest("session-1"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Unauthorized",
    });

    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("continues to scope credential lists to the authenticated user", async () => {
    const credentials = [
      {
        id: "credential-1",
        userId: "user-a",
        sessionId: "session-1",
      },
    ];

    mockFindMany.mockResolvedValue(credentials);

    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      credentials,
      totalSessions: 1,
    });

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { userId: "user-a" },
      orderBy: { mintedAt: "desc" },
      take: 50,
    });
  });
});
