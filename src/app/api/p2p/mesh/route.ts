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

const MOCK_PEERS: MeshPeerNode[] = [
  {
    peerId: "node-alpha-101",
    displayName: "Maya Lin (iOS / MacBook)",
    deskLocation: "Desk #04A - Quiet Library",
    ipSubnet: "192.168.1.104",
    hopCount: 0,
    signalStrengthRssi: -42,
    latencyMs: 3.2,
    lastSeenTimestamp: Date.now(),
    status: "connected",
    sharedFilesCount: 4,
  },
  {
    peerId: "node-bravo-102",
    displayName: "Liam Vance (ThinkPad X1)",
    deskLocation: "Desk #12B - Sunlit Atrium",
    ipSubnet: "192.168.1.118",
    hopCount: 0,
    signalStrengthRssi: -56,
    latencyMs: 5.8,
    lastSeenTimestamp: Date.now(),
    status: "connected",
    sharedFilesCount: 2,
  },
  {
    peerId: "node-charlie-103",
    displayName: "Chloe Dubois (iPad Pro)",
    deskLocation: "Rooftop Terrace #02",
    ipSubnet: "192.168.1.145",
    hopCount: 1, // Relayed through Maya's node
    signalStrengthRssi: -71,
    latencyMs: 14.4,
    lastSeenTimestamp: Date.now(),
    status: "mesh_relay",
    sharedFilesCount: 1,
  },
  {
    peerId: "node-delta-104",
    displayName: "Kenji Sato (Dell XPS)",
    deskLocation: "Standing Desk #18",
    ipSubnet: "192.168.1.190",
    hopCount: 0,
    signalStrengthRssi: -48,
    latencyMs: 4.1,
    lastSeenTimestamp: Date.now(),
    status: "connected",
    sharedFilesCount: 6,
  },
];

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const venueId = searchParams.get("venueId") || "venue-sf-01";
    const wanStatus = (searchParams.get("wanStatus") as LocalMeshTopology["wanStatus"]) || "healthy_online";

    const resilience = MeshCollabEngine.calculateMeshResilience(MOCK_PEERS, wanStatus);

    const topology: LocalMeshTopology = {
      venueId,
      venueName: "SoMa Focus Hub & Roastery",
      localSubnet: "192.168.1.0/24",
      wanStatus,
      activeMeshPeers: MOCK_PEERS,
      totalBandwidthKbps: 48000,
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
      { error: "Failed to retrieve local mesh topology", details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const peerId = body.peerId || `peer-${Date.now()}`;
    const subnet = body.subnet || "192.168.1.100";

    const signalingOffer = MeshCollabEngine.generateSignalingOffer(peerId, subnet);

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
      { error: "Failed to create mesh signaling session", details: error.message },
      { status: 500 }
    );
  }
}
