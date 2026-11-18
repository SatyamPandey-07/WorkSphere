/**
 * System Vital Metrics & Web Vitals Exporter (CSV format).
 *
 * Implements standard RFC-4180 compliant CSV exports for admin system
 * performance telemetry, database query latencies, agent runtimes, and Web Vitals.
 */

import { CsvBuilder, escapeCSVField, triggerBrowserDownload } from "../csvBuilder";
import {
  WEB_VITALS_THRESHOLDS,
  type AggregatedWebVitals,
  type WebVitalMetricName,
} from "@/lib/webVitalsCollector";
import { prisma } from "@/lib/prisma";

export interface SystemVitalsOverview {
  totalSearches: number;
  totalVenueClicks: number;
  totalReviews: number;
  agentAvgMs: number;
  agentP95Ms: number;
  totalDbQueries?: number;
  slowDbQueries?: number;
  dbAvgMs?: number;
  dbP95Ms?: number;
}

export interface SystemVitalsExportData {
  range: string;
  generatedAt: string;
  overview: {
    totalSearches: number;
    totalVenueClicks: number;
    totalReviews: number;
    agentAvgMs: number;
    agentP95Ms: number;
  };
  usageTrend: Array<{
    date: string;
    searches: number;
    venueClicks: number;
    reviews: number;
  }>;
  agentLatencyTrend: Array<{
    date: string;
    avgMs: number;
    p95Ms: number;
    runs: number;
  }>;
  agentBreakdown: Array<{
    agent: string;
    avgMs: number;
    p95Ms: number;
    runs: number;
  }>;
  dbLatency: {
    totalQueryCount: number;
    slowQueryCount: number;
    slowQueryThresholdMs: number;
    avgMs: number;
    p95Ms: number;
    byModel: Array<{
      model: string;
      avgMs: number;
      p95Ms: number;
      sampleCount: number;
    }>;
  };
  webVitals?: AggregatedWebVitals | null;
}

/**
 * Generates an RFC-4180 formatted CSV string representing system vital metrics.
 */
