import { NextRequest } from "next/server";
import { POST } from "@/app/api/checkin/poap/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { PoAPGenerator } from "@/core/attestation/PoAPGenerator";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findUnique: jest.fn(),
    },
    poapClaim: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}));

describe("Issue #9578 - Secure PoAP Claims (/api/checkin/poap)", () => {
  const secretKey = "worksphere-poap-attestation-secret-key-production";
  const validVenue = {
    id: "venue-sf-01",
    name: "SoMa Focus Hub",
    latitude: 37.7749,
    longitude: -122.4194,
  };

  const validSensorData = {
    gpsLat: 37.77492,
    gpsLng: -122.41941,
    gpsAccuracy: 5,
    wifiSsid: "SoMa_Focus_5G",
    accelerometerX: 0.1,
    accelerometerY: 0.2,
    accelerometerZ: 9.8,
    timestamp: Date.now(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects unauthenticated requests with 401 Unauthorized", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: null });

    const req = new NextRequest("http://localhost:3000/api/checkin/poap", {
      method: "POST",
      body: JSON.stringify({
        venueId: "venue-sf-01",
        sensorData: validSensorData,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain("Unauthorized");
  });

  it("rejects client identity mismatch with 403 Forbidden", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "session-user-123" });

    const req = new NextRequest("http://localhost:3000/api/checkin/poap", {
      method: "POST",
      body: JSON.stringify({
        userId: "malicious-spoofed-user",
        venueId: "venue-sf-01",
        sensorData: validSensorData,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Forbidden: client identity mismatch");
  });

  it("rejects missing venueId or sensorData with 400 Bad Request", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "session-user-123" });

    const req = new NextRequest("http://localhost:3000/api/checkin/poap", {
      method: "POST",
      body: JSON.stringify({
        venueId: "venue-sf-01",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Missing required check-in data");
  });

  it("rejects out-of-range GPS coordinates with 400 Bad Request", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "session-user-123" });

    const req = new NextRequest("http://localhost:3000/api/checkin/poap", {
      method: "POST",
      body: JSON.stringify({
        venueId: "venue-sf-01",
        sensorData: { ...validSensorData, gpsLat: 150 }, // Lat > 90
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Invalid sensor data");
  });

  it("returns 404 when venue is not found in database", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "session-user-123" });
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest("http://localhost:3000/api/checkin/poap", {
      method: "POST",
      body: JSON.stringify({
        venueId: "venue-nonexistent",
        sensorData: validSensorData,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Venue not found");
  });

  it("rejects check-in when user coordinates are outside authoritative venue boundaries", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "session-user-123" });
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue(validVenue);

    const req = new NextRequest("http://localhost:3000/api/checkin/poap", {
      method: "POST",
      body: JSON.stringify({
        venueId: "venue-sf-01",
        sensorData: {
          ...validSensorData,
          gpsLat: 40.7128, // New York instead of San Francisco
          gpsLng: -74.006,
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });

  it("rejects check-in when GPS timestamp is stale (> 60 seconds old)", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "session-user-123" });
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue(validVenue);

    const req = new NextRequest("http://localhost:3000/api/checkin/poap", {
      method: "POST",
      body: JSON.stringify({
        venueId: "venue-sf-01",
        sensorData: {
          ...validSensorData,
          timestamp: Date.now() - 120000, // 2 minutes old
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.isExpired).toBe(true);
  });

  it("rejects replayed nonce with 409 Conflict", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "session-user-123" });
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue(validVenue);
    (prisma.poapClaim.findUnique as jest.Mock).mockResolvedValue({
      id: "claim-previous",
      nonce: "replayed-nonce-123",
    });

    const req = new NextRequest("http://localhost:3000/api/checkin/poap", {
      method: "POST",
      body: JSON.stringify({
        venueId: "venue-sf-01",
        sensorData: validSensorData,
        nonce: "replayed-nonce-123",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain("Replay detected");
  });

  it("issues authentic PoAP claim with cryptographic signature and persists to DB", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user-alice-101" });
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue(validVenue);
    (prisma.poapClaim.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.poapClaim.create as jest.Mock).mockResolvedValue({});

    const req = new NextRequest("http://localhost:3000/api/checkin/poap", {
      method: "POST",
      body: JSON.stringify({
        venueId: "venue-sf-01",
        sensorData: validSensorData,
        nonce: "unique-nonce-001",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.message).toBe("PoAP issued successfully");
    expect(json.signature).toBeDefined();
    expect(json.signature).not.toBe("mock_server_signature_hex_string");
    expect(json.signature).toHaveLength(64); // SHA-256 HMAC hex string

    // Verify claim object
    const claim = JSON.parse(json.claim);
    expect(claim.userId).toBe("user-alice-101");
    expect(claim.venueId).toBe("venue-sf-01");
    expect(claim.nonce).toBe("unique-nonce-001");
    expect(claim.sensorHash).toHaveLength(64); // SHA-256 hash

    // Verify cryptographic signature with PoAPGenerator
    const generator = new PoAPGenerator();
    const isValidSignature = generator.verifyClaimSignature(
      claim,
      json.signature,
      secretKey,
    );
    expect(isValidSignature).toBe(true);

    // Verify database persistence was called with authoritative records
    expect(prisma.poapClaim.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-alice-101",
        venueId: "venue-sf-01",
        nonce: "unique-nonce-001",
        signature: json.signature,
      }),
    });
  });
});
