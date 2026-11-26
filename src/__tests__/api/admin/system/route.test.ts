import { NextRequest } from "next/server";
import { GET } from "@/app/api/admin/system/route";
import { getAdminUser } from "@/lib/admin";
import { getAdminSystemMetrics } from "@/lib/adminSystemMetrics";
import { measureRedisLatencyMs } from "@/lib/redisHealth";

jest.mock("@/lib/admin", () => ({
  getAdminUser: jest.fn(),
}));

jest.mock("@/lib/adminSystemMetrics", () => ({
  getAdminSystemMetrics: jest.fn(),
  parseSystemRange: jest.fn((range) => (range === "7d" ? "7d" : "30d")),
}));

jest.mock("@/lib/redisHealth", () => ({
  measureRedisLatencyMs: jest.fn(),
}));

describe("Admin System API Redis health", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (getAdminSystemMetrics as jest.Mock).mockResolvedValue({
      range: "30d",
      overview: { totalSearches: 100 },
    });

    (measureRedisLatencyMs as jest.Mock).mockResolvedValue({
      ok: true,
      latencyMs: 12,
    });
  });

  it("rejects unauthenticated requests", async () => {
    (getAdminUser as jest.Mock).mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost/api/admin/system"),
    );

    expect(response.status).toBe(403);
    expect(measureRedisLatencyMs).not.toHaveBeenCalled();
  });

  it("includes Redis health and latency in the system response", async () => {
    (getAdminUser as jest.Mock).mockResolvedValue({ id: "admin-1" });

    const response = await GET(
      new NextRequest("http://localhost/api/admin/system?range=7d"),
    );

    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.redisHealth).toEqual({
      ok: true,
      latencyMs: 12,
    });
    expect(json.range).toBe("30d");
    expect(measureRedisLatencyMs).toHaveBeenCalledTimes(1);
  });

  it("returns system metrics when Redis is unavailable", async () => {
    (getAdminUser as jest.Mock).mockResolvedValue({ id: "admin-1" });
    (measureRedisLatencyMs as jest.Mock).mockResolvedValue({
      ok: false,
      latencyMs: null,
    });

    const response = await GET(
      new NextRequest("http://localhost/api/admin/system"),
    );

    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.overview.totalSearches).toBe(100);
    expect(json.redisHealth).toEqual({
      ok: false,
      latencyMs: null,
    });
  });
});
