import { NextRequest } from "next/server";
import {
  validateIso8601Timestamp,
  parseIso8601Timestamp,
  isValidIso8601Timestamp,
  constructAuditLogFilterConditions,
  buildAuditLogFilterConditions,
  ISO_8601_REGEX,
} from "@/app/api/admin/system/partitions/dateHelper";
import { GET as getAuditLogs } from "@/app/api/admin/system/partitions/audit/route";
import {
  GET as exportPartitions,
  HEAD as headPartitions,
} from "@/app/api/admin/system/partitions/export/route";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/admin", () => ({
  getAdminUser: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: jest.fn(),
  },
}));

describe("Audit Log Partition Multi-Criteria Filters", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe("ISO 8601 Timestamp Validation Helper", () => {
    it("validates regex pattern for full and partial ISO 8601 timestamps", () => {
      expect(ISO_8601_REGEX.test("2026-10-12T02:14:05.123Z")).toBe(true);
      expect(ISO_8601_REGEX.test("2026-10-12T02:14:05Z")).toBe(true);
      expect(ISO_8601_REGEX.test("2026-10-12T02:14:05+05:30")).toBe(true);
      expect(ISO_8601_REGEX.test("2026-10-12T02:14:05-08:00")).toBe(true);
      expect(ISO_8601_REGEX.test("2026-10-12T02:14:05")).toBe(true);
      expect(ISO_8601_REGEX.test("2026-10-12")).toBe(true);

      expect(ISO_8601_REGEX.test("invalid")).toBe(false);
      expect(ISO_8601_REGEX.test("2026/10/12")).toBe(false);
      expect(ISO_8601_REGEX.test("2026-10-12 02:14:05.12345678901Z")).toBe(
        false,
      );
    });

    it("parses valid ISO 8601 timestamps into Date objects", () => {
      const parsed = validateIso8601Timestamp("2026-10-12T14:30:00.000Z");
      expect(parsed).toBeInstanceOf(Date);
      expect(parsed?.toISOString()).toBe("2026-10-12T14:30:00.000Z");
      expect(isValidIso8601Timestamp("2026-10-12T14:30:00.000Z")).toBe(true);
    });

    it("returns null or throws for invalid calendar and clock timestamps", () => {
      expect(validateIso8601Timestamp("2026-13-10T12:00:00Z")).toBeNull();
      expect(validateIso8601Timestamp("2026-02-30T12:00:00Z")).toBeNull();
      expect(validateIso8601Timestamp("2025-02-29T12:00:00Z")).toBeNull(); // 2025 non-leap
      expect(validateIso8601Timestamp("2026-10-12T25:00:00Z")).toBeNull();
      expect(validateIso8601Timestamp("2026-10-12T12:60:00Z")).toBeNull();

      expect(() => parseIso8601Timestamp("2026-13-10T12:00:00Z")).toThrow(
        /Invalid calendar date in timestamp/,
      );
      expect(() => parseIso8601Timestamp("2026-10-12T25:00:00Z")).toThrow(
        /Invalid time in timestamp/,
      );
    });
  });

  describe("constructAuditLogFilterConditions helper", () => {
    it("constructs indexed SQL filter conditions for all criteria", () => {
      const filters = constructAuditLogFilterConditions({
        actorId: "admin-uuid-1",
        startDate: "2026-10-01T00:00:00Z",
        endDate: "2026-10-31T23:59:59Z",
        actionType: "DELETE_PARTITION",
      });

      expect(filters.conditions).toHaveLength(4);
      expect(filters.conditions[0]).toBe('"createdAt" >= $1::timestamp');
      expect(filters.conditions[1]).toBe('"createdAt" <= $2::timestamp');
      expect(filters.conditions[2]).toBe('"adminId" = $3');
      expect(filters.conditions[3]).toBe('"action" = $4');

      expect(filters.whereClause).toBe(
        'WHERE "createdAt" >= $1::timestamp AND "createdAt" <= $2::timestamp AND "adminId" = $3 AND "action" = $4',
      );
      expect(filters.params).toEqual([
        new Date("2026-10-01T00:00:00Z").toISOString(),
        new Date("2026-10-31T23:59:59Z").toISOString(),
        "admin-uuid-1",
        "DELETE_PARTITION",
      ]);
      expect(filters.nextParamIndex).toBe(5);
    });

    it("supports alias buildAuditLogFilterConditions and custom startParamIndex", () => {
      const filters = buildAuditLogFilterConditions({
        adminId: "admin-42",
        action: "ARCHIVE_PARTITION",
        startParamIndex: 3,
      });

      expect(filters.conditions[0]).toBe('"adminId" = $3');
      expect(filters.conditions[1]).toBe('"action" = $4');
      expect(filters.whereClause).toBe(
        'WHERE "adminId" = $3 AND "action" = $4',
      );
      expect(filters.nextParamIndex).toBe(5);
    });

    it("returns empty whereClause when no options are provided", () => {
      const filters = constructAuditLogFilterConditions({});
      expect(filters.conditions).toEqual([]);
      expect(filters.whereClause).toBe("");
      expect(filters.params).toEqual([]);
      expect(filters.nextParamIndex).toBe(1);
    });
  });

  describe("GET /api/admin/system/partitions/audit endpoint", () => {
    it("rejects non-admin access with 403", async () => {
      (getAdminUser as jest.Mock).mockResolvedValue(null);

      const req = new NextRequest(
        "http://localhost:3000/api/admin/system/partitions/audit",
      );
      const res = await getAuditLogs(req);

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("Admin access required");
    });

    it("validates invalid ISO 8601 timestamps with 400 Bad Request", async () => {
      (getAdminUser as jest.Mock).mockResolvedValue({ id: "admin-1" });

      const req = new NextRequest(
        "http://localhost:3000/api/admin/system/partitions/audit?startDate=invalid-iso",
      );
      const res = await getAuditLogs(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Invalid startDate format");
    });

    it("executes multi-criteria query with actorId, date range, and actionType", async () => {
      (getAdminUser as jest.Mock).mockResolvedValue({ id: "admin-1" });
      const mockAuditLogs = [
        {
          id: "log-1",
          adminId: "admin-123",
          action: "CREATE_PARTITION",
          entityType: "Partition",
          entityId: "WifiTelemetry_y2026m11",
          details: '{"table":"WifiTelemetry"}',
          createdAt: new Date("2026-10-12T10:00:00Z"),
        },
      ];
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce(
        mockAuditLogs,
      );

      const req = new NextRequest(
        "http://localhost:3000/api/admin/system/partitions/audit?actorId=admin-123&actionType=CREATE_PARTITION&startDate=2026-10-01T00:00:00Z&endDate=2026-10-31T23:59:59Z&limit=10&offset=0",
      );
      const res = await getAuditLogs(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.count).toBe(1);
      expect(json.data).toHaveLength(1);
      expect(json.data[0].id).toBe("log-1");
      expect(json.filters.actorId).toBe("admin-123");
      expect(json.filters.actionType).toBe("CREATE_PARTITION");

      expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining(
          'WHERE "createdAt" >= $1::timestamp AND "createdAt" <= $2::timestamp AND "adminId" = $3 AND "action" = $4',
        ),
        new Date("2026-10-01T00:00:00Z").toISOString(),
        new Date("2026-10-31T23:59:59Z").toISOString(),
        "admin-123",
        "CREATE_PARTITION",
        10,
        0,
      );
    });
  });

  describe("GET /api/admin/system/partitions/export?table=audit multi-criteria export", () => {
    it("returns metadata preview with multi-criteria filters applied", async () => {
      (getAdminUser as jest.Mock).mockResolvedValue({ id: "admin-1" });
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([
        { count: 85 },
      ]);

      const req = new NextRequest(
        "http://localhost:3000/api/admin/system/partitions/export?table=AdminAuditLog&year=2026&month=9&actorId=admin-123&actionType=ARCHIVE_PARTITION&preview=true",
      );
      const res = await exportPartitions(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.preview).toBe(true);
      expect(json.rowCount).toBe(85);
      expect(json.tableName).toContain("AdminAuditLog");

      expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining(
          'SELECT COUNT(*)::int AS count\n          FROM "AdminAuditLog"\n          WHERE "createdAt" >= $1::timestamp AND "createdAt" <= $2::timestamp AND "adminId" = $3 AND "action" = $4',
        ),
        expect.any(String),
        expect.any(String),
        "admin-123",
        "ARCHIVE_PARTITION",
      );
    });

    it("streams audit log partition CSV with custom column headers", async () => {
      (getAdminUser as jest.Mock).mockResolvedValue({ id: "admin-1" });
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([
        {
          id: "audit-1",
          adminId: "admin-123",
          action: "DELETE_PARTITION",
          entityType: "Partition",
          entityId: "part-01",
          details: "deleted partition",
          createdAt: new Date("2026-10-05T08:00:00Z"),
        },
      ]);

      const req = new NextRequest(
        "http://localhost:3000/api/admin/system/partitions/export?table=audit&year=2026&month=9&actorId=admin-123",
      );
      const res = await exportPartitions(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");

      const csv = await res.text();
      expect(csv).toContain(
        "id,adminId,action,entityType,entityId,details,createdAt",
      );
      expect(csv).toContain(
        "audit-1,admin-123,DELETE_PARTITION,Partition,part-01,deleted partition",
      );
    });

    it("supports HEAD request returning filtered audit partition size and count headers", async () => {
      (getAdminUser as jest.Mock).mockResolvedValue({ id: "admin-1" });
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([
        { count: 250 },
      ]);

      const req = new NextRequest(
        "http://localhost:3000/api/admin/system/partitions/export?type=audit&year=2026&month=9&actorId=admin-123&actionType=DELETE_PARTITION",
      );
      const res = await headPartitions(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("X-Row-Count")).toBe("250");
      expect(Number(res.headers.get("X-Estimated-Size-Bytes"))).toBeGreaterThan(
        0,
      );
    });
  });
});