export function generateSystemVitalsCSV(data: SystemVitalsExportData): string {
  if (!data) return "";

  const builder = new CsvBuilder({
    lineDelimiter: "\r\n",
    sanitizeFormulas: true,
  });

  const range = data.range || "7d";
  const generatedAt = data.generatedAt || new Date().toISOString();
  const overview = data.overview || {
    totalSearches: 0,
    totalVenueClicks: 0,
    totalReviews: 0,
    agentAvgMs: 0,
    agentP95Ms: 0,
  };
  const dbLatency = data.dbLatency || {
    totalQueryCount: 0,
    slowQueryCount: 0,
    slowQueryThresholdMs: 100,
    avgMs: 0,
    p95Ms: 0,
    byModel: [],
  };

  // Section 1: System Vitals Overview
  builder.addSectionHeader("SYSTEM VITAL METRICS OVERVIEW");
  builder.addRawLine(`Time Range,${escapeCSVField(range)}`);
  builder.addRawLine(`Generated At,${escapeCSVField(generatedAt)}`);
  builder.addRawLine(`Total Search Queries,${overview.totalSearches ?? 0}`);
  builder.addRawLine(`Total Venue Views,${overview.totalVenueClicks ?? 0}`);
  builder.addRawLine(`Total User Reviews,${overview.totalReviews ?? 0}`);
  builder.addRawLine(`AI Agent Avg Latency (ms),${overview.agentAvgMs ?? 0}`);
  builder.addRawLine(`AI Agent P95 Latency (ms),${overview.agentP95Ms ?? 0}`);
  builder.addRawLine(
    `Total DB Queries Sampled,${dbLatency.totalQueryCount ?? 0}`,
  );
  builder.addRawLine(
    `Slow DB Queries (> ${dbLatency.slowQueryThresholdMs ?? 100}ms),${dbLatency.slowQueryCount ?? 0}`,
  );
  builder.addRawLine(`Database Avg Query Latency (ms),${dbLatency.avgMs ?? 0}`);
  builder.addRawLine(`Database P95 Query Latency (ms),${dbLatency.p95Ms ?? 0}`);
  builder.addBlankLine();

  // Section 2: Core Web Vitals (if present)
  if (data.webVitals) {
    const overallScore = Number.isFinite(data.webVitals.overallScore)
      ? data.webVitals.overallScore
      : 0;
    const totalSamples = Number.isFinite(data.webVitals.totalSamples)
      ? data.webVitals.totalSamples
      : 0;

    builder.addSectionHeader("CORE WEB VITALS METRICS");
    builder.addRawLine(`Overall Web Vitals Score,${overallScore} / 100`);
    builder.addRawLine(`Total Telemetry Samples,${totalSamples}`);
    builder.addBlankLine();

    builder.addRawLine(
      "Metric,Unit,p50,p75 (Standard),p90,Rating,Samples,Good %,Needs Improvement %,Poor %",
    );
    const metricKeys: WebVitalMetricName[] = [
      "LCP",
      "INP",
      "CLS",
      "FCP",
      "TTFB",
    ];
    for (const key of metricKeys) {
      const metric = data.webVitals.metrics ? data.webVitals.metrics[key] : undefined;
      if (metric) {
        const p50Val = Number.isFinite(metric.p50) ? metric.p50 : 0;
        const p75Val = Number.isFinite(metric.p75) ? metric.p75 : 0;
        const p90Val = Number.isFinite(metric.p90) ? metric.p90 : 0;

        const p50Str =
          key === "CLS"
            ? p50Val.toFixed(3)
            : Math.round(p50Val).toString();
        const p75Str =
          key === "CLS"
            ? p75Val.toFixed(3)
            : Math.round(p75Val).toString();
        const p90Str =
          key === "CLS"
            ? p90Val.toFixed(3)
            : Math.round(p90Val).toString();

        const unit = WEB_VITALS_THRESHOLDS[key]?.unit || "";
        const rating = metric.rating || "good";
        const sampleCount = metric.sampleCount ?? 0;
        const dist = metric.distribution || { good: 0, needsImprovement: 0, poor: 0 };

        builder.addRawLine(
          `${key},${escapeCSVField(unit)},${p50Str},${p75Str},${p90Str},${escapeCSVField(rating)},${sampleCount},${dist.good ?? 0}%,${dist.needsImprovement ?? 0}%,${dist.poor ?? 0}%`,
        );
      }
    }
    builder.addBlankLine();

    // Route-level breakdowns
    if (Array.isArray(data.webVitals.routes) && data.webVitals.routes.length > 0) {
      builder.addSectionHeader("WEB VITALS BY ROUTE");
      builder.addRawLine("Route,Metric,p75,Rating,Sample Count");
      for (const route of data.webVitals.routes) {
        if (!route || !route.metrics) continue;
        for (const [mName, mSummary] of Object.entries(route.metrics)) {
          if (mSummary) {
            const p75Val = Number.isFinite(mSummary.p75) ? mSummary.p75 : 0;
            const p75Formatted =
              mName === "CLS"
                ? p75Val.toFixed(3)
                : Math.round(p75Val).toString();
            const rating = mSummary.rating || "good";
            const sampleCount = mSummary.sampleCount ?? 0;
            builder.addRawLine(
              `${escapeCSVField(route.route || "/")},${mName},${p75Formatted},${escapeCSVField(rating)},${sampleCount}`,
            );
          }
        }
      }
      builder.addBlankLine();
    }
  }

  // Section 3: Daily Platform Usage Trends
  if (Array.isArray(data.usageTrend) && data.usageTrend.length > 0) {
    builder.addSectionHeader("DAILY PLATFORM USAGE TRENDS");
    builder.addRawLine("Date,Search Queries,Venue Clicks,User Reviews");
    for (const row of data.usageTrend) {
      if (!row) continue;
      builder.addRawLine(
        `${escapeCSVField(row.date || "")},${row.searches ?? 0},${row.venueClicks ?? 0},${row.reviews ?? 0}`,
      );
    }
    builder.addBlankLine();
  }

  // Section 4: AI Agent Execution Latency Trends
  if (Array.isArray(data.agentLatencyTrend) && data.agentLatencyTrend.length > 0) {
    builder.addSectionHeader("AI AGENT LATENCY TRENDS");
    builder.addRawLine("Date,Avg Duration (ms),P95 Duration (ms),Execution Runs");
    for (const row of data.agentLatencyTrend) {
      if (!row) continue;
      builder.addRawLine(
        `${escapeCSVField(row.date || "")},${row.avgMs ?? 0},${row.p95Ms ?? 0},${row.runs ?? 0}`,
      );
    }
    builder.addBlankLine();
  }

  // Section 5: AI Agent Breakdown by Type
  if (Array.isArray(data.agentBreakdown) && data.agentBreakdown.length > 0) {
    builder.addSectionHeader("AI AGENT RUNTIME BREAKDOWN");
    builder.addRawLine(
      "Agent Name,Avg Duration (ms),P95 Duration (ms),Total Executions",
    );
    for (const row of data.agentBreakdown) {
      if (!row) continue;
      builder.addRawLine(
        `${escapeCSVField(row.agent || "Agent")},${row.avgMs ?? 0},${row.p95Ms ?? 0},${row.runs ?? 0}`,
      );
    }
    builder.addBlankLine();
  }

  // Section 6: Database Query Latency by Model
  if (Array.isArray(dbLatency.byModel) && dbLatency.byModel.length > 0) {
    builder.addSectionHeader("DATABASE QUERY LATENCY BY MODEL");
    builder.addRawLine(
      "Model Name,Avg Latency (ms),P95 Latency (ms),Sample Count",
    );
    for (const row of dbLatency.byModel) {
      if (!row) continue;
      builder.addRawLine(
        `${escapeCSVField(row.model || "Unknown")},${row.avgMs ?? 0},${row.p95Ms ?? 0},${row.sampleCount ?? 0}`,
      );
    }
  }

  return builder.build();
}

