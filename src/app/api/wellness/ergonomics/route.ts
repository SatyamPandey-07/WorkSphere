/**
 * route.ts
 * /api/wellness/ergonomics
 * Handles ergonomic strain score computation, micro-stretch routines, posture check-in logging,
 * and sit-stand duration tracking.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  ErgonomicCoachEngine,
  MICRO_STRETCH_CATALOG,
  ErgonomicSessionState,
} from "@/lib/wellness/ergonomicCoachEngine";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category");

    let routines = MICRO_STRETCH_CATALOG;
    if (category) {
      routines = routines.filter((r) => r.category === category);
    }

    const defaultState: ErgonomicSessionState = {
      sessionId: `ergo-${Date.now()}`,
      deskType: "height_adjustable_sit_stand",
      currentPostureState: "sitting",
      sessionStartTime: Date.now() - 3600000 * 1.5, // 1.5 hours ago simulated
      lastPostureStateChange: Date.now() - 1800000,
      totalSittingSeconds: 3600,
      totalStandingSeconds: 1800,
      completedStretches: ["neck-chin-tuck"],
      postureCheckIns: [
        { timestamp: Date.now() - 2400000, rating: "aligned" },
        { timestamp: Date.now() - 900000, rating: "slouching" },
      ],
      waterIntakeMl: 500,
      waterTargetMl: 1500,
      eyeBreaksCompleted: 3,
      skippedBreaksCount: 1,
    };

    const targetRatio = Number(searchParams.get("targetRatio")) || 2.0;

    const initialScore = ErgonomicCoachEngine.calculateStrainScore(defaultState);
    const nextStretch = ErgonomicCoachEngine.getRecommendedStretch(defaultState);
    const sitStandRatio = ErgonomicCoachEngine.calculateSitStandRatio(
      defaultState.totalSittingSeconds,
      defaultState.totalStandingSeconds
    );
    const weeklyAnalytics = ErgonomicCoachEngine.computeWeeklySummary(undefined, targetRatio);

    return NextResponse.json({
      success: true,
      routines,
      defaultState,
      initialScore,
      nextStretch,
      sitStandRatio,
      weeklyAnalytics,
    });
  } catch (error: any) {
    console.error("[GET /api/wellness/ergonomics] Error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve ergonomic routines", details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sessionState: ErgonomicSessionState = {
      sessionId: body.sessionId || `ergo-${Date.now()}`,
      userId: body.userId,
      deskType: body.deskType || "standard_seated",
      currentPostureState: body.currentPostureState || "sitting",
      sessionStartTime: Number(body.sessionStartTime) || Date.now(),
      lastPostureStateChange: Number(body.lastPostureStateChange) || Date.now(),
      totalSittingSeconds: Number(body.totalSittingSeconds) || 0,
      totalStandingSeconds: Number(body.totalStandingSeconds) || 0,
      completedStretches: Array.isArray(body.completedStretches) ? body.completedStretches : [],
      postureCheckIns: Array.isArray(body.postureCheckIns) ? body.postureCheckIns : [],
      waterIntakeMl: Number(body.waterIntakeMl) || 0,
      waterTargetMl: Number(body.waterTargetMl) || 2000,
      eyeBreaksCompleted: Number(body.eyeBreaksCompleted) || 0,
      skippedBreaksCount: Number(body.skippedBreaksCount) || 0,
      transitionsCount: Number(body.transitionsCount) || 0,
      targetSitStandRatio: Number(body.targetSitStandRatio) || 2.0,
    };

    const targetRatio = sessionState.targetSitStandRatio || 2.0;
    const strainScore = ErgonomicCoachEngine.calculateStrainScore(sessionState);
    const recommendedStretch = ErgonomicCoachEngine.getRecommendedStretch(sessionState);
    const sitStandRatio = ErgonomicCoachEngine.calculateSitStandRatio(
      sessionState.totalSittingSeconds,
      sessionState.totalStandingSeconds
    );

    const dailyRecords = Array.isArray(body.dailyRecords) ? body.dailyRecords : undefined;
    const weeklyAnalytics = ErgonomicCoachEngine.computeWeeklySummary(dailyRecords, targetRatio);

    return NextResponse.json({
      success: true,
      strainScore,
      recommendedStretch,
      sitStandRatio,
      weeklyAnalytics,
      updatedState: sessionState,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[POST /api/wellness/ergonomics] Error:", error);
    return NextResponse.json(
      { error: "Failed to process ergonomic state update", details: error.message },
      { status: 500 }
    );
  }
}
