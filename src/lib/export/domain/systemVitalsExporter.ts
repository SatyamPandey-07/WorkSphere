/**
 * System Vital Metrics & Web Vitals Exporter (CSV format).
 *
 * Implements standard RFC-4180 compliant CSV exports for admin system
 * performance telemetry, database query latencies, agent runtimes, and Web Vitals.
 */

import { CsvBuilder, escapeCSVField } from "../csvBuilder";
import type { AggregatedWebVitals, WebVitalMetricName } from "@/lib/webVitalsCollector";
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
  const builder = new CsvBuilder({ lineDelimiter: "\r\n", sanitizeFormulas: true });

  // Section 1: System Vitals Overview
  builder.addSectionHeader("SYSTEM VITAL METRICS OVERVIEW");
  builder.addRawLine(`Time Range,${escapeCSVField(data.range)}`);
  builder.addRawLine(`Generated At,${escapeCSVField(data.generatedAt)}`);
  builder.addRawLine(`Total Search Queries,${data.overview.totalSearches}`);
  builder.addRawLine(`Total Venue Views,${data.overview.totalVenueClicks}`);
  builder.addRawLine(`Total User Reviews,${data.overview.totalReviews}`);
  builder.addRawLine(`AI Agent Avg Latency (ms),${data.overview.agentAvgMs}`);
  builder.addRawLine(`AI Agent P95 Latency (ms),${data.overview.agentP95Ms}`);
  builder.addRawLine(`Total DB Queries Sampled,${data.dbLatency.totalQueryCount}`);
  builder.addRawLine(`Slow DB Queries (> ${data.dbLatency.slowQueryThresholdMs}ms),${data.dbLatency.slowQueryCount}`);
  builder.addRawLine(`Database Avg Query Latency (ms),${data.dbLatency.avgMs}`);
  builder.addRawLine(`Database P95 Query Latency (ms),${data.dbLatency.p95Ms}`);
  builder.addBlankLine();

  // Section 2: Core Web Vitals (if present)
  if (data.webVitals) {
    builder.addSectionHeader("CORE WEB VITALS METRICS");
    builder.addRawLine(`Overall Web Vitals Score,${data.webVitals.overallScore} / 100`);
    builder.addRawLine(`Total Telemetry Samples,${data.webVitals.totalSamples}`);
    builder.addBlankLine();

    builder.addRawLine("Metric,Unit,p50,p75 (Standard),p90,Rating,Samples,Good %,Needs Improvement %,Poor %");
    const metricKeys: WebVitalMetricName[] = ["LCP", "INP", "CLS", "FCP", "TTFB"];
    for (const key of metricKeys) {
      const metric = data.webVitals.metrics[key];
      if (metric) {
        const p50Str = key === "CLS" ? metric.p50.toFixed(3) : Math.round(metric.p50).toString();
        const p75Str = key === "CLS" ? metric.p75.toFixed(3) : Math.round(metric.p75).toString();
        const p90Str = key === "CLS" ? metric.p90.toFixed(3) : Math.round(metric.p90).toString();
        builder.addRawLine(
          `${key},${escapeCSVField(metric.unit)},${p50Str},${p75Str},${p90Str},${escapeCSVField(metric.rating)},${metric.sampleCount},${metric.distribution.good}%,${metric.distribution.needsImprovement}%,${metric.distribution.poor}%`
        );
      }
    }
    builder.addBlankLine();

    // Route-level breakdowns
    if (data.webVitals.routes && data.webVitals.routes.length > 0) {
      builder.addSectionHeader("WEB VITALS BY ROUTE");
      builder.addRawLine("Route,Metric,p75,Rating,Sample Count");
      for (const route of data.webVitals.routes) {
        for (const [mName, mSummary] of Object.entries(route.metrics)) {
          if (mSummary) {
            const p75Formatted = mName === "CLS" ? mSummary.p75.toFixed(3) : Math.round(mSummary.p75).toString();
            builder.addRawLine(
              `${escapeCSVField(route.route)},${mName},${p75Formatted},${escapeCSVField(mSummary.rating)},${mSummary.sampleCount}`
            );
          }
        }
      }
      builder.addBlankLine();
    }
  }

  // Section 3: Daily Platform Usage Trends
  builder.addSectionHeader("DAILY PLATFORM USAGE TRENDS");
  builder.addRawLine("Date,Search Queries,Venue Clicks,User Reviews");
  for (const row of data.usageTrend) {
    builder.addRawLine(`${escapeCSVField(row.date)},${row.searches},${row.venueClicks},${row.reviews}`);
  }
  builder.addBlankLine();

  // Section 4: AI Agent Execution Latency Trends
  builder.addSectionHeader("AI AGENT LATENCY TRENDS");
  builder.addRawLine("Date,Avg Duration (ms),P95 Duration (ms),Execution Runs");
  for (const row of data.agentLatencyTrend) {
    builder.addRawLine(`${escapeCSVField(row.date)},${row.avgMs},${row.p95Ms},${row.runs}`);
  }
  builder.addBlankLine();

  // Section 5: AI Agent Breakdown by Type
  builder.addSectionHeader("AI AGENT RUNTIME BREAKDOWN");
  builder.addRawLine("Agent Name,Avg Duration (ms),P95 Duration (ms),Total Executions");
  for (const row of data.agentBreakdown) {
    builder.addRawLine(`${escapeCSVField(row.agent)},${row.avgMs},${row.p95Ms},${row.runs}`);
  }
  builder.addBlankLine();

  // Section 6: Database Query Latency by Model
  builder.addSectionHeader("DATABASE QUERY LATENCY BY MODEL");
  builder.addRawLine("Model Name,Avg Latency (ms),P95 Latency (ms),Sample Count");
  for (const row of data.dbLatency.byModel) {
    builder.addRawLine(`${escapeCSVField(row.model)},${row.avgMs},${row.p95Ms},${row.sampleCount}`);
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
  const today = new Date().toISOString().slice(0, 10);
  const downloadFileName =
    filename || `worksphere-system-vitals-${data.range}-${today}.csv`;

  const csvContent = generateSystemVitalsCSV(data);
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const builder = new CsvBuilder();
  return builder.download.call({ toBlob: () => blob }, downloadFileName);
}

