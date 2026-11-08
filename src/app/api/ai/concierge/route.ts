/**
 * route.ts
 * /api/ai/concierge
 * Handles AI Concierge telemetry queries, environmental comfort assessments, and desk rebalancing passes.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  AutonomousConciergeEngine,
  EnvironmentalSensorFeed,
  MemberWorkspaceSession,
} from "@/lib/ai/autonomousConciergeEngine";

const MOCK_ZONES: EnvironmentalSensorFeed[] = [
  {
    venueId: "venue-sf-01",
    zoneId: "zone-outdoor-terrace",
    zoneName: "Skyline Outdoor Terrace",
    zoneType: "outdoor_terrace",
    temperatureC: 17.5,
    humidityPercent: 88,
    co2Ppm: 420,
    decibelLevel: 58,
    weatherCondition: "rain_storm",
    isDirectSunlight: false,
    occupancyCount: 8,
    maxCapacity: 25,
  },
  {
    venueId: "venue-sf-01",
    zoneId: "zone-open-atrium",
    zoneName: "Central Glass Atrium",
    zoneType: "open_floor",
    temperatureC: 22.0,
    humidityPercent: 45,
    co2Ppm: 1250,
    decibelLevel: 74,
    weatherCondition: "clear",
    isDirectSunlight: true,
    occupancyCount: 38,
    maxCapacity: 45,
  },
  {
    venueId: "venue-sf-01",
    zoneId: "zone-quiet-library",
    zoneName: "Deep Focus Acoustic Library",
    zoneType: "quiet_library",
    temperatureC: 21.5,
    humidityPercent: 42,
    co2Ppm: 680,
    decibelLevel: 42,
    weatherCondition: "clear",
    isDirectSunlight: false,
    occupancyCount: 14,
    maxCapacity: 30,
  },
  {
    venueId: "venue-sf-01",
    zoneId: "zone-biophilic-bay",
    zoneName: "Biophilic Garden Bay",
    zoneType: "window_bay",
    temperatureC: 22.2,
    humidityPercent: 48,
    co2Ppm: 540,
    decibelLevel: 48,
    weatherCondition: "clear",
    isDirectSunlight: true,
    occupancyCount: 12,
    maxCapacity: 20,
  },
];

const MOCK_MEMBERS: MemberWorkspaceSession[] = [
  {
    memberId: "mem-101",
    memberName: "Sarah Jenkins",
    currentDeskId: "Desk-Terrace-04",
    currentZoneId: "zone-outdoor-terrace",
    assignedZoneName: "Skyline Outdoor Terrace",
    deskType: "outdoor_terrace",
    preferences: {
      autoPilotEnabled: true,
      preferredNoiseLevel: "moderate",
      prefersNaturalLight: true,
      temperatureComfortC: 22,
    },
    currentComfortIndex: 20,
  },
  {
    memberId: "mem-102",
    memberName: "David Kim",
    currentDeskId: "Desk-Atrium-19",
    currentZoneId: "zone-open-atrium",
    assignedZoneName: "Central Glass Atrium",
    deskType: "open_desk",
    preferences: {
      autoPilotEnabled: true,
      preferredNoiseLevel: "silent",
      prefersNaturalLight: false,
      temperatureComfortC: 21,
    },
    currentComfortIndex: 45,
  },
  {
    memberId: "mem-103",
    memberName: "Elena Rostova",
    currentDeskId: "Desk-Library-08",
    currentZoneId: "zone-quiet-library",
    assignedZoneName: "Deep Focus Acoustic Library",
    deskType: "quiet_booth",
    preferences: {
      autoPilotEnabled: false,
      preferredNoiseLevel: "silent",
      prefersNaturalLight: false,
      temperatureComfortC: 21.5,
    },
    currentComfortIndex: 94,
  },
];

export async function GET(req: NextRequest) {
  try {
    const zonesWithComfort = MOCK_ZONES.map((zone) => ({
      ...zone,
      comfortScore: AutonomousConciergeEngine.calculateZoneComfort(zone),
    }));

    const result = AutonomousConciergeEngine.runRebalanceOptimizationPass(
      MOCK_ZONES,
      MOCK_MEMBERS
    );

    return NextResponse.json({
      success: true,
      zones: zonesWithComfort,
      activeMembers: MOCK_MEMBERS,
      rebalanceAnalysis: result,
      lastEvaluated: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[GET /api/ai/concierge] Error:", error);
    return NextResponse.json(
      { error: "Failed to evaluate concierge telemetry", details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const customSensors: EnvironmentalSensorFeed[] = body.sensors || MOCK_ZONES;
    const customSessions: MemberWorkspaceSession[] = body.sessions || MOCK_MEMBERS;

    const result = AutonomousConciergeEngine.runRebalanceOptimizationPass(
      customSensors,
      customSessions
    );

    return NextResponse.json({
      success: true,
      analysis: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[POST /api/ai/concierge] Error:", error);
    return NextResponse.json(
      { error: "Failed to run rebalance optimization", details: error.message },
      { status: 500 }
    );
  }
}