/**
 * Triggers a client-side CSV download of system vital metrics.
 */
export function downloadSystemVitalsCSV(
  data: SystemVitalsExportData,
  filename?: string,
): Blob {
  const range = data?.range || "7d";
  const today = new Date().toISOString().slice(0, 10);
  const downloadFileName =
    filename || `worksphere-system-vitals-${range}-${today}.csv`;

  const csvContent = generateSystemVitalsCSV(data);
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  triggerBrowserDownload(blob, downloadFileName);
  return blob;
}

/**
 * Generates an RFC-4180 formatted CSV specifically for Web Vitals telemetry.
 */
export function generateWebVitalsCSV(data: AggregatedWebVitals): string {
  if (!data) return "";

  const builder = new CsvBuilder({
    lineDelimiter: "\r\n",
    sanitizeFormulas: true,
  });

  const timeRange = data.timeRange || "7d";
  const generatedAt = data.generatedAt || new Date().toISOString();
  const overallScore = Number.isFinite(data.overallScore) ? data.overallScore : 0;
  const totalSamples = Number.isFinite(data.totalSamples) ? data.totalSamples : 0;

  builder.addSectionHeader("GOOGLE WEB VITALS PERFORMANCE REPORT");
  builder.addRawLine(`Time Range,${escapeCSVField(timeRange)}`);
  builder.addRawLine(`Generated At,${escapeCSVField(generatedAt)}`);
  builder.addRawLine(`Overall Performance Score,${overallScore} / 100`);
  builder.addRawLine(`Total Evaluated Samples,${totalSamples}`);
  builder.addBlankLine();

  builder.addSectionHeader("CORE METRIC PERCENTILES & RATINGS");
  builder.addRawLine(
    "Metric,Unit,p50,p75 (Standard),p90,Rating,Sample Count,Good %,Needs Improvement %,Poor %",
  );
  const metricKeys: WebVitalMetricName[] = ["LCP", "INP", "CLS", "FCP", "TTFB"];
  for (const key of metricKeys) {
    const metric = data.metrics ? data.metrics[key] : undefined;
    if (metric) {
      const p50Val = Number.isFinite(metric.p50) ? metric.p50 : 0;
      const p75Val = Number.isFinite(metric.p75) ? metric.p75 : 0;
      const p90Val = Number.isFinite(metric.p90) ? metric.p90 : 0;

      const p50Str =
        key === "CLS"
          ? p50Val.toFixed(3)
          : Math.round(p50Val).toString();
      const p75Str =
        key === "CLS"
          ? p75Val.toFixed(3)
          : Math.round(p75Val).toString();
      const p90Str =
        key === "CLS"
          ? p90Val.toFixed(3)
          : Math.round(p90Val).toString();

      const unit = WEB_VITALS_THRESHOLDS[key]?.unit || "";
      const rating = metric.rating || "good";
      const sampleCount = metric.sampleCount ?? 0;
      const dist = metric.distribution || { good: 0, needsImprovement: 0, poor: 0 };

      builder.addRawLine(
        `${key},${escapeCSVField(unit)},${p50Str},${p75Str},${p90Str},${escapeCSVField(rating)},${sampleCount},${dist.good ?? 0}%,${dist.needsImprovement ?? 0}%,${dist.poor ?? 0}%`,
      );
    }
  }
  builder.addBlankLine();

  if (Array.isArray(data.routes) && data.routes.length > 0) {
    builder.addSectionHeader("ROUTE-LEVEL BREAKDOWN");
    builder.addRawLine("Route,Metric,p75 Value,Rating,Sample Count");
    for (const route of data.routes) {
      if (!route || !route.metrics) continue;
      for (const [mName, mSummary] of Object.entries(route.metrics)) {
        if (mSummary) {
          const p75Val = Number.isFinite(mSummary.p75) ? mSummary.p75 : 0;
          const p75Formatted =
            mName === "CLS"
              ? p75Val.toFixed(3)
              : Math.round(p75Val).toString();
          const rating = mSummary.rating || "good";
          const sampleCount = mSummary.sampleCount ?? 0;
          builder.addRawLine(
            `${escapeCSVField(route.route || "/")},${mName},${p75Formatted},${escapeCSVField(rating)},${sampleCount}`,
          );
        }
      }
    }
  }

  return builder.build();
}

