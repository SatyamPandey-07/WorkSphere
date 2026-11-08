import {
  GET,
  sanitizeTelemetryPayload,
} from "@/app/api/admin/system/diagnostics/route";
import { getAdminUser } from "@/lib/admin";
import { getAdminSystemMetrics } from "@/lib/adminSystemMetrics";

jest.mock("@/lib/admin", () => ({
  getAdminUser: jest.fn(),
}));

jest.mock("@/lib/adminSystemMetrics", () => ({
  getAdminSystemMetrics: jest.fn(),
}));

describe("Admin Diagnostics Export API (#4412)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("sanitizeTelemetryPayload", () => {
    it("redacts sensitive emails, bearer tokens, and secrets", () => {
      const sensitiveData = {
        user: {
          email: "admin@worksphere.com",
          apiKey: "secret_1234567890abcdef",
        },
        authHeader:
          "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummytoken123456",
        metrics: {
          cpu: "45%",
        },
      };

      const sanitized = sanitizeTelemetryPayload(
        sensitiveData,
      ) as typeof sensitiveData;
      expect(sanitized.user.email).toBe("[REDACTED_EMAIL]");
      expect(sanitized.user.apiKey).toBe("[REDACTED]");
      expect(sanitized.authHeader).toContain("[REDACTED_TOKEN]");
      expect(sanitized.metrics.cpu).toBe("45%");
    });
  });

  describe("GET /api/admin/system/diagnostics", () => {
    it("rejects unauthorized non-admin users with 403", async () => {
      (getAdminUser as jest.Mock).mockResolvedValue(null);

      const res = await GET();
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("Admin access required");
    });

    it("exports sanitized diagnostics report and logs audit entry for admin", async () => {
      const consoleSpy = jest
        .spyOn(console, "info")
        .mockImplementation(() => {});

      (getAdminUser as jest.Mock).mockResolvedValue({
        id: "admin_user_99",
        email: "admin@worksphere.internal",
      });

      (getAdminSystemMetrics as jest.Mock).mockResolvedValue({
        range: "30d",
        overview: {
          totalSearches: 1500,
          totalVenueClicks: 800,
          totalReviews: 240,
        },
        dbLatency: {
          totalQueryCount: 5000,
          slowQueryCount: 12,
        },
      });

      const res = await GET();
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/json");
      expect(res.headers.get("Content-Disposition")).toContain(
        "worksphere-diagnostics-",
      );

      const text = await res.text();
      const report = JSON.parse(text);

      expect(report.reportType).toBe(
        "WorkSphere Diagnostics & Telemetry Report",
      );
      expect(report.status).toBe("HEALTHY");
      expect(report.exportedByAdminId).toBe("admin_user_99");
      expect(report.systemMetrics.overview.totalSearches).toBe(1500);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[AUDIT] Admin admin_user_99 exported telemetry diagnostics report",
        ),
      );

      consoleSpy.mockRestore();
    });

    it("returns 500 on unexpected system metrics error", async () => {
      (getAdminUser as jest.Mock).mockResolvedValue({
        id: "admin_user_99",
      });

      (getAdminSystemMetrics as jest.Mock).mockRejectedValue(
        new Error("Metrics collection failure"),
      );

      const res = await GET();
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Failed to generate diagnostic report");
    });
  });
});
