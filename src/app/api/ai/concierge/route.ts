import { NextResponse } from 'next/server';
import {
  evaluateVenueConcierge,
  type ConciergeMemberSession,
  type ConciergeSensorReading,
} from '@/lib/ai/autonomousConciergeEngine';

export interface ConciergeTelemetryProvider {
  loadVenueTelemetry(venueId: string): Promise<{
    readings: ConciergeSensorReading[];
    sessions: ConciergeMemberSession[];
  }>;
}

let activeProvider: ConciergeTelemetryProvider | null = null;

export function setConciergeTelemetryProvider(
  provider: ConciergeTelemetryProvider | null
): void {
  activeProvider = provider;
}

async function fetchTrustedVenueTelemetry(venueId: string): Promise<{
  available: boolean;
  readings: ConciergeSensorReading[];
  sessions: ConciergeMemberSession[];
}> {
  if (activeProvider) {
    try {
      const data = await activeProvider.loadVenueTelemetry(venueId);
      return {
        available: true,
        readings: data.readings ?? [],
        sessions: data.sessions ?? [],
      };
    } catch {
      return { available: false, readings: [], sessions: [] };
    }
  }

  try {
    const { prisma } = await import('@/lib/prisma');
    if (!prisma?.venueTelemetry?.findMany) {
      return { available: false, readings: [], sessions: [] };
    }

    const rawTelemetry = await prisma.venueTelemetry.findMany({
      where: { venueId },
      orderBy: { recordedAt: 'desc' },
      take: 200,
    });

    const readings: ConciergeSensorReading[] = rawTelemetry
      .map((row: any): ConciergeSensorReading | null => {
        const metricMap: Record<string, ConciergeSensorReading['metric']> = {
          temperature: 'temperature',
          humidity: 'humidity',
          co2: 'co2',
          noise_db: 'noiseDb',
          noiseDb: 'noiseDb',
        };
        const metric = metricMap[String(row.type)];
        if (!metric) return null;

        return {
          venueId: String(row.venueId),
          zoneId: row.roomId ? String(row.roomId) : 'default',
          sensorId: row.sensorId ? String(row.sensorId) : undefined,
          metric,
          value: Number(row.value),
          recordedAt: row.recordedAt,
          source: 'prisma.venueTelemetry',
        };
      })
      .filter(
        (item: ConciergeSensorReading | null): item is ConciergeSensorReading =>
          item !== null
      );

    return { available: true, readings, sessions: [] };
  } catch {
    return { available: false, readings: [], sessions: [] };
  }
}

function isSimulationOverrideAuthorized(request: Request, body: any): boolean {
  const wantsOverride = Boolean(
    body?.simulationMode === true ||
      Array.isArray(body?.readings) ||
      Array.isArray(body?.sessions)
  );
  if (!wantsOverride) return false;

  const simEnvEnabled = process.env.ALLOW_AI_CONCIERGE_SIMULATION === 'true';
  const simHeader = request.headers.get('x-concierge-simulation-key');
  const expectedKey = process.env.AI_CONCIERGE_SIMULATION_KEY;

  if (!simEnvEnabled || body?.simulationMode !== true) {
    return false;
  }
  if (expectedKey && simHeader !== expectedKey) {
    return false;
  }
  return true;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const venueId = searchParams.get('venueId')?.trim() ?? '';

  if (!venueId) {
    return NextResponse.json(
      { error: 'Explicit venueId query parameter is required.' },
      { status: 400 }
    );
  }

  const telemetry = await fetchTrustedVenueTelemetry(venueId);
  if (!telemetry.available) {
    return NextResponse.json(
      {
        venueId,
        telemetryStatus: 'unavailable',
        zones: [],
        recommendations: [],
        warnings: ['Live telemetry data source is unavailable.'],
      },
      { status: 503 }
    );
  }

  const result = evaluateVenueConcierge({
    venueId,
    readings: telemetry.readings,
    sessions: telemetry.sessions,
    isSimulation: false,
  });

  return NextResponse.json(result, { status: 200 });
}

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON request body.' },
      { status: 400 }
    );
  }

  const venueId = typeof body?.venueId === 'string' ? body.venueId.trim() : '';
  if (!venueId) {
    return NextResponse.json(
      { error: 'Explicit venueId is required.' },
      { status: 400 }
    );
  }

  const hasClientOverridePayload = Boolean(
    body?.simulationMode !== undefined ||
      body?.readings !== undefined ||
      body?.sessions !== undefined
  );

  if (hasClientOverridePayload && !isSimulationOverrideAuthorized(request, body)) {
    return NextResponse.json(
      {
        error:
          'Client-supplied sensor/session overrides are forbidden unless authorized in simulation mode.',
      },
      { status: 403 }
    );
  }

  if (isSimulationOverrideAuthorized(request, body)) {
    const result = evaluateVenueConcierge({
      venueId,
      readings: Array.isArray(body.readings) ? body.readings : [],
      sessions: Array.isArray(body.sessions) ? body.sessions : [],
      isSimulation: true,
    });
    return NextResponse.json(result, { status: 200 });
  }

  const telemetry = await fetchTrustedVenueTelemetry(venueId);
  if (!telemetry.available) {
    return NextResponse.json(
      {
        venueId,
        telemetryStatus: 'unavailable',
        zones: [],
        recommendations: [],
        warnings: ['Live telemetry data source is unavailable.'],
      },
      { status: 503 }
    );
  }

  const result = evaluateVenueConcierge({
    venueId,
    readings: telemetry.readings,
    sessions: telemetry.sessions,
    isSimulation: false,
  });

  return NextResponse.json(result, { status: 200 });
}