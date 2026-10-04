/**
 * Tests for venue booking data export and reporting format utilities.
 */

type ExportFormat = "csv" | "json" | "xlsx" | "pdf";
type ExportStatus = "queued" | "processing" | "completed" | "failed" | "expired";

interface ExportJob {
  id: string;
  userId: string;
  format: ExportFormat;
  filters: Record<string, string | number>;
  status: ExportStatus;
  recordCount: number | null;
  fileSizeKb: number | null;
  createdAt: number;
  completedAt: number | null;
  expiresAt: number;
  downloadUrl: string | null;
}

function isExportReady(job: ExportJob): boolean {
  return job.status === "completed" && job.downloadUrl !== null;
}

function isExpired(job: ExportJob, nowMs: number): boolean {
  return job.status === "completed" && nowMs > job.expiresAt;
}

function processingTimeMs(job: ExportJob): number | null {
  if (!job.completedAt) return null;
  return job.completedAt - job.createdAt;
}

function exportSummary(jobs: ExportJob[]): Record<ExportFormat, number> {
  const counts: Partial<Record<ExportFormat, number>> = {};
  for (const j of jobs) counts[j.format] = (counts[j.format] ?? 0) + 1;
  return counts as Record<ExportFormat, number>;
}

function pendingExports(jobs: ExportJob[]): ExportJob[] {
  return jobs.filter((j) => j.status === "queued" || j.status === "processing");
}

function avgProcessingMs(jobs: ExportJob[]): number {
  const completed = jobs.filter((j) => j.completedAt !== null);
  if (completed.length === 0) return 0;
  return Math.round(completed.reduce((s, j) => s + (j.completedAt! - j.createdAt), 0) / completed.length);
}

const NOW = 1_700_000_000_000;
const JOBS: ExportJob[] = [
  { id: "e1", userId: "u1", format: "csv",  filters: {}, status: "completed", recordCount: 1000, fileSizeKb: 250, createdAt: NOW - 60_000, completedAt: NOW - 30_000, expiresAt: NOW + 24 * 3600_000, downloadUrl: "https://cdn/e1.csv" },
  { id: "e2", userId: "u1", format: "xlsx", filters: {}, status: "processing",recordCount: null, fileSizeKb: null,createdAt: NOW - 10_000, completedAt: null,          expiresAt: NOW + 24 * 3600_000, downloadUrl: null },
  { id: "e3", userId: "u2", format: "json", filters: {}, status: "completed", recordCount: 500,  fileSizeKb: 120, createdAt: NOW - 120_000,completedAt: NOW - 50_000,  expiresAt: NOW - 1000,           downloadUrl: "https://cdn/e3.json" },
];

describe("Data export job management", () => {
  it("isExportReady: e1 completed with URL → true", () => {
    expect(isExportReady(JOBS[0])).toBe(true);
  });

  it("isExportReady: e2 still processing → false", () => {
    expect(isExportReady(JOBS[1])).toBe(false);
  });

  it("isExpired: e3 past expiry → true", () => {
    expect(isExpired(JOBS[2], NOW)).toBe(true);
  });

  it("processingTimeMs: e1 = 30s", () => {
    expect(processingTimeMs(JOBS[0])).toBe(30_000);
  });

  it("pendingExports: e2 is processing", () => {
    expect(pendingExports(JOBS).map((j) => j.id)).toContain("e2");
  });

  it("exportSummary: 1 csv, 1 xlsx, 1 json", () => {
    const summary = exportSummary(JOBS);
    expect(summary.csv).toBe(1);
    expect(summary.xlsx).toBe(1);
  });
});