/**
 * Triggers a client-side CSV download of Web Vitals metrics.
 */
export function downloadWebVitalsCSV(
  data: AggregatedWebVitals,
  filename?: string,
): Blob {
  const timeRange = data?.timeRange || "7d";
  const today = new Date().toISOString().slice(0, 10);
  const downloadFileName =
    filename || `worksphere-web-vitals-${timeRange}-${today}.csv`;

  const csvContent = generateWebVitalsCSV(data);
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  triggerBrowserDownload(blob, downloadFileName);
  return blob;
}

// ─── Chunked Streaming System Vitals & Telemetry Exporter (#5038) ─────────────

export interface StreamTelemetryOptions {
  range?: string;
  batchSize?: number;
  venueId?: string;
  startDate?: Date;
  endDate?: Date;
}

export function parseRangeToStartDate(range?: string): Date {
  const now = new Date();
  switch (range) {
    case "24h":
    case "1d":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "90d":
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    case "all":
      return new Date(0);
    default:
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
}

/**
 * Creates a ReadableStream that queries TelemetryRecord using Prisma cursor pagination
 * (default batch size 1000) and streams RFC-4180 CSV rows directly without buffering
 * the complete table into memory.
 */
export function createTelemetryCsvStream(
  options: StreamTelemetryOptions = {},
): ReadableStream<Uint8Array> {
  const batchSize = Math.max(1, Math.min(5000, options.batchSize || 1000));
  const encoder = new TextEncoder();
  const startDate = options.startDate || parseRangeToStartDate(options.range);

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Enqueue CSV Header row
        const header =
          "id,venueId,download_mbps,upload_mbps,latency_ms,noise_level,occupancy,presence,crowd_level,timestamp\r\n";
        controller.enqueue(encoder.encode(header));

        let cursor:
          { id_timestamp: { id: string; timestamp: Date } } | undefined =
          undefined;
        let hasMore = true;

        while (hasMore) {
          let records: any[] = [];
          try {
            records = await (prisma as any).telemetryRecord.findMany({
              take: batchSize,
              skip: cursor ? 1 : 0,
              cursor: cursor
                ? { id_timestamp: cursor.id_timestamp }
                : undefined,
              where: {
                timestamp: { gte: startDate },
                ...(options.venueId ? { venueId: options.venueId } : {}),
              },
              orderBy: [{ timestamp: "asc" }, { id: "asc" }],
            });
          } catch {
            hasMore = false;
            break;
          }

          if (!records || records.length === 0) {
            hasMore = false;
            break;
          }

          // Format batch into CSV chunk
          let chunk = "";
          for (const r of records) {
            const timeStr =
              r.timestamp instanceof Date
                ? r.timestamp.toISOString()
                : String(r.timestamp);
            chunk += `${escapeCSVField(r.id)},${escapeCSVField(r.venueId)},${r.download ?? ""},${r.upload ?? ""},${r.latency ?? ""},${r.noiseLevel ?? ""},${r.occupancy ?? ""},${r.presence ?? ""},${escapeCSVField(r.crowdLevel ?? "")},${escapeCSVField(timeStr)}\r\n`;
          }

          controller.enqueue(encoder.encode(chunk));

          if (records.length < batchSize) {
            hasMore = false;
            break;
          }

          const lastRecord = records[records.length - 1];
          cursor = {
            id_timestamp: {
              id: lastRecord.id,
              timestamp:
                lastRecord.timestamp instanceof Date
                  ? lastRecord.timestamp
                  : new Date(lastRecord.timestamp),
            },
          };
        }

        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}