/**
 * Generates an RFC-4180 formatted CSV specifically for Web Vitals telemetry.
 */
export function generateWebVitalsCSV(data: AggregatedWebVitals): string {
  const builder = new CsvBuilder({ lineDelimiter: "\r\n", sanitizeFormulas: true });

  builder.addSectionHeader("GOOGLE WEB VITALS PERFORMANCE REPORT");
  builder.addRawLine(`Time Range,${escapeCSVField(data.range)}`);
  builder.addRawLine(`Generated At,${escapeCSVField(data.generatedAt)}`);
  builder.addRawLine(`Overall Performance Score,${data.overallScore} / 100`);
  builder.addRawLine(`Total Evaluated Samples,${data.totalSamples}`);
  builder.addBlankLine();

  builder.addSectionHeader("CORE METRIC PERCENTILES & RATINGS");
  builder.addRawLine("Metric,Unit,p50,p75 (Standard),p90,Rating,Sample Count,Good %,Needs Improvement %,Poor %");
  const metricKeys: WebVitalMetricName[] = ["LCP", "INP", "CLS", "FCP", "TTFB"];
  for (const key of metricKeys) {
    const metric = data.metrics[key];
    if (metric) {
      const p50Str = key === "CLS" ? metric.p50.toFixed(3) : Math.round(metric.p50).toString();
      const p75Str = key === "CLS" ? metric.p75.toFixed(3) : Math.round(metric.p75).toString();
      const p90Str = key === "CLS" ? metric.p90.toFixed(3) : Math.round(metric.p90).toString();
      builder.addRawLine(
        `${key},${escapeCSVField(metric.unit)},${p50Str},${p75Str},${p90Str},${escapeCSVField(metric.rating)},${metric.sampleCount},${metric.distribution.good}%,${metric.distribution.needsImprovement}%,${metric.distribution.poor}%`
      );
    }
  }
  builder.addBlankLine();

  if (data.routes && data.routes.length > 0) {
    builder.addSectionHeader("ROUTE-LEVEL BREAKDOWN");
    builder.addRawLine("Route,Metric,p75 Value,Rating,Sample Count");
    for (const route of data.routes) {
      for (const [mName, mSummary] of Object.entries(route.metrics)) {
        if (mSummary) {
          const p75Formatted = mName === "CLS" ? mSummary.p75.toFixed(3) : Math.round(mSummary.p75).toString();
          builder.addRawLine(
            `${escapeCSVField(route.route)},${mName},${p75Formatted},${escapeCSVField(mSummary.rating)},${mSummary.sampleCount}`
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
  const today = new Date().toISOString().slice(0, 10);
  const downloadFileName =
    filename || `worksphere-web-vitals-${data.range}-${today}.csv`;

  const csvContent = generateWebVitalsCSV(data);
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const builder = new CsvBuilder();
  return builder.download.call({ toBlob: () => blob }, downloadFileName);
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
          | { id_timestamp: { id: string; timestamp: Date } }
          | undefined = undefined;
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

