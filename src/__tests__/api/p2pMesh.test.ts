import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/p2p/mesh/route";
import { db } from "@/lib/db";

jest.mock("@/lib/db", () => ({
  db: {
    venue: {
      findUnique: jest.fn(),
    },
    meshSession: {
      findMany: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
  },
}));

describe("Issue #9521 - Live P2P Mesh Topology API (/api/p2p/mesh)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects requests missing venueId with 400 Bad Request", async () => {
    const req = new NextRequest("http://localhost:3000/api/p2p/mesh");
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("Missing required venueId");
  });

  it("rejects requests with empty whitespace venueId with 400 Bad Request", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/p2p/mesh?venueId=   ",
    );
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("Missing required venueId");
  });

  it("rejects invalid wanStatus parameter with 400 Bad Request", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/p2p/mesh?venueId=venue-123&wanStatus=SUPER_ONLINE",
    );
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("Invalid wanStatus parameter");
    expect(json.error).toContain("CONNECTED, DISCONNECTED, DEGRADED");
  });

  it("returns 404 when venue does not exist", async () => {
    (db.venue.findUnique as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest(
      "http://localhost:3000/api/p2p/mesh?venueId=venue-nonexistent",
    );
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Venue not found");
    expect(db.venue.findUnique).toHaveBeenCalledWith({
      where: { id: "venue-nonexistent" },
      select: { id: true, name: true },
    });
  });

  it("returns empty peer list and 0 bandwidth without fabricating telemetry when no active sessions exist", async () => {
    (db.venue.findUnique as jest.Mock).mockResolvedValue({
      id: "venue-empty",
      name: "Downtown Coworking",
    });
    (db.meshSession.findMany as jest.Mock).mockResolvedValue([]);

    const req = new NextRequest(
      "http://localhost:3000/api/p2p/mesh?venueId=venue-empty",
    );
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.topology.venueId).toBe("venue-empty");
    expect(json.topology.venueName).toBe("Downtown Coworking");
    expect(json.topology.wanStatus).toBe("CONNECTED");
    expect(json.topology.localSubnet).toBeNull();
    expect(json.topology.activeMeshPeers).toEqual([]);
    expect(json.topology.totalBandwidthKbps).toBe(0);
    expect(json.topology.meshResilienceRating).toBe("limited");

    // Strict check: verify mock peers (node-alpha-101 etc) are NOT returned
    const peerIds = json.topology.activeMeshPeers.map((p: any) => p.peerId);
    expect(peerIds).not.toContain("node-alpha-101");
    expect(peerIds).not.toContain("node-bravo-102");
    expect(peerIds).not.toContain("node-charlie-103");
    expect(peerIds).not.toContain("node-delta-104");
  });

  it("returns live active peer sessions scoped to the requested venue", async () => {
    (db.venue.findUnique as jest.Mock).mockResolvedValue({
      id: "venue-alpha",
      name: "Alpha Innovation Lab",
    });

    const now = new Date("2026-11-22T12:00:00Z");
    const mockSessions = [
      {
        id: "session-101",
        userId: "user-alpha",
        venueId: "venue-alpha",
        role: "worker",
        meshToken: "tok-1",
        expiresAt: new Date("2026-11-22T15:00:00Z"),
        contributionMb: 50,
        createdAt: now,
      },
      {
        id: "session-102",
        userId: "user-beta",
        venueId: "venue-alpha",
        role: "relay",
        meshToken: "tok-2",
        expiresAt: new Date("2026-11-22T16:00:00Z"),
        contributionMb: 25,
        createdAt: now,
      },
    ];

    (db.meshSession.findMany as jest.Mock).mockResolvedValue(mockSessions);
    (db.user.findMany as jest.Mock).mockResolvedValue([
      { id: "user-alpha", firstName: "Alex", lastName: "Rivera" },
      { id: "user-beta", firstName: "Morgan", lastName: "Chen" },
    ]);

    const req = new NextRequest(
      "http://localhost:3000/api/p2p/mesh?venueId=venue-alpha&wanStatus=CONNECTED",
    );
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(db.meshSession.findMany).toHaveBeenCalledWith({
      where: {
        venueId: "venue-alpha",
        expiresAt: { gt: expect.any(Date) },
      },
      orderBy: { createdAt: "desc" },
    });

    expect(json.topology.activeMeshPeers).toHaveLength(2);

    const firstPeer = json.topology.activeMeshPeers[0];
    expect(firstPeer.peerId).toBe("session-101");
    expect(firstPeer.displayName).toBe("Alex Rivera");
    expect(firstPeer.status).toBe("connected");
    // Telemetry must be null, never fabricated
    expect(firstPeer.signalStrengthRssi).toBeNull();
    expect(firstPeer.latencyMs).toBeNull();
    expect(firstPeer.ipSubnet).toBeNull();
    expect(firstPeer.deskLocation).toBeNull();

    const secondPeer = json.topology.activeMeshPeers[1];
    expect(secondPeer.peerId).toBe("session-102");
    expect(secondPeer.displayName).toBe("Morgan Chen");

    // Bandwidth calculated from actual contributions (50 + 25) * 1024
    expect(json.topology.totalBandwidthKbps).toBe(75 * 1024);
    // Resilience rating with 2 peers should be robust
    expect(json.topology.meshResilienceRating).toBe("robust");
  });

  it("supports normalized case-insensitive wanStatus parameters", async () => {
    (db.venue.findUnique as jest.Mock).mockResolvedValue({
      id: "venue-alpha",
      name: "Alpha Lab",
    });
    (db.meshSession.findMany as jest.Mock).mockResolvedValue([]);

    const req = new NextRequest(
      "http://localhost:3000/api/p2p/mesh?venueId=venue-alpha&wanStatus=degraded",
    );
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.topology.wanStatus).toBe("DEGRADED");
  });

  it("POST endpoint generates a valid WebRTC signaling offer", async () => {
    const req = new NextRequest("http://localhost:3000/api/p2p/mesh", {
      method: "POST",
      body: JSON.stringify({
        peerId: "client-peer-1",
        subnet: "192.168.1.50",
      }),
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.peerId).toBe("client-peer-1");
    expect(typeof json.signalingOffer).toBe("string");
    expect(json.iceServers).toBeDefined();
  });
});
