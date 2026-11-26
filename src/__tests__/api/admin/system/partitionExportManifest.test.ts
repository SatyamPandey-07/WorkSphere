/**
 * src/__tests__/api/admin/system/partitionExportManifest.test.ts
 *
 * Verifies snapshot-consistent resumable partition exports, durable export job manifests,
 * chunk-level hashing, integrity verification, and cancellation (#10168).
 */

import { NextRequest } from "next/server";
import { GET } from "@/app/api/admin/system/partitions/export/route";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import {
  createExportJob,
  getExportJob,
  cancelExportJob,
  updateExportJobProgress,
  computeChunkDigest,
  finalizeExportManifest,
  verifyExportIntegrity,
  clearExportJobs,
} from "@/lib/admin/partitionExport/exportJobService";

jest.mock("@/lib/admin", () => ({
  getAdminUser: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: jest.fn(),
  },
}));

describe("Snapshot-Consistent Resumable Partition Exports & Verifiable Manifests (#10168)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearExportJobs();
    (getAdminUser as jest.Mock).mockResolvedValue({
      id: "admin-master",
      email: "admin@worksphere.com",
    });
  });

  describe("Export Job Service & Manifest Integrity", () => {
    it("creates an export job with unique snapshot ID and timestamp", () => {
      const job = createExportJob({
        adminId: "admin-master",
        tableType: "telemetry",
        tableName: "telemetry-records",
        startIso: "2026-03-01T00:00:00.000Z",
        endIso: "2026-04-01T00:00:00.000Z",
        year: 2026,
        month: 2,
      });

      expect(job.id).toMatch(/^exp_/);
      expect(job.snapshotId).toMatch(/^snap_/);
      expect(job.status).toBe("RUNNING");
      expect(job.snapshotTimestamp).toBeDefined();
    });

    it("persists resume cursor progress after each processed chunk", () => {
      const job = createExportJob({
        adminId: "admin-master",
        tableType: "telemetry",
        tableName: "telemetry-records",
        startIso: "2026-03-01T00:00:00.000Z",
        endIso: "2026-04-01T00:00:00.000Z",
        year: 2026,
        month: 2,
      });

      const chunk = "id,venueId,timestamp\n1,v1,2026-03-01\n";
      const digest = computeChunkDigest(chunk);

      updateExportJobProgress(
        job.id,
        { lastId: "1", lastTimestamp: "2026-03-01", batchIndex: 1 },
        1,
        digest,
      );

      const updated = getExportJob(job.id);
      expect(updated?.completedRowCount).toBe(1);
      expect(updated?.chunkDigests).toHaveLength(1);
      expect(updated?.lastResumeCursor?.lastId).toBe("1");
    });

    it("finalizes manifest with deterministic composite content digest", () => {
      const job = createExportJob({
        adminId: "admin-master",
        tableType: "audit",
        tableName: "audit-logs",
        startIso: "2026-03-01T00:00:00.000Z",
        endIso: "2026-04-01T00:00:00.000Z",
        year: 2026,
        month: 2,
      });

      const chunk1 = "chunk1_csv_data";
      const chunk2 = "chunk2_csv_data";
      const d1 = computeChunkDigest(chunk1);
      const d2 = computeChunkDigest(chunk2);

      updateExportJobProgress(job.id, { lastId: "a", lastTimestamp: "t1", batchIndex: 1 }, 10, d1);
      updateExportJobProgress(job.id, { lastId: "b", lastTimestamp: "t2", batchIndex: 2 }, 10, d2);

      const manifest = finalizeExportManifest(job.id, 20);
      expect(manifest).not.toBeNull();
      expect(manifest?.status).toBe("COMPLETED");
      expect(manifest?.completedRowCount).toBe(20);
      expect(manifest?.finalContentDigest).toBeDefined();

      // Integrity verification succeeds with matching chunks
      const verification = verifyExportIntegrity(manifest!, [d1, d2]);
      expect(verification.valid).toBe(true);

      // Integrity verification fails if a chunk was corrupted or altered
      const tamperedVerification = verifyExportIntegrity(manifest!, [d1, "corrupted_hash"]);
      expect(tamperedVerification.valid).toBe(false);
      expect(tamperedVerification.error).toContain("corrupted");
    });

    it("cancels an active export job safely", () => {
      const job = createExportJob({
        adminId: "admin-master",
        tableType: "push",
        tableName: "push-logs",
        startIso: "2026-03-01T00:00:00.000Z",
        endIso: "2026-04-01T00:00:00.000Z",
        year: 2026,
        month: 2,
      });

      const cancelled = cancelExportJob(job.id, "admin-master");
      expect(cancelled).toBe(true);

      const updated = getExportJob(job.id);
      expect(updated?.status).toBe("CANCELLED");
    });
  });

  describe("API Route Integration: /api/admin/system/partitions/export", () => {
    it("attaches snapshot and job headers to streaming export", async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([
        {
          id: "tel-1",
          venueId: "ven-1",
          timestamp: new Date("2026-03-15T12:00:00Z"),
          download: 50.0,
          upload: 10.0,
          latency: 20.0,
          noiseLevel: 35.0,
          occupancy: 5,
          presence: true,
          crowdLevel: "quiet",
        },
      ]);

      const req = new NextRequest(
        "http://localhost:3000/api/admin/system/partitions/export?year=2026&month=2&type=telemetry",
      );
      const res = await GET(req);

      expect(res.status).toBe(200);
      const jobId = res.headers.get("X-Export-Job-Id");
      const snapshotId = res.headers.get("X-Snapshot-Id");
      const snapshotTimestamp = res.headers.get("X-Snapshot-Timestamp");

      expect(jobId).toMatch(/^exp_/);
      expect(snapshotId).toMatch(/^snap_/);
      expect(snapshotTimestamp).toBeDefined();

      // Drain the stream
      const reader = res.body?.getReader();
      if (reader) {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }

      // Verify manifest is queryable via jobId
      const manifestReq = new NextRequest(
        `http://localhost:3000/api/admin/system/partitions/export?jobId=${jobId}&manifest=true`,
      );
      const manifestRes = await GET(manifestReq);
      expect(manifestRes.status).toBe(200);
      const manifestJson = await manifestRes.json();
      expect(manifestJson.success).toBe(true);
      expect(manifestJson.manifest.exportId).toBe(jobId);
      expect(manifestJson.manifest.finalContentDigest).toBeDefined();
    });

    it("cancels job via API query parameter", async () => {
      const job = createExportJob({
        adminId: "admin-master",
        tableType: "telemetry",
        tableName: "telemetry-records",
        startIso: "2026-03-01T00:00:00.000Z",
        endIso: "2026-04-01T00:00:00.000Z",
        year: 2026,
        month: 2,
      });

      const cancelReq = new NextRequest(
        `http://localhost:3000/api/admin/system/partitions/export?jobId=${job.id}&cancel=true`,
      );
      const cancelRes = await GET(cancelReq);
      expect(cancelRes.status).toBe(200);
      const json = await cancelRes.json();
      expect(json.cancelled).toBe(true);
    });
  });
});
