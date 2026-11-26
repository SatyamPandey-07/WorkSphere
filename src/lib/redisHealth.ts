import { getRedis } from "@/lib/redis";

const REDIS_PING_TIMEOUT_MS = 1500;

export type RedisLatencyResult = {
  ok: boolean;
  latencyMs: number | null;
};

export async function measureRedisLatencyMs(): Promise<RedisLatencyResult> {
  const startedAt = Date.now();

  try {
    const client = getRedis();

    if (!client) {
      return { ok: false, latencyMs: null };
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const result = await Promise.race([
        client.ping(),
        new Promise<"TIMEOUT">((resolve) => {
          timeout = setTimeout(() => resolve("TIMEOUT"), REDIS_PING_TIMEOUT_MS);
        }),
      ]);

      const latencyMs = Math.max(0, Date.now() - startedAt);

      if (result === "TIMEOUT") {
        return { ok: false, latencyMs };
      }

      return { ok: true, latencyMs };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  } catch {
    return {
      ok: false,
      latencyMs: Math.max(0, Date.now() - startedAt),
    };
  }
}
