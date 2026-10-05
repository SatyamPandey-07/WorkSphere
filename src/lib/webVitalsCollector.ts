/**
 * Client-Side Web Vitals Performance Metrics Collector & Aggregator
 * WorkSphere Core Web Vitals telemetry engine according to Google Web Vitals directives.
 */

export type WebVitalMetricName = "LCP" | "FID" | "INP" | "CLS" | "FCP" | "TTFB";

export type WebVitalRating = "good" | "needs-improvement" | "poor";

export interface WebVitalEntry {
  id: string;
  name: WebVitalMetricName;
  value: number;
  rating: WebVitalRating;
  delta: number;
  route: string;
  timestamp: number;
  navigationType?: string;
}

export interface MetricThresholds {
  good: number;
  needsImprovement: number;
  unit: "ms" | "score";
}

/**
 * Official Google Core Web Vitals Threshold Definitions
 */
export const WEB_VITALS_THRESHOLDS: Record<WebVitalMetricName, MetricThresholds> = {
  LCP: { good: 2500, needsImprovement: 4000, unit: "ms" },
  INP: { good: 200, needsImprovement: 500, unit: "ms" },
  CLS: { good: 0.1, needsImprovement: 0.25, unit: "score" },
  FID: { good: 100, needsImprovement: 300, unit: "ms" },
  FCP: { good: 1800, needsImprovement: 3000, unit: "ms" },
  TTFB: { good: 800, needsImprovement: 1800, unit: "ms" },
};

/**
 * Derives rating (good, needs-improvement, poor) based on metric thresholds.
 */
export function getWebVitalRating(
  name: WebVitalMetricName,
  value: number
): WebVitalRating {
  const threshold = WEB_VITALS_THRESHOLDS[name];
  if (!threshold) return "good";

  if (value <= threshold.good) return "good";
  if (value <= threshold.needsImprovement) return "needs-improvement";
  return "poor";
}

/**
 * Calculates percentiles (p50, p75, p90) for a set of numeric metric samples.
 */
