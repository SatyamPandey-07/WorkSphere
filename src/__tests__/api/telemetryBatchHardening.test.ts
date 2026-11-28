import { NextRequest } from "next/server";
import { ExtendedGatewayAuthRegistry, defaultGatewayRegistry } from "@/lib/telemetry/gatewayAuthRegistry";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venueTelemetry: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  },
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockResolvedValue(true),
  getClientIp: jest.fn().mockReturnValue("127.0.0.1"),
}));

import { POST, MAX_TELEMETRY_BATCH_SIZE } from "@/app/api/telemetry/batch/route";

describe("Telemetry Batch Hardening & GatewayAuthRegistry", () => {
  it("isolates multiple enrolled gateway credentials and enforces scopes and venue bindings", () => {
    const registry = new ExtendedGatewayAuthRegistry();
    registry.enrollGatewayCredential({
      gatewayId: "gw-alpha",
      keyId: "k1",
      secretOrVerifier: "sec-alpha",
      scopes: ["telemetry:write"],
    });
    registry.enrollGatewayCredential({
      gatewayId: "gw-beta",
      keyId: "k1",
      secretOrVerifier: "sec-beta",
      scopes: ["telemetry:read"],
    });
    registry.bindGatewayVenues("gw-alpha", ["venue-101"]);

    expect(registry.authenticateToken("gw-alpha:k1:sec-alpha").authenticated).toBe(true);
    expect(registry.authenticateToken("gw-alpha:k1:wrong-secret").authenticated).toBe(false);
    expect(registry.authenticateToken("gw-beta:k1:sec-beta").authenticated).toBe(false);
    expect(registry.isVenueAuthorized("gw-alpha", "venue-101")).toBe(true);
    expect(registry.isVenueAuthorized("gw-alpha", "venue-999")).toBe(false);
  });

  it("rejects unauthorized venues with 403 and oversized payloads with 400", async () => {
    defaultGatewayRegistry.enrollGatewayCredential({
      gatewayId: "gw-test",
      keyId: "key-1",
      secretOrVerifier: "top-secret",
      scopes: ["telemetry:write"],
    });
    defaultGatewayRegistry.bindGatewayVenues("gw-test", ["venue-allowed"]);

    const forbiddenReq = new NextRequest("http://localhost/api/telemetry/batch", {
      method: "POST",
      headers: {
        authorization: "Bearer gw-test:key-1:top-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        readings: [{ venueId: "venue-blocked", value: 42, timestamp: Date.now() }],
      }),
    });
    const forbiddenRes = await POST(forbiddenReq);
    expect(forbiddenRes.status).toBe(403);

    const oversizedReadings = Array.from({ length: MAX_TELEMETRY_BATCH_SIZE + 1 }, () => ({
      venueId: "venue-allowed",
      value: 50,
    }));
    const oversizedReq = new NextRequest("http://localhost/api/telemetry/batch", {
      method: "POST",
      headers: {
        authorization: "Bearer gw-test:key-1:top-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ readings: oversizedReadings }),
    });
    const oversizedRes = await POST(oversizedReq);
    expect(oversizedRes.status).toBe(400);
  });
});