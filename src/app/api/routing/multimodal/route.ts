import { NextRequest, NextResponse } from 'next/server';
import {
  computeEcoParetoRoutes,
  type EcoRoutingOptions,
  type GeoPoint,
} from '@/lib/routing/ecoRoutingEngine';

export interface EcoRoutingRequestBody {
  origin?: GeoPoint;
  destination?: GeoPoint;
}

function isValidPoint(pt: unknown): pt is GeoPoint {
  if (!pt || typeof pt !== 'object') return false;
  const p = pt as { lat?: unknown; lng?: unknown };
  return (
    typeof p.lat === 'number' &&
    Number.isFinite(p.lat) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    typeof p.lng === 'number' &&
    Number.isFinite(p.lng) &&
    p.lng >= -180 &&
    p.lng <= 180
  );
}

export function createMultimodalEcoHandler(routingOptions: EcoRoutingOptions = {}) {
  return async function POST(req: NextRequest) {
    const startedAt = performance.now();
    let body: EcoRoutingRequestBody | null = null;
    try {
      body = (await req.json()) as EcoRoutingRequestBody;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
    }

    if (!isValidPoint(body?.origin) || !isValidPoint(body?.destination)) {
      return NextResponse.json(
        { error: 'Valid origin and destination { lat, lng } coordinates are required' },
        { status: 400 }
      );
    }

    const routes = await computeEcoParetoRoutes(body.origin, body.destination, {
      maxLatencyMs: 400,
      ...routingOptions,
    });

    return NextResponse.json(
      {
        routes,
        count: routes.length,
        latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
      },
      { status: 200 }
    );
  };
}

export const POST = createMultimodalEcoHandler();