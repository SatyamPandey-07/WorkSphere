import { pushJob, getJobStatus, updateJobStatus } from "@/lib/queue";
import { GET } from "@/app/api/jobs/[jobId]/route";
import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";

// In-memory mock Redis state for queue tests
const mockRedisStore: Record<string, Record<string, string>> = {};
const mockRedisList: string[] = [];

jest.mock("@/lib/redis", () => ({
  getRedis: jest.fn(() => ({
    hset: jest.fn(async (key: string, data: Record<string, unknown>) => {
      if (!mockRedisStore[key]) mockRedisStore[key] = {};
      for (const [k, v] of Object.entries(data)) {
        mockRedisStore[key][k] = String(v);
      }
      return Object.keys(data).length;
    }),
    hgetall: jest.fn(async (key: string) => {
      return mockRedisStore[key] || null;
    }),
    expire: jest.fn(async () => 1),
    lpush: jest.fn(async (_key: string, item: string) => {
      mockRedisList.push(item);
      return mockRedisList.length;
    }),
  })),
}));

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

describe("Issue #9522 - Asynchronous Job Ownership & Queue State", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(mockRedisStore)) {
      delete mockRedisStore[key];
    }
    mockRedisList.length = 0;
  });

  describe("pushJob & updateJobStatus (queue.ts)", () => {
    it("persists authenticated owner userId and initial state in Redis", async () => {
      await pushJob("job-001", {
        userId: "user_owner_1",
        type: "TAX_EXPORT",
        data: { year: 2026 },
      });

      const status = await getJobStatus("job-001");
      expect(status).not.toBeNull();
      expect(status?.id).toBe("job-001");
      expect(status?.userId).toBe("user_owner_1");
      expect(status?.status).toBe("QUEUED");
      expect(status?.createdAt).toBeGreaterThan(0);

      // Verify Redis queue list payload also contains userId
      expect(mockRedisList.length).toBe(1);
      const pushedPayload = JSON.parse(mockRedisList[0]);
      expect(pushedPayload.userId).toBe("user_owner_1");
    });

    it("throws error if payload lacks a valid userId", async () => {
      await expect(
        pushJob("job-no-user", {
          userId: "",
          type: "TAX_EXPORT",
          data: {},
        }),
      ).rejects.toThrow("Job payload must include a valid userId");
    });

    it("preserves owner userId across worker updates (e.g. PROCESSING, COMPLETED, FAILED)", async () => {
      await pushJob("job-002", {
        userId: "user_owner_2",
        type: "RECEIPT_DOWNLOAD",
        data: { bookingId: "b-123" },
      });

      // Worker updates to PROCESSING without passing userId
      await updateJobStatus("job-002", { status: "PROCESSING" });
      let status = await getJobStatus("job-002");
      expect(status?.status).toBe("PROCESSING");
      expect(status?.userId).toBe("user_owner_2");

      // Worker updates to COMPLETED with resultUrl
      await updateJobStatus("job-002", {
        status: "COMPLETED",
        resultUrl: "https://storage.worksphere.com/receipts/r-123.pdf",
      });
      status = await getJobStatus("job-002");
      expect(status?.status).toBe("COMPLETED");
      expect(status?.userId).toBe("user_owner_2");
      expect(status?.resultUrl).toBe(
        "https://storage.worksphere.com/receipts/r-123.pdf",
      );

      // Worker updates to FAILED with error
      await updateJobStatus("job-002", {
        status: "FAILED",
        error: "Rendering timeout",
      });
      status = await getJobStatus("job-002");
      expect(status?.status).toBe("FAILED");
      expect(status?.userId).toBe("user_owner_2");
      expect(status?.error).toBe("Rendering timeout");
    });

    it("returns null for nonexistent or expired jobs in Redis", async () => {
      const status = await getJobStatus("nonexistent-job");
      expect(status).toBeNull();
    });
  });

  describe("GET /api/jobs/[jobId] Route Authorization", () => {
    it("returns 401 when request is unauthenticated", async () => {
      (auth as jest.Mock).mockResolvedValue({ userId: null });

      const req = new NextRequest("http://localhost:3000/api/jobs/job-001");
      const res = await GET(req, {
        params: Promise.resolve({ jobId: "job-001" }),
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    it("returns 200 with job status when authenticated as the job owner", async () => {
      (auth as jest.Mock).mockResolvedValue({ userId: "user_owner_1" });

      await pushJob("job-001", {
        userId: "user_owner_1",
        type: "TAX_EXPORT",
        data: { year: 2026 },
      });
      await updateJobStatus("job-001", {
        status: "COMPLETED",
        resultUrl: "https://example.com/tax-2026.pdf",
      });

      const req = new NextRequest("http://localhost:3000/api/jobs/job-001");
      const res = await GET(req, {
        params: Promise.resolve({ jobId: "job-001" }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.id).toBe("job-001");
      expect(json.status).toBe("COMPLETED");
      expect(json.resultUrl).toBe("https://example.com/tax-2026.pdf");
      expect(json.userId).toBe("user_owner_1");
    });

    it("returns 404 and does not leak metadata when a different user requests the job", async () => {
      (auth as jest.Mock).mockResolvedValue({ userId: "malicious_user_99" });

      await pushJob("job-secret-001", {
        userId: "user_owner_1",
        type: "TAX_EXPORT",
        data: {},
      });
      await updateJobStatus("job-secret-001", {
        status: "COMPLETED",
        resultUrl: "https://example.com/sensitive-financial-doc.pdf",
      });

      const req = new NextRequest(
        "http://localhost:3000/api/jobs/job-secret-001",
      );
      const res = await GET(req, {
        params: Promise.resolve({ jobId: "job-secret-001" }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("Job not found");
      expect(json.resultUrl).toBeUndefined();
      expect(json.status).toBeUndefined();
    });

    it("returns 404 for missing or expired jobs", async () => {
      (auth as jest.Mock).mockResolvedValue({ userId: "user_owner_1" });

      const req = new NextRequest(
        "http://localhost:3000/api/jobs/job-does-not-exist",
      );
      const res = await GET(req, {
        params: Promise.resolve({ jobId: "job-does-not-exist" }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("Job not found");
    });

    it("fails closed (returns 404) for legacy jobs lacking owner metadata", async () => {
      (auth as jest.Mock).mockResolvedValue({ userId: "user_owner_1" });

      // Seed a legacy job in Redis without userId field
      mockRedisStore["pdf:job:legacy-job-1"] = {
        id: "legacy-job-1",
        status: "COMPLETED",
        resultUrl: "https://example.com/legacy.pdf",
        createdAt: "1600000000000",
      };

      const req = new NextRequest(
        "http://localhost:3000/api/jobs/legacy-job-1",
      );
      const res = await GET(req, {
        params: Promise.resolve({ jobId: "legacy-job-1" }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("Job not found");
      expect(json.resultUrl).toBeUndefined();
    });
  });
});
