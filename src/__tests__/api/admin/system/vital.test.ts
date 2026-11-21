import { NextRequest } from "next/server";
import { GET } from "@/app/api/admin/vitals/route";
import { getAdminUser } from "@/lib/admin";
import {
  buildSystemVitalsSnapshot,
  formatSystemVitalsPrometheus,
} from "@/lib/export/domain/systemVitalExporter";

jest.mock("@/lib/admin", () => ({
  getAdminUser: jest.fn(),
}));

jest.mock("@/lib/export/domain/systemVitalExporter", () => ({
  buildSystemVitalsSnapshot: jest.fn(),
  formatSystemVitalsPrometheus: jest.fn(),
  sharedVitalsBuffer: {},
}));

const mockedGetAdminUser = jest.mocked(getAdminUser);
const mockedBuildSystemVitalsSnapshot = jest.mocked(buildSystemVitalsSnapshot);
const mockedFormatSystemVitalsPrometheus = jest.mocked(
  formatSystemVitalsPrometheus,
);

const mockSnapshot = {
  generatedAt: "2026-11-21T10:00:00.000Z",
  windowSeconds: 300,
  uptimeSeconds: 120,
  memoryBytes: {
    rss: 1000,
    heapTotal: 800,
    heapUsed: 500,
    external: 100,
  },
  latency: {
    overall: {
      count: 1,
      avgMs: 20,
      minMs: 20,
      maxMs: 20,
      p50Ms: 20,
      p95Ms: 20,
      p99Ms: 20,
    },
    byRoute: [],
  },
};

const mockAdmin = {
  id: "user_admin_01",
  role: "ADMIN",
  email: "admin@worksphere.app",
};

describe("GET /api/admin/vitals", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedGetAdminUser.mockResolvedValue(mockAdmin as never);
    mockedBuildSystemVitalsSnapshot.mockReturnValue(mockSnapshot);
    mockedFormatSystemVitalsPrometheus.mockReturnValue(
      "worksphere_http_request_duration_ms 20\n",
    );
  });

  test("returns 403 for unauthenticated JSON requests", async () => {
    mockedGetAdminUser.mockResolvedValueOnce(null);

    const req = new NextRequest("http://localhost:3000/api/admin/vitals");
    const res = await GET(req);

    expect(mockedGetAdminUser).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Admin access required",
    });
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(mockedBuildSystemVitalsSnapshot).not.toHaveBeenCalled();
  });

  test("returns 403 for unauthenticated Prometheus requests", async () => {
    mockedGetAdminUser.mockResolvedValueOnce(null);

    const req = new NextRequest(
      "http://localhost:3000/api/admin/vitals?format=prometheus",
      {
        headers: {
          Accept: "text/plain; version=0.0.4",
        },
      },
    );
    const res = await GET(req);

    expect(mockedGetAdminUser).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Admin access required",
    });
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(mockedBuildSystemVitalsSnapshot).not.toHaveBeenCalled();
  });

  test("returns 200 with system vitals JSON for an authenticated admin", async () => {
    const req = new NextRequest("http://localhost:3000/api/admin/vitals");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(mockSnapshot);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(mockedBuildSystemVitalsSnapshot).toHaveBeenCalledTimes(1);
  });

  test("returns 200 with Prometheus metrics for an authenticated admin", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/admin/vitals?format=prometheus",
    );
    const res = await GET(req);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(body).toContain("worksphere_http_request_duration_ms");
    expect(mockedFormatSystemVitalsPrometheus).toHaveBeenCalledTimes(1);
  });

  test("returns 500 when snapshot generation fails for an authenticated admin", async () => {
    mockedBuildSystemVitalsSnapshot.mockImplementationOnce(() => {
      throw new Error("Internal snapshot failure");
    });

    const req = new NextRequest("http://localhost:3000/api/admin/vitals");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({
      error: "Failed to generate system vitals",
    });
    expect(JSON.stringify(body)).not.toContain("Internal snapshot failure");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  test("returns 500 when Prometheus formatting fails for an authenticated admin", async () => {
    mockedFormatSystemVitalsPrometheus.mockImplementationOnce(() => {
      throw new Error("Internal formatting failure");
    });

    const req = new NextRequest(
      "http://localhost:3000/api/admin/vitals?format=prometheus",
    );
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({
      error: "Failed to generate system vitals",
    });
    expect(JSON.stringify(body)).not.toContain("Internal formatting failure");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  test("returns 500 when the authorization provider throws", async () => {
    mockedGetAdminUser.mockRejectedValueOnce(
      new Error("Internal authorization failure"),
    );

    const req = new NextRequest("http://localhost:3000/api/admin/vitals");
    const res = await GET(req);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Failed to generate system vitals",
    });
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(mockedBuildSystemVitalsSnapshot).not.toHaveBeenCalled();
  });
});
