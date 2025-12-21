/**
 * Analytics Tracking for WorkSphere
 * 
 * Tracks user interactions, agent performance, and search patterns
 * For production, integrate with Vercel Analytics, Mixpanel, or PostHog
 */

type EventName =
  | 'search_performed'
  | 'venue_viewed'
  | 'venue_favorited'
  | 'venue_unfavorited'
  | 'venue_rated'
  | 'directions_requested'
  | 'agent_completed'
  | 'filter_applied'
  | 'conversation_started'
  | 'error_occurred';

interface AnalyticsEvent {
  name: EventName;
  properties?: Record<string, unknown>;
  timestamp: number;
}

// In-memory analytics queue (for development)
const analyticsQueue: AnalyticsEvent[] = [];
const MAX_QUEUE_SIZE = 100;

/**
 * Track an analytics event
 */
export function trackEvent(name: EventName, properties?: Record<string, unknown>): void {
  const event: AnalyticsEvent = {
    name,
    properties,
    timestamp: Date.now(),
  };

  // Add to queue
  analyticsQueue.push(event);
  
  // Trim queue if too large
  if (analyticsQueue.length > MAX_QUEUE_SIZE) {
    analyticsQueue.shift();
  }

  // Log in development
  if (process.env.NODE_ENV === 'development') {
    console.log('[Analytics]', name, properties);
  }

  // In production, send to analytics service
  // sendToAnalyticsService(event);
}

/**
 * Track a search query
 */
export function trackSearch(query: string, location: { lat: number; lng: number }, filters?: Record<string, unknown>): void {
  trackEvent('search_performed', {
    query,
    location: {
      lat: Math.round(location.lat * 100) / 100, // Anonymize location
      lng: Math.round(location.lng * 100) / 100,
    },
    filters,
  });
}

/**
 * Track venue interaction
 */
export function trackVenueInteraction(
  action: 'viewed' | 'favorited' | 'unfavorited' | 'rated' | 'directions',
  venue: { id: string; name: string; category: string }
): void {
  const eventMap: Record<string, EventName> = {
    viewed: 'venue_viewed',
    favorited: 'venue_favorited',
    unfavorited: 'venue_unfavorited',
    rated: 'venue_rated',
    directions: 'directions_requested',
  };

  trackEvent(eventMap[action], {
    venueId: venue.id,
    venueName: venue.name,
    category: venue.category,
  });
}

/**
 * Track agent performance
 */
export function trackAgentPerformance(
  agentName: string,
  duration: number,
  success: boolean,
  resultCount?: number
): void {
  trackEvent('agent_completed', {
    agent: agentName,
    durationMs: duration,
    success,
    resultCount,
  });
}

/**
 * Track filter usage
 */
export function trackFilterApplied(filters: Record<string, unknown>): void {
  trackEvent('filter_applied', {
    filters: Object.keys(filters),
    activeCount: Object.keys(filters).length,
  });
}

/**
 * Track errors
 */
export function trackError(error: Error, context?: string): void {
  trackEvent('error_occurred', {
    message: error.message,
    context,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
  });
}

/**
 * Get analytics summary (for development/debugging)
 */
export function getAnalyticsSummary(): {
  totalEvents: number;
  eventCounts: Record<string, number>;
  recentEvents: AnalyticsEvent[];
} {
  const eventCounts: Record<string, number> = {};
  
  for (const event of analyticsQueue) {
    eventCounts[event.name] = (eventCounts[event.name] || 0) + 1;
  }

  return {
    totalEvents: analyticsQueue.length,
    eventCounts,
    recentEvents: analyticsQueue.slice(-10),
  };
}

/**
 * Clear analytics queue
 */
export function clearAnalytics(): void {
  analyticsQueue.length = 0;
}

// ============================================
// Agent Performance Metrics
// ============================================

interface AgentMetric {
  agent: string;
  avgDuration: number;
  successRate: number;
  totalCalls: number;
}

const agentMetrics: Map<string, { durations: number[]; successes: number; failures: number }> = new Map();

/**
 * Record agent execution metrics
 */
export function recordAgentMetric(agent: string, duration: number, success: boolean): void {
  const existing = agentMetrics.get(agent) || { durations: [], successes: 0, failures: 0 };
  
  existing.durations.push(duration);
  if (success) {
    existing.successes++;
  } else {
    existing.failures++;
  }
  
  // Keep only last 100 durations
  if (existing.durations.length > 100) {
    existing.durations.shift();
  }
  
  agentMetrics.set(agent, existing);
}

/**
 * Get agent performance summary
 */
export function getAgentMetrics(): AgentMetric[] {
  const metrics: AgentMetric[] = [];
  
  for (const [agent, data] of agentMetrics.entries()) {
    const totalCalls = data.successes + data.failures;
    const avgDuration = data.durations.reduce((a, b) => a + b, 0) / data.durations.length;
    
    metrics.push({
      agent,
      avgDuration: Math.round(avgDuration),
      successRate: totalCalls > 0 ? Math.round((data.successes / totalCalls) * 100) : 0,
      totalCalls,
    });
  }
  
  return metrics;
}

// ============================================
// Search Analytics
// ============================================

interface SearchPattern {
  query: string;
  count: number;
  lastUsed: number;
}

const searchPatterns: Map<string, SearchPattern> = new Map();

/**
 * Record search query pattern
 */
export function recordSearchPattern(query: string): void {
  const normalized = query.toLowerCase().trim();
  const existing = searchPatterns.get(normalized);
  
  if (existing) {
    existing.count++;
    existing.lastUsed = Date.now();
  } else {
    searchPatterns.set(normalized, {
      query: normalized,
      count: 1,
      lastUsed: Date.now(),
    });
  }
}

/**
 * Get popular search queries
 */
export function getPopularSearches(limit = 10): SearchPattern[] {
  return Array.from(searchPatterns.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
