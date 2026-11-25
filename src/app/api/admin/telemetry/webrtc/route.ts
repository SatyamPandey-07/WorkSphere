import { NextRequest, NextResponse } from 'next/server';
import {
  defaultTelemetryCollector,
  type WebRtcTelemetryCollector,
} from '@/core/p2p/WebRtcTelemetryCollector';

export function createWebRtcTelemetryHandler(
  collector: WebRtcTelemetryCollector = defaultTelemetryCollector
) {
  return async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const formatParam = searchParams.get('format')?.toLowerCase();
    const acceptHeader = req.headers.get('accept')?.toLowerCase() ?? '';

    const wantsPrometheus =
      formatParam === 'prometheus' ||
      formatParam === 'prom' ||
      acceptHeader.includes('text/plain');

    if (wantsPrometheus) {
      return new NextResponse(collector.toPrometheusText(), {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    return NextResponse.json(
      {
        ok: true,
        timestamp: new Date().toISOString(),
        metrics: collector.getSummary(),
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  };
}

export const GET = createWebRtcTelemetryHandler();