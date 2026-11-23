/**
 * route.ts
 * /api/p2p/mesh
 * Bootstraps local peer discovery and returns active venue Wi-Fi mesh topologies.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  MeshCollabEngine,
  MeshPeerNode,
  LocalMeshTopology,
} from "@/lib/p2p/meshCollabEngine";
import { db } from "@/lib/db";

const ALLOWED_WAN_STATUSES = ["CONNECTED", "DISCONNECTED", "DEGRADED"] as const;
type WanStatus = (typeof ALLOWED_WAN_STATUSES)[number];

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const venueId = searchParams.get("venueId");

    if (!venueId || !venueId.trim()) {
      return NextResponse.json(
        { error: "Missing required venueId query parameter" },
        { status: 400 },
      );
    }

    const rawWanStatus = searchParams.get("wanStatus");
    let wanStatus: WanStatus = "CONNECTED";

    if (rawWanStatus !== null) {
      const normalizedWan = rawWanStatus.toUpperCase();
      if (!ALLOWED_WAN_STATUSES.includes(normalizedWan as WanStatus)) {
        return NextResponse.json(
          {
            error: `Invalid wanStatus parameter. Must be one of: ${ALLOWED_WAN_STATUSES.join(", ")}`,
          },
          { status: 400 },
        );
      }
      wanStatus = normalizedWan as WanStatus;
    }

    const venue = await db.venue.findUnique({
      where: { id: venueId.trim() },
      select: { id: true, name: true },
    });

    if (!venue) {
      return NextResponse.json({ error: "Venue not found" }, { status: 404 });
    }

    const now = new Date();
    const activeSessions = await db.meshSession.findMany({
      where: {
        venueId: venue.id,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
    });

    const userIds = Array.from(new Set(activeSessions.map((s) => s.userId)));
    const users =
      userIds.length > 0
        ? await db.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const activeMeshPeers: MeshPeerNode[] = activeSessions.map((session) => {
      const user = userMap.get(session.userId);
      const nameParts = [user?.firstName, user?.lastName].filter(Boolean);
      const displayName =
        nameParts.length > 0
          ? nameParts.join(" ")
          : `User ${session.userId.slice(0, 8)}`;

      return {
        peerId: session.id,
        displayName,
        deskLocation: null,
        ipSubnet: null,
        hopCount: 0,
        signalStrengthRssi: null,
        latencyMs: null,
        lastSeenTimestamp: session.createdAt.getTime(),
        status: "connected",
        sharedFilesCount: 0,
      };
    });

    const totalBandwidthKbps = activeSessions.reduce(
      (sum, s) => sum + Math.round((s.contributionMb || 0) * 1024),
      0,
    );

    const resilience = MeshCollabEngine.calculateMeshResilience(
      activeMeshPeers,
      wanStatus,
    );

    const topology: LocalMeshTopology = {
      venueId: venue.id,
      venueName: venue.name,
      localSubnet: null,
      wanStatus,
      activeMeshPeers,
      totalBandwidthKbps,
      meshResilienceRating: resilience,
    };

    return NextResponse.json({
      success: true,
      topology,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[GET /api/p2p/mesh] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to retrieve local mesh topology",
        details: error.message,
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const peerId = body.peerId || `peer-${Date.now()}`;
    const subnet = body.subnet || "192.168.1.100";

    const signalingOffer = MeshCollabEngine.generateSignalingOffer(
      peerId,
      subnet,
    );

    return NextResponse.json({
      success: true,
      peerId,
      signalingOffer,
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
      relayChannelsConfigured: 4,
    });
  } catch (error: any) {
    console.error("[POST /api/p2p/mesh] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to create mesh signaling session",
        details: error.message,
      },
      { status: 500 },
    );
  }
}
