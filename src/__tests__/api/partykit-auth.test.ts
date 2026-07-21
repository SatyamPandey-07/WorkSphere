import { NextRequest } from "next/server";
import { GET } from "@/app/api/partykit/auth/route";
import { prisma } from "@/lib/prisma";
import { resetRateLimit } from "@/lib/rateLimit";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    folderMember: {
      findUnique: jest.fn(),
    },
    folder: {
      findUnique: jest.fn(),
    },
  },
}));

describe("GET /api/partykit/auth - Rate Limiting", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimit();
  });

  it("should allow requests under the limit (30 req/min)", async () => {
    (prisma.folderMember.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.folder.findUnique as jest.Mock).mockResolvedValue(null);

    for (let i = 0; i < 30; i++) {
      const req = new NextRequest(
        "http://localhost/api/partykit/auth?userId=u1&folderId=f1",
      );
      const res = await GET(req);
      expect(res.status).toBe(200);
    }
  });

  it("should return 429 when exceeding the limit (30 req/min)", async () => {
    (prisma.folderMember.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.folder.findUnique as jest.Mock).mockResolvedValue(null);

    let lastRes;
    for (let i = 0; i < 31; i++) {
      const req = new NextRequest(
        "http://localhost/api/partykit/auth?userId=u1&folderId=f1",
      );
      lastRes = await GET(req);
    }

    expect(lastRes!.status).toBe(429);
    const data = await lastRes!.json();
    expect(data.error).toMatch(/too many/i);
    expect(data.retryAfter).toBeDefined();
  });
});