export function calculatePercentiles(values: number[]): {
  p50: number;
  p75: number;
  p90: number;
  min: number;
  max: number;
  count: number;
} {
  if (!values || values.length === 0) {
    return { p50: 0, p75: 0, p90: 0, min: 0, max: 0, count: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;

  const getPercentile = (p: number) => {
    const idx = Math.ceil((p / 100) * count) - 1;
    return sorted[Math.max(0, Math.min(idx, count - 1))];
  };

  return {
    p50: Number(getPercentile(50).toFixed(2)),
    p75: Number(getPercentile(75).toFixed(2)),
    p90: Number(getPercentile(90).toFixed(2)),
    min: Number(sorted[0].toFixed(2)),
    max: Number(sorted[count - 1].toFixed(2)),
    count,
  };
}

export interface MetricSummary {
  name: WebVitalMetricName;
  p50: number;
  p75: number;
  p90: number;
  rating: WebVitalRating;
  sampleCount: number;
  distribution: {
    good: number;
    needsImprovement: number;
    poor: number;
  };
}

export interface RouteVitalsSummary {
  route: string;
  sampleCount: number;
  score: number;
  metrics: Partial<Record<WebVitalMetricName, MetricSummary>>;
}

export interface AggregatedWebVitals {
  overallScore: number;
  totalSamples: number;
  timeRange: string;
  generatedAt: string;
  metrics: Record<WebVitalMetricName, MetricSummary>;
  routes: RouteVitalsSummary[];
}

/**
 * Calculates weighted Core Web Vitals overall performance score (0 - 100).
 * Weights: LCP (30%), INP (25%), CLS (25%), FCP (10%), TTFB (10%).
 */
export function calculatePerformanceScore(
  metrics: Partial<Record<WebVitalMetricName, MetricSummary>>
): number {
  const weights: Record<WebVitalMetricName, number> = {
    LCP: 0.3,
    INP: 0.25,
    CLS: 0.25,
    FCP: 0.1,
    TTFB: 0.1,
    FID: 0.0,
  };

  let totalWeight = 0;
  let weightedScoreSum = 0;

  (Object.keys(weights) as WebVitalMetricName[]).forEach((name) => {
    const metric = metrics[name];
    const weight = weights[name];
    if (!metric || metric.sampleCount === 0 || weight === 0) return;

    const threshold = WEB_VITALS_THRESHOLDS[name];
    const p75 = metric.p75;

    let metricScore = 100;
    if (p75 <= threshold.good) {
      // 90 - 100 score range
      const ratio = p75 / threshold.good;
      metricScore = 100 - ratio * 10;
    } else if (p75 <= threshold.needsImprovement) {
      // 50 - 89 score range
      const range = threshold.needsImprovement - threshold.good;
      const progress = (p75 - threshold.good) / range;
      metricScore = 89 - progress * 39;
    } else {
      // 0 - 49 score range
      const excess = p75 - threshold.needsImprovement;
      const ratio = Math.min(1, excess / threshold.needsImprovement);
      metricScore = 49 - ratio * 49;
    }

    weightedScoreSum += Math.max(0, Math.min(100, metricScore)) * weight;
    totalWeight += weight;
  });

  if (totalWeight === 0) return 100;
  return Math.round(weightedScoreSum / totalWeight);
}

/**
 * Aggregates raw Web Vitals entries into percentiles and route summaries.
 */
export function aggregateWebVitals(
  entries: WebVitalEntry[],
  timeRange: string = "7d"
): AggregatedWebVitals {
  const list = entries ?? [];
  const metricNames: WebVitalMetricName[] = ["LCP", "INP", "CLS", "FCP", "TTFB", "FID"];
  const groupedByName: Record<WebVitalMetricName, number[]> = {
    LCP: [],
    INP: [],
    CLS: [],
    FCP: [],
    TTFB: [],
    FID: [],
  };

  const groupedByRoute: Record<string, Record<WebVitalMetricName, number[]>> = {};

  let validCount = 0;
  (list || []).forEach((entry) => {
    if (!entry || !entry.name || typeof entry.value !== "number") return;
    validCount += 1;

    if (groupedByName[entry.name]) {
      groupedByName[entry.name].push(entry.value);
    }

    const route = entry.route || "/";
    if (!groupedByRoute[route]) {
      groupedByRoute[route] = {
        LCP: [],
        INP: [],
        CLS: [],
        FCP: [],
        TTFB: [],
        FID: [],
      };
    }
    if (groupedByRoute[route][entry.name]) {
      groupedByRoute[route][entry.name].push(entry.value);
    }
  });

  const metricsSummary = {} as Record<WebVitalMetricName, MetricSummary>;

  metricNames.forEach((name) => {
    const vals = groupedByName[name];
    const percentiles = calculatePercentiles(vals);
    const rating = getWebVitalRating(name, percentiles.p75);

    const threshold = WEB_VITALS_THRESHOLDS[name];
    let good = 0;
    let needsImprovement = 0;
    let poor = 0;

    vals.forEach((v) => {
      if (v <= threshold.good) good++;
      else if (v <= threshold.needsImprovement) needsImprovement++;
      else poor++;
    });

    const total = vals.length || 1;
    metricsSummary[name] = {
      name,
      ...percentiles,
      rating,
      sampleCount: vals.length,
      distribution: {
        good: Math.round((good / total) * 100),
        needsImprovement: Math.round((needsImprovement / total) * 100),
        poor: Math.round((poor / total) * 100),
      },
    };
  });

  const routesSummary: RouteVitalsSummary[] = Object.keys(groupedByRoute).map((route) => {
    const routeMetricsMap = groupedByRoute[route];
    const routeMetrics = {} as Partial<Record<WebVitalMetricName, MetricSummary>>;
    let routeSamples = 0;

    metricNames.forEach((name) => {
      const vals = routeMetricsMap[name];
      if (vals.length > 0) {
        routeSamples += vals.length;
        const percentiles = calculatePercentiles(vals);
        const rating = getWebVitalRating(name, percentiles.p75);
        const threshold = WEB_VITALS_THRESHOLDS[name];
        let good = 0,
          needsImp = 0,
          poor = 0;

        vals.forEach((v) => {
          if (v <= threshold.good) good++;
          else if (v <= threshold.needsImprovement) needsImp++;
          else poor++;
        });

        const total = vals.length;
        routeMetrics[name] = {
          name,
          ...percentiles,
          rating,
          sampleCount: total,
          distribution: {
            good: Math.round((good / total) * 100),
            needsImprovement: Math.round((needsImp / total) * 100),
            poor: Math.round((poor / total) * 100),
          },
        };
      }
    });

    const score = calculatePerformanceScore(routeMetrics);

    return {
      route,
      sampleCount: routeSamples,
      score,
      metrics: routeMetrics,
    };
  });

  routesSummary.sort((a, b) => b.sampleCount - a.sampleCount);

  const overallScore = calculatePerformanceScore(metricsSummary);

  return {
    overallScore,
    totalSamples: validCount,
    timeRange,
    generatedAt: new Date().toISOString(),
    metrics: metricsSummary,
    routes: routesSummary,
  };
}

const STORAGE_KEY = "worksphere_web_vitals_telemetry";

/**
 * Stores a web vital metric entry into browser localStorage for client telemetry aggregation.
 */
export function recordWebVital(entry: Omit<WebVitalEntry, "id" | "timestamp">): WebVitalEntry {
  const fullEntry: WebVitalEntry = {
    ...entry,
    id: `wv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
  };

  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const existing = getStoredWebVitals();
      existing.push(fullEntry);
      // Retain max 500 recent telemetry entries locally
      const trimmed = existing.slice(-500);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // Ignore quota exceeded or restricted storage errors
    }
  }

  return fullEntry;
}

/**
 * Retrieves stored Web Vitals entries from localStorage.
 */
export function getStoredWebVitals(): WebVitalEntry[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Clears stored local telemetry.
 */
export function clearStoredWebVitals(): void {
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
}

/**
 * Generates synthetic benchmark telemetry samples for testing and initial dashboard display.
 */
export function generateDefaultWebVitalsData(timeRange: string = "7d"): AggregatedWebVitals {
  const defaultEntries: WebVitalEntry[] = [
    // LCP samples
    { id: "1", name: "LCP", value: 1450, rating: "good", delta: 1450, route: "/", timestamp: Date.now() - 1000 },
    { id: "2", name: "LCP", value: 1890, rating: "good", delta: 1890, route: "/venues", timestamp: Date.now() - 2000 },
    { id: "3", name: "LCP", value: 2400, rating: "good", delta: 2400, route: "/chat", timestamp: Date.now() - 3000 },
    { id: "4", name: "LCP", value: 3100, rating: "needs-improvement", delta: 3100, route: "/admin/system", timestamp: Date.now() - 4000 },
    { id: "5", name: "LCP", value: 1620, rating: "good", delta: 1620, route: "/ai", timestamp: Date.now() - 5000 },
    { id: "6", name: "LCP", value: 2150, rating: "good", delta: 2150, route: "/", timestamp: Date.now() - 6000 },
    // INP samples
    { id: "7", name: "INP", value: 45, rating: "good", delta: 45, route: "/", timestamp: Date.now() - 1100 },
    { id: "8", name: "INP", value: 110, rating: "good", delta: 110, route: "/venues", timestamp: Date.now() - 2100 },
    { id: "9", name: "INP", value: 185, rating: "good", delta: 185, route: "/chat", timestamp: Date.now() - 3100 },
    { id: "10", name: "INP", value: 280, rating: "needs-improvement", delta: 280, route: "/admin/system", timestamp: Date.now() - 4100 },
    { id: "11", name: "INP", value: 65, rating: "good", delta: 65, route: "/ai", timestamp: Date.now() - 5100 },
    // CLS samples
    { id: "12", name: "CLS", value: 0.02, rating: "good", delta: 0.02, route: "/", timestamp: Date.now() - 1200 },
    { id: "13", name: "CLS", value: 0.05, rating: "good", delta: 0.05, route: "/venues", timestamp: Date.now() - 2200 },
    { id: "14", name: "CLS", value: 0.08, rating: "good", delta: 0.08, route: "/chat", timestamp: Date.now() - 3200 },
    { id: "15", name: "CLS", value: 0.14, rating: "needs-improvement", delta: 0.14, route: "/admin/system", timestamp: Date.now() - 4200 },
    { id: "16", name: "CLS", value: 0.01, rating: "good", delta: 0.01, route: "/ai", timestamp: Date.now() - 5200 },
    // FCP samples
    { id: "17", name: "FCP", value: 850, rating: "good", delta: 850, route: "/", timestamp: Date.now() - 1300 },
    { id: "18", name: "FCP", value: 1100, rating: "good", delta: 1100, route: "/venues", timestamp: Date.now() - 2300 },
    { id: "19", name: "FCP", value: 1450, rating: "good", delta: 1450, route: "/chat", timestamp: Date.now() - 3300 },
    { id: "20", name: "FCP", value: 1950, rating: "needs-improvement", delta: 1950, route: "/admin/system", timestamp: Date.now() - 4300 },
    // TTFB samples
    { id: "21", name: "TTFB", value: 240, rating: "good", delta: 240, route: "/", timestamp: Date.now() - 1400 },
    { id: "22", name: "TTFB", value: 310, rating: "good", delta: 310, route: "/venues", timestamp: Date.now() - 2400 },
    { id: "23", name: "TTFB", value: 480, rating: "good", delta: 480, route: "/chat", timestamp: Date.now() - 3400 },
    { id: "24", name: "TTFB", value: 620, rating: "good", delta: 620, route: "/admin/system", timestamp: Date.now() - 4400 },
  ];

  const stored = getStoredWebVitals();
  const allEntries = stored.length > 0 ? [...defaultEntries, ...stored] : defaultEntries;
  return aggregateWebVitals(allEntries, timeRange);
}
