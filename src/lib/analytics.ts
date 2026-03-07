/**
 * Analytics Tracking for WorkSphere
 *
 * Production:  Uses Upstash Redis for durable, distributed counters
 *              (Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)
 * Development: Falls back to in-memory queue so the dashboard still works
 *              locally without any configuration.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

type EventName =
  | "search_performed"
  | "venue_viewed"
  | "venue_favorited"
  | "venue_unfavorited"
  | "venue_rated"
  | "directions_requested"
  | "agent_completed"
  | "filter_applied"
  | "conversation_started"
  | "error_occurred";

interface AnalyticsEvent {
  name: EventName;
  properties?: Record<string, unknown>;
  timestamp: number;
}

// ─── Upstash Redis (production) ───────────────────────────────────────────────

function getRedis() {
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Redis } = require("@upstash/redis");
    return new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    }) as {
      hincrby: (key: string, field: string, inc: number) => Promise<number>;
      hgetall: (key: string) => Promise<Record<string, string> | null>;
      lpush: (key: string, ...values: string[]) => Promise<number>;
      ltrim: (key: string, start: number, stop: number) => Promise<"OK">;
      lrange: (key: string, start: number, stop: number) => Promise<string[]>;
    };
  } catch {
    return null;
  }
}

const EVENT_COUNTS_KEY = "worksphere:analytics:event_counts";
const RECENT_EVENTS_KEY = "worksphere:analytics:recent_events";
const MAX_RECENT = 100;

// ─── In-memory fallback (development) ────────────────────────────────────────

const memQueue: AnalyticsEvent[] = [];
const MAX_MEM_QUEUE = 100;

// ─── Core tracking ────────────────────────────────────────────────────────────

/** Fire-and-forget; never throws. */
export function trackEvent(
  name: EventName,
  properties?: Record<string, unknown>
): void {
  const event: AnalyticsEvent = { name, properties, timestamp: Date.now() };

  // Always maintain in-memory copy for fast dashboard reads
  memQueue.push(event);
  if (memQueue.length > MAX_MEM_QUEUE) memQueue.shift();

  if (process.env.NODE_ENV === "development") {
    console.log("[Analytics]", name, properties);
  }

  // Persist to Redis asynchronously (don't await — never block the caller)
  const redis = getRedis();
  if (redis) {
    Promise.all([
      redis.hincrby(EVENT_COUNTS_KEY, name, 1),
      redis.lpush(RECENT_EVENTS_KEY, JSON.stringify(event)),
      redis.ltrim(RECENT_EVENTS_KEY, 0, MAX_RECENT - 1),
    ]).catch((err) => {
      console.error("[Analytics] Redis write failed:", err);
    });
  }
}

// ─── Convenience helpers ──────────────────────────────────────────────────────

export function trackSearch(
  query: string,
  location: { lat: number; lng: number },
  filters?: Record<string, unknown>
): void {
  trackEvent("search_performed", {
    query,
    location: {
      lat: Math.round(location.lat * 100) / 100,
      lng: Math.round(location.lng * 100) / 100,
    },
    filters,
  });
}

export function trackVenueInteraction(
  action: "viewed" | "favorited" | "unfavorited" | "rated" | "directions",
  venue: { id: string; name: string; category: string }
): void {
  const eventMap: Record<string, EventName> = {
    viewed: "venue_viewed",
    favorited: "venue_favorited",
    unfavorited: "venue_unfavorited",
    rated: "venue_rated",
    directions: "directions_requested",
  };
  trackEvent(eventMap[action], {
    venueId: venue.id,
    venueName: venue.name,
    category: venue.category,
  });
}

export function trackAgentPerformance(
  agentName: string,
  duration: number,
  success: boolean,
  resultCount?: number
): void {
  trackEvent("agent_completed", { agent: agentName, durationMs: duration, success, resultCount });
}

export function trackFilterApplied(filters: Record<string, unknown>): void {
  trackEvent("filter_applied", {
    filters: Object.keys(filters),
    activeCount: Object.keys(filters).length,
  });
}

