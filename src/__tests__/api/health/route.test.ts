import { GET } from "@/app/api/health/route";
import { prisma } from "@/lib/prisma";
import { getRedisPingLatency, pingRedis } from "@/lib/redis";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

const mockRedisPing = jest.fn();

jest.mock("@/lib/redis", () => ({
  pingRedis: jest.fn(async () => {
    await mockRedisPing();
    return 12;
  }),
  getRedisPingLatency: jest.fn(),
}));

describe("GET /api/health", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("includes Redis ping latency in diagnostics when requested", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ "?column?": 1 }]);
    mockRedisPing.mockResolvedValue("PONG");
    (getRedisPingLatency as jest.Mock).mockReturnValue(12);

    const request = new Request(
      "http://localhost/api/health?includeDiagnostics=true",
    );
    const response = await GET(request);
    const body = await response.json();

    expect(mockRedisPing).toHaveBeenCalledTimes(1);
    expect(body.redis.pingMs).toBe(12);
  });

  it("does not add Redis diagnostics when includeDiagnostics is false", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ "?column?": 1 }]);
    (pingRedis as jest.Mock).mockResolvedValue(12);

    const response = await GET(
      new Request("http://localhost/api/health"),
    );
    const body = await response.json();

    expect(body.redis).toBeUndefined();
  });
});
