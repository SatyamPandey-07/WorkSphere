/**
 * route.ts
 * /api/social/focus-room
 * Returns active virtual focus room synchronization state and peer intentions.
 */

import { NextRequest, NextResponse } from "next/server";
import type { PeerSprintIntention } from "@/lib/audio/ambientFocusEngine";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const roomId = searchParams.get("roomId") || "global-deep-work";

  const defaultIntentions: PeerSprintIntention[] = [
    {
      id: "int-1",
      userId: "user-1",
      userName: "Elena R.",
      taskText: "Refactor multi-modal Dijkstra routing graph",
      isCompleted: true,
    },
    {
      id: "int-2",
      userId: "user-2",
      userName: "David K.",
      taskText: "Draft Q3 engineering roadmap & sprint goals",
      isCompleted: false,
    },
    {
      id: "int-3",
      userId: "user-3",
      userName: "Sophia T.",
      taskText: "Review zero-knowledge proof circuit benchmarks",
      isCompleted: false,
    },
    {
      id: "int-4",
      userId: "user-4",
      userName: "Marco P.",
      taskText: "Design WebXR AR indoor anchor navigation HUD",
      isCompleted: true,
    },
  ];

  return NextResponse.json({
    success: true,
    roomId,
    activeParticipantsCount: 8,
    pomodoro: {
      phase: "FOCUS_SPRINT",
      totalDurationMinutes: 25,
      remainingSeconds: 1140, // 19 mins remaining
      epoch: Date.now(),
      sprintNumber: 3,
    },
    ambientTheme: "Tokyo Rain & Lo-Fi Vinyl",
    intentions: defaultIntentions,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, userName, taskText, roomId = "global-deep-work" } = body;

    const newIntention: PeerSprintIntention = {
      id: `int-${Date.now()}`,
      userId: userId || "user_guest",
      userName: userName || "Nomad Fellow",
      taskText: taskText || "Deep work & coding session",
      isCompleted: false,
    };

    return NextResponse.json({
      success: true,
      message: "Sprint intention shared with focus circle",
      intention: newIntention,
    });
  } catch (error: any) {
    console.error("[POST /api/social/focus-room] Error:", error);
    return NextResponse.json(
      { error: "Failed to post sprint intention", details: error.message },
      { status: 500 }
    );
  }
}