export function trackError(error: Error, context?: string): void {
  trackEvent("error_occurred", {
    message: error.message,
    context,
    stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
  });
}

// ─── Dashboard reads ──────────────────────────────────────────────────────────

/** Returns a summary suitable for the analytics dashboard. Prefers Redis. */
export async function getAnalyticsSummaryAsync(): Promise<{
  totalEvents: number;
  eventCounts: Record<string, number>;
  recentEvents: AnalyticsEvent[];
}> {
  const redis = getRedis();

  if (redis) {
    try {
      const [countsRaw, recentRaw] = await Promise.all([
        redis.hgetall(EVENT_COUNTS_KEY),
        redis.lrange(RECENT_EVENTS_KEY, 0, 9),
      ]);

      const eventCounts: Record<string, number> = {};
      let totalEvents = 0;
      if (countsRaw) {
        for (const [k, v] of Object.entries(countsRaw)) {
          eventCounts[k] = Number(v);
          totalEvents += Number(v);
        }
      }

      const recentEvents: AnalyticsEvent[] = recentRaw
        .map((s) => {
          try {
            return JSON.parse(s) as AnalyticsEvent;
          } catch {
            return null;
          }
        })
        .filter(Boolean) as AnalyticsEvent[];

      return { totalEvents, eventCounts, recentEvents };
    } catch (err) {
      console.error("[Analytics] Redis read failed, falling back to in-memory:", err);
    }
  }

  // In-memory fallback
  return getAnalyticsSummary();
}

/** Synchronous in-memory version (for backwards compatibility). */
export function getAnalyticsSummary(): {
  totalEvents: number;
  eventCounts: Record<string, number>;
  recentEvents: AnalyticsEvent[];
} {
  const eventCounts: Record<string, number> = {};
  for (const e of memQueue) {
    eventCounts[e.name] = (eventCounts[e.name] || 0) + 1;
  }
  return {
    totalEvents: memQueue.length,
    eventCounts,
    recentEvents: memQueue.slice(-10),
  };
}

export function clearAnalytics(): void {
  memQueue.length = 0;
}

// ─── Agent performance metrics (in-memory, sufficient for dev) ────────────────

interface AgentBucket {
  durations: number[];
  successes: number;
  failures: number;
}

const agentBuckets = new Map<string, AgentBucket>();

export function recordAgentMetric(agent: string, duration: number, success: boolean): void {
  const b = agentBuckets.get(agent) ?? { durations: [], successes: 0, failures: 0 };
  b.durations.push(duration);
  if (b.durations.length > 100) b.durations.shift();
  if (success) b.successes++; else b.failures++;
  agentBuckets.set(agent, b);
}

export function getAgentMetrics(): Array<{
  agent: string;
  avgDuration: number;
  successRate: number;
  totalCalls: number;
}> {
  return Array.from(agentBuckets.entries()).map(([agent, b]) => {
    const totalCalls = b.successes + b.failures;
    const avgDuration =
      b.durations.length > 0
        ? b.durations.reduce((a, c) => a + c, 0) / b.durations.length
        : 0;
    return {
      agent,
      avgDuration: Math.round(avgDuration),
      successRate: totalCalls > 0 ? Math.round((b.successes / totalCalls) * 100) : 0,
      totalCalls,
    };
  });
}

// ─── Search pattern tracking ──────────────────────────────────────────────────

interface SearchPattern {
  query: string;
  count: number;
  lastUsed: number;
}

const searchPatterns = new Map<string, SearchPattern>();

export function recordSearchPattern(query: string): void {
  const key = query.toLowerCase().trim();
  const existing = searchPatterns.get(key);
  if (existing) {
    existing.count++;
    existing.lastUsed = Date.now();
  } else {
    searchPatterns.set(key, { query: key, count: 1, lastUsed: Date.now() });
  }
}

export function getPopularSearches(limit = 10): SearchPattern[] {
  return Array.from(searchPatterns.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
