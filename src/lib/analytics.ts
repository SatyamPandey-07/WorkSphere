/**
 * Analytics tracking for WorkSphere.
 *
 * Production: Upstash Redis provides durable distributed counters/events.
 * Development: an in-memory queue keeps local analytics functional without Redis.
 */

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

export interface AnalyticsEvent {
  name: EventName;
  properties?: Record<string, unknown>;
  timestamp: number;
}

type RedisLike = {
  hincrby: (key: string, field: string, increment: number) => Promise<number>;
  hgetall: (key: string) => Promise<Record<string, number | string> | null>;
  lpush: (key: string, ...values: string[]) => Promise<number>;
  ltrim: (key: string, start: number, stop: number) => Promise<"OK">;
  lrange: (key: string, start: number, stop: number) => Promise<string[]>;
};

function getRedis(): RedisLike | null {
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
    }) as RedisLike;
  } catch {
    return null;
  }
}

const EVENT_COUNTS_KEY = "worksphere:analytics:event_counts";
const RECENT_EVENTS_KEY = "worksphere:analytics:recent_events";
const MAX_RECENT = 5000;

const memQueue: AnalyticsEvent[] = [];
const MAX_MEM_QUEUE = 1000;

export function trackEvent(
  name: EventName,
  properties?: Record<string, unknown>,
): void {
  const event: AnalyticsEvent = {
    name,
    properties,
    timestamp: Date.now(),
  };

  memQueue.push(event);

  if (memQueue.length > MAX_MEM_QUEUE) {
    memQueue.shift();
  }

  if (process.env.NODE_ENV === "development") {
    console.log("[Analytics]", name, properties);
  }

  const redis = getRedis();

  if (redis) {
    Promise.all([
      redis.hincrby(EVENT_COUNTS_KEY, name, 1),
      redis.lpush(RECENT_EVENTS_KEY, JSON.stringify(event)),
      redis.ltrim(RECENT_EVENTS_KEY, 0, MAX_RECENT - 1),
    ]).catch((error) => {
      console.error("[Analytics] Redis write failed:", error);
    });
  }
}

export function trackSearch(
  query: string,
  location: { lat: number; lng: number },
  filters?: Record<string, unknown>,
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
  venue: { id: string; name: string; category: string },
): void {
  const eventMap: Record<
    typeof action,
    Extract<
      EventName,
      | "venue_viewed"
      | "venue_favorited"
      | "venue_unfavorited"
      | "venue_rated"
      | "directions_requested"
    >
  > = {
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
  resultCount?: number,
): void {
  trackEvent("agent_completed", {
    agent: agentName,
    durationMs: duration,
    success,
    resultCount,
  });
}

export function trackFilterApplied(
  filters: Record<string, unknown>,
): void {
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

export function getAnalyticsSummary(): {
  totalEvents: number;
  eventCounts: Record<string, number>;
  recentEvents: AnalyticsEvent[];
} {
  const eventCounts: Record<string, number> = {};

  for (const event of memQueue) {
    eventCounts[event.name] = (eventCounts[event.name] ?? 0) + 1;
  }

  return {
    totalEvents: memQueue.length,
    eventCounts,
    recentEvents: [...memQueue].reverse(),
  };
}

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
        redis.lrange(RECENT_EVENTS_KEY, 0, MAX_RECENT - 1),
      ]);

      const eventCounts: Record<string, number> = {};
      let totalEvents = 0;

      if (countsRaw) {
        for (const [key, value] of Object.entries(countsRaw)) {
          eventCounts[key] = Number(value);
          totalEvents += Number(value);
        }
      }

      const recentEvents = recentRaw
        .map((value) => {
          try {
            return JSON.parse(value) as AnalyticsEvent;
          } catch {
            return null;
          }
        })
        .filter((value): value is AnalyticsEvent => value !== null);

      return {
        totalEvents,
        eventCounts,
        recentEvents,
      };
    } catch (error) {
      console.error(
        "[Analytics] Redis read failed, falling back to in-memory:",
        error,
      );
    }
  }

  return getAnalyticsSummary();
}

export function getAgentMetrics(): {
  agent: string;
  avgDuration: number;
  successRate: number;
  totalCalls: number;
}[] {
  const agents: Record<string, { totalDuration: number; successes: number; count: number }> = {};
  
  for (const event of memQueue) {
    if (event.name === "agent_completed" && event.properties) {
      const agent = String(event.properties.agent);
      const duration = Number(event.properties.durationMs ?? 0);
      const success = Boolean(event.properties.success);
      
      if (!agents[agent]) {
        agents[agent] = { totalDuration: 0, successes: 0, count: 0 };
      }
      agents[agent].totalDuration += duration;
      if (success) agents[agent].successes += 1;
      agents[agent].count += 1;
    }
  }
  
  return Object.entries(agents).map(([agent, data]) => ({
    agent,
    avgDuration: data.count > 0 ? data.totalDuration / data.count : 0,
    successRate: data.count > 0 ? data.successes / data.count : 0,
    totalCalls: data.count,
  }));
}

export function getPopularSearches(limit: number = 10): {
  query: string;
  count: number;
  lastUsed: number;
}[] {
  const searches: Record<string, { count: number; lastUsed: number }> = {};
  
  for (const event of memQueue) {
    if (event.name === "search_performed" && event.properties) {
      const query = String(event.properties.query ?? "");
      if (!query) continue;
      
      if (!searches[query]) {
        searches[query] = { count: 0, lastUsed: 0 };
      }
      searches[query].count += 1;
      searches[query].lastUsed = Math.max(searches[query].lastUsed, event.timestamp);
    }
  }
  
  return Object.entries(searches)
    .map(([query, data]) => ({
      query,
      count: data.count,
      lastUsed: data.lastUsed,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function clearAnalytics(): void {
  memQueue.length = 0;
}
