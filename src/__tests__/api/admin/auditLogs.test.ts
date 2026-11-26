import { NextRequest } from "next/server";
import { GET, parseLimit, parsePage, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "@/app/api/admin/audit-logs/route";
import * as adminAuth from "@/lib/admin";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/admin");
jest.mock("@/lib/prisma", () => ({
  prisma: {
    adminAuditLog: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}));

describe("Admin Audit Logs API (/api/admin/audit-logs)", () => {
  const mockAdmin = {
    id: "admin-user-1",
    role: "admin",
    email: "admin@worksphere.io",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (adminAuth.getAdminUser as jest.Mock).mockResolvedValue(mockAdmin);
    (prisma.adminAuditLog.findMany as jest.Mock).mockResolvedValue([
      {
        id: "log-1",
        adminId: "admin-user-1",
        action: "SEAT_RELEASE",
        entityType: "seat",
        entityId: "seat-123",
        details: '{"reason":"maintenance"}',
        createdAt: new Date("2026-11-20T10:00:00Z"),
      },
    ]);
    (prisma.adminAuditLog.count as jest.Mock).mockResolvedValue(1);
  });

  function createRequest(url: string) {
    return new NextRequest(new URL(url, "http://localhost:3000"));
  }

  describe("Unit: parseLimit helper", () => {
    it("case 1: defaults to 20 when limit is missing (null)", () => {
      expect(parseLimit(null)).toBe(20);
    });

    it("case 2: defaults to 20 when limit is an empty string", () => {
      expect(parseLimit("")).toBe(20);
      expect(parseLimit("   ")).toBe(20);
    });

    it("case 3: defaults to 20 when limit is non-numeric string 'abc'", () => {
      expect(parseLimit("abc")).toBe(20);
      expect(parseLimit("invalid-number")).toBe(20);
    });

    it("case 4: defaults to 20 when limit is '0'", () => {
      expect(parseLimit("0")).toBe(20);
    });

    it("case 5: clamps negative limit '-10' to 1", () => {
      expect(parseLimit("-10")).toBe(1);
      expect(parseLimit("-1")).toBe(1);
      expect(parseLimit("-999")).toBe(1);
    });

    it("case 6: respects valid limit '1'", () => {
      expect(parseLimit("1")).toBe(1);
    });

    it("case 7: respects valid limit '50'", () => {
      expect(parseLimit("50")).toBe(50);
    });

    it("case 8: respects valid maximum boundary '100'", () => {
      expect(parseLimit("100")).toBe(100);
    });

    it("case 9: clamps '101' down to 100", () => {
      expect(parseLimit("101")).toBe(100);
    });

    it("case 10: clamps '5000' down to 100", () => {
      expect(parseLimit("5000")).toBe(100);
    });

    it("case 11: clamps extremely large number '1000000' to 100", () => {
      expect(parseLimit("1000000")).toBe(100);
      expect(parseLimit("999999999999")).toBe(100);
    });

    it("case 12: parses decimal string '1.5' as integer 1", () => {
      expect(parseLimit("1.5")).toBe(1);
      expect(parseLimit("50.9")).toBe(50);
    });
  });

  describe("Unit: parsePage helper", () => {
    it("case 13: defaults to 1 when page is null or empty", () => {
      expect(parsePage(null)).toBe(1);
      expect(parsePage("")).toBe(1);
      expect(parsePage("  ")).toBe(1);
    });

    it("case 14: defaults to 1 when page is non-numeric or invalid", () => {
      expect(parsePage("xyz")).toBe(1);
    });

    it("case 15: defaults to 1 when page is 0 or negative", () => {
      expect(parsePage("0")).toBe(1);
      expect(parsePage("-5")).toBe(1);
    });

    it("case 16: parses valid page numbers correctly", () => {
      expect(parsePage("1")).toBe(1);
      expect(parsePage("5")).toBe(5);
      expect(parsePage("42")).toBe(42);
    });

    it("case 17: caps huge page numbers safely", () => {
      expect(parsePage("99999999")).toBe(100_000);
    });
  });

  describe("Endpoint: GET /api/admin/audit-logs", () => {
    it("case 18: clamps requested limit=5000 to take: 100 in Prisma query", async () => {
      const req = createRequest("/api/admin/audit-logs?limit=5000");
      const res = await GET(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.pagination.limit).toBe(100);

      expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 100,
          skip: 0,
        }),
      );
    });

    it("case 19: defaults missing limit to take: 20 in Prisma query", async () => {
      const req = createRequest("/api/admin/audit-logs");
      const res = await GET(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.pagination.limit).toBe(20);

      expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 20,
          skip: 0,
        }),
      );
    });

    it("case 20: calculates correct skip for page 3 with limit 25", async () => {
      const req = createRequest("/api/admin/audit-logs?page=3&limit=25");
      const res = await GET(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.pagination.page).toBe(3);
      expect(json.pagination.limit).toBe(25);

      expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 25,
          skip: 50,
        }),
      );
    });

    it("case 21: handles pagination metadata correctly (total, totalPages, hasNextPage)", async () => {
      (prisma.adminAuditLog.count as jest.Mock).mockResolvedValue(105);
      (prisma.adminAuditLog.findMany as jest.Mock).mockResolvedValue(new Array(20).fill({ id: "log" }));

      const req = createRequest("/api/admin/audit-logs?page=1&limit=20");
      const res = await GET(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 105,
        totalPages: 6,
        hasNextPage: true,
      });
    });

    it("case 22: returns 403 Forbidden if user is not an admin", async () => {
      (adminAuth.getAdminUser as jest.Mock).mockResolvedValue(null);

      const req = createRequest("/api/admin/audit-logs");
      const res = await GET(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toBe("Admin access required");
      expect(prisma.adminAuditLog.findMany).not.toHaveBeenCalled();
    });

    it("case 23: applies filters for action and adminId", async () => {
      const req = createRequest("/api/admin/audit-logs?action=USER_SUSPEND&adminId=adm-99");
      const res = await GET(req);
      expect(res.status).toBe(200);

      expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            action: "USER_SUSPEND",
            adminId: "adm-99",
          }),
        }),
      );
    });

    it("case 24: clamps negative limit -50 to take: 1", async () => {
      const req = createRequest("/api/admin/audit-logs?limit=-50");
      const res = await GET(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.pagination.limit).toBe(1);
      expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 1,
        }),
      );
    });

    it("case 25: handles database failure gracefully with 500 status", async () => {
      (prisma.adminAuditLog.findMany as jest.Mock).mockRejectedValue(new Error("Database connection failure"));

      const req = createRequest("/api/admin/audit-logs");
      const res = await GET(req);
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe("Failed to query audit logs");
    });
  });
});
