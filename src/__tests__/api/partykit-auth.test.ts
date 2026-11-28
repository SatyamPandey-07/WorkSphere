import { NextRequest } from "next/server";
import { GET, OPTIONS } from "@/app/api/partykit/auth/route";
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

const TEST_SHARED_SECRET = "test-partykit-shared-secret";

function authedRequest(url: string): NextRequest {
  return new NextRequest(url, {
    headers: { authorization: `Bearer ${TEST_SHARED_SECRET}` },
  });
}

describe("GET /api/partykit/auth - Rate Limiting", () => {
  const originalSecret = process.env.PARTYKIT_SHARED_SECRET;

  beforeAll(() => {
    process.env.PARTYKIT_SHARED_SECRET = TEST_SHARED_SECRET;
  });

  afterAll(() => {
    process.env.PARTYKIT_SHARED_SECRET = originalSecret;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimit();
  });

  it("should allow requests under the limit (30 req/min)", async () => {
    (prisma.folderMember.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.folder.findUnique as jest.Mock).mockResolvedValue(null);

    for (let i = 0; i < 30; i++) {
      const req = authedRequest(
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
      const req = authedRequest(
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

describe("OPTIONS /api/partykit/auth - CORS", () => {
  it("allows Flutter client headers and preserves existing preflight behavior", async () => {
    const req = new NextRequest("http://localhost/api/partykit/auth", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "GET",
        "access-control-request-headers":
          "authorization,content-type,user-agent,x-worksphere-platform,x-worksphere-app-version",
      },
    });

    const response = await OPTIONS(req);
    const allowedHeaders = response.headers
      .get("Access-Control-Allow-Headers")
      ?.split(",")
      .map((header) => header.trim().toLowerCase());

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:3000",
    );
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET, OPTIONS",
    );
    expect(response.headers.get("Access-Control-Max-Age")).toBe("86400");
    expect(allowedHeaders).toEqual(
      expect.arrayContaining([
        "authorization",
        "content-type",
        "user-agent",
        "x-worksphere-platform",
        "x-worksphere-app-version",
      ]),
    );
  });
});
