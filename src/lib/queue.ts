import { getRedis } from "@/lib/redis";

// Resolved lazily so importing this module never throws when Redis is not configured.
function requireRedis() {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is not configured");
  return redis;
}

export type JobStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface JobPayload {
  userId: string;
  type: "TAX_EXPORT" | "RECEIPT_DOWNLOAD";
  data: any;
}

export interface JobState {
  id: string;
  status: JobStatus;
  resultUrl?: string;
  error?: string;
  createdAt: number;
}

export async function pushJob(jobId: string, payload: JobPayload) {
  // Store job state
  const state: JobState = {
    id: jobId,
    status: "QUEUED",
    createdAt: Date.now(),
  };
  const redis = requireRedis();
  await redis.hset(
    `pdf:job:${jobId}`,
    state as unknown as Record<string, unknown>,
  );
  await redis.expire(`pdf:job:${jobId}`, 24 * 60 * 60);

  // Push to queue
  await redis.lpush(
    "pdf:jobs",
    JSON.stringify({
      id: jobId,
      ...payload,
    }),
  );
}

export async function getJobStatus(jobId: string): Promise<JobState | null> {
  const state = await requireRedis().hgetall(`pdf:job:${jobId}`);
  if (!state || Object.keys(state).length === 0) return null;
  const parsed = state as unknown as Record<string, string>;
  return {
    id: String(parsed.id ?? jobId),
    status: (parsed.status as JobStatus) ?? "QUEUED",
    resultUrl: parsed.resultUrl,
    error: parsed.error,
    createdAt: Number(parsed.createdAt ?? 0),
  };
}

export async function updateJobStatus(
  jobId: string,
  updates: Partial<JobState>,
) {
  await requireRedis().hset(`pdf:job:${jobId}`, updates);
}
