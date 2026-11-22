import { NextResponse } from 'next/server';
import {
  buildEcoRouteOptions,
  type EcoRoutingHooks,
  type GeoPoint,
} from '@/lib/routing/ecoRoutingEngine';

export const ROUTING_SLA_BUDGET_MS = 450;
export const INTERNAL_DEADLINE_MS = 400;

export interface MultimodalRoutingRequest {
  origin: GeoPoint;
  destination: GeoPoint;
  hooks?: EcoRoutingHooks;
}

function isValidPoint(pt: unknown): pt is GeoPoint {
  if (!pt || typeof pt !== 'object') return false;
  const candidate = pt as { lat?: unknown; lng?: unknown };
  return (
    typeof candidate.lat === 'number' &&
    Number.isFinite(candidate.lat) &&
    candidate.lat >= -90 &&
    candidate.lat <= 90 &&
    typeof candidate.lng === 'number' &&
    Number.isFinite(candidate.lng) &&
    candidate.lng >= -180 &&
    candidate.lng <= 180
  );
}

export async function handleMultimodalEcoPost(
  body: unknown,
  options: { deadlineMs?: number; hooks?: EcoRoutingHooks } = {}
) {
  const startedAt = Date.now();
  const deadlineMs = options.deadlineMs ?? INTERNAL_DEADLINE_MS;

  if (!body || typeof body !== 'object') {
    return {
      status: 400,
      payload: { error: 'Invalid JSON request body.' },
    };
  }

  const reqBody = body as MultimodalRoutingRequest;
  if (!isValidPoint(reqBody.origin) || !isValidPoint(reqBody.destination)) {
    return {
      status: 400,
      payload: {
        error: 'Valid origin and destination { lat, lng } coordinates are required.',
      },
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), deadlineMs);

  try {
    const mergedHooks: EcoRoutingHooks = {
      ...reqBody.hooks,
      ...options.hooks,
    };

    const routes = await Promise.race([
      buildEcoRouteOptions(
        reqBody.origin,
        reqBody.destination,
        mergedHooks,
        controller.signal
      ),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new Error('ROUTING_DEADLINE_EXCEEDED'));
        });
      }),
    ]);

    const elapsedMs = Date.now() - startedAt;
    return {
      status: 200,
      payload: {
        routes,
        paretoRoutes: routes.filter((r) => r.paretoOptimal),
        slaBudgetMs: ROUTING_SLA_BUDGET_MS,
        latencyMs: elapsedMs,
        degradedFallback: false,
      },
    };
  } catch {
    const fallbackRoutes = await buildEcoRouteOptions(
      reqBody.origin,
      reqBody.destination,
      {}
    );
    const elapsedMs = Date.now() - startedAt;

    return {
      status: 200,
      payload: {
        routes: fallbackRoutes,
        paretoRoutes: fallbackRoutes.filter((r) => r.paretoOptimal),
        slaBudgetMs: ROUTING_SLA_BUDGET_MS,
        latencyMs: elapsedMs,
        degradedFallback: true,
      },
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Malformed JSON payload.' },
      { status: 400 }
    );
  }

  const result = await handleMultimodalEcoPost(body);
  return NextResponse.json(result.payload, { status: result.status });
}