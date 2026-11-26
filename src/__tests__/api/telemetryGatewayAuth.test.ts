import { POST, verifyGatewayToken } from "@/app/api/telemetry/batch/route";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { NextRequest } from "next/server";

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => any;
declare const beforeEach: (fn: () => void) => void;
declare const afterEach: (fn: () => void) => void;
declare const jest: any;

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venueTelemetry: {
      createMany: jest.fn(),
    },
  },
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn(),
  getClientIp: jest.fn(() => "127.0.0.1"),
}));

const SECRET = "gateway-secret-abc123";
const body = { readings: [{ venueId: "v1", value: 42 }] };

describe("telemetry batch gateway fail-closed authentication", () => {
  const originalEnv = process.env;

  const setNodeEnv = (value: string | undefined) => {
    const env = process.env as Record<string, string | undefined>;
    if (value === undefined) {
      delete env.NODE_ENV;
    } else {
      env.NODE_ENV = value;
    }
  };

  const makeReq = (headers: Record<string, string> = {}) =>
    new NextRequest("http://localhost/api/telemetry/batch", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.GATEWAY_API_TOKEN;
    delete process.env.TELEMETRY_GATEWAY_TOKEN;
    delete process.env.WORKER_SECRET;
    (rateLimit as jest.Mock).mockResolvedValue(true);
    (prisma as any).venueTelemetry.createMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("no secret configured", () => {
    it("returns 503 in production before checking the caller's token", async () => {
      setNodeEnv("production");

      const res = await POST(makeReq());
      expect(res.status).toBe(503);
      expect((await res.json()).error).toContain("credentials not configured");

      const withToken = await POST(
        makeReq({ authorization: "Bearer anything" }),
      );
      expect(withToken.status).toBe(503);
    });

    it("allows an unauthenticated request in development", async () => {
      setNodeEnv("development");
      const res = await POST(makeReq());
      expect(res.status).toBe(201);
    });

    it("allows an unauthenticated request in test", async () => {
      setNodeEnv("test");
      const res = await POST(makeReq());
      expect(res.status).toBe(201);
    });

    it("never accepts a token that was sent without a configured secret", async () => {
      setNodeEnv("test");
      for (const headers of [
        { authorization: "Bearer anything" },
        { "x-gateway-token": "anything" },
        { "x-api-key": "anything" },
      ]) {
        const res = await POST(makeReq(headers));
        expect(res.status).toBe(401);
      }
      expect((prisma as any).venueTelemetry.createMany).not.toHaveBeenCalled();
    });

    it("fails closed when NODE_ENV is neither development, test nor production", async () => {
      setNodeEnv("staging");
      const res = await POST(makeReq());
      expect(res.status).toBe(401);

      setNodeEnv(undefined);
      const unset = await POST(makeReq());
      expect(unset.status).toBe(401);
    });

    it("treats an empty secret as not configured", async () => {
      setNodeEnv("production");
      process.env.GATEWAY_API_TOKEN = "";
      const res = await POST(makeReq({ authorization: "Bearer " }));
      expect(res.status).toBe(503);
    });
  });

  describe("secret configured", () => {
    it("rejects missing and wrong tokens with 401 in every environment", async () => {
      process.env.GATEWAY_API_TOKEN = SECRET;

      for (const env of ["production", "development", "test"]) {
        setNodeEnv(env);
        const missing = await POST(makeReq());
        expect(missing.status).toBe(401);
        expect((await missing.json()).error).toContain("Unauthorized");

        const wrong = await POST(makeReq({ authorization: "Bearer nope" }));
        expect(wrong.status).toBe(401);

        const sameLengthWrong = await POST(
          makeReq({ "x-gateway-token": "x".repeat(SECRET.length) }),
        );
        expect(sameLengthWrong.status).toBe(401);
      }
      expect((prisma as any).venueTelemetry.createMany).not.toHaveBeenCalled();
    });

    it("accepts the correct token from each supported header", async () => {
      process.env.GATEWAY_API_TOKEN = SECRET;
      setNodeEnv("production");

      for (const headers of [
        { authorization: `Bearer ${SECRET}` },
        { authorization: `bearer ${SECRET}` },
        { "x-gateway-token": SECRET },
        { "x-api-key": SECRET },
      ]) {
        const res = await POST(makeReq(headers));
        expect(res.status).toBe(201);
      }
    });

    it("gives the bearer token precedence over custom headers", async () => {
      process.env.GATEWAY_API_TOKEN = SECRET;

      const wrongBearer = await POST(
        makeReq({
          authorization: "Bearer wrong",
          "x-gateway-token": SECRET,
        }),
      );
      expect(wrongBearer.status).toBe(401);

      const rightBearer = await POST(
        makeReq({
          authorization: `Bearer ${SECRET}`,
          "x-gateway-token": "wrong",
        }),
      );
      expect(rightBearer.status).toBe(201);
    });

    it("reads the secret from TELEMETRY_GATEWAY_TOKEN and WORKER_SECRET fallbacks", async () => {
      process.env.TELEMETRY_GATEWAY_TOKEN = "telemetry-token";
      const viaTelemetry = await POST(
        makeReq({ "x-api-key": "telemetry-token" }),
      );
      expect(viaTelemetry.status).toBe(201);

      delete process.env.TELEMETRY_GATEWAY_TOKEN;
      process.env.WORKER_SECRET = "worker-token";
      const viaWorker = await POST(makeReq({ "x-api-key": "worker-token" }));
      expect(viaWorker.status).toBe(201);
    });

    it("prefers GATEWAY_API_TOKEN over the fallback variables", async () => {
      process.env.GATEWAY_API_TOKEN = SECRET;
      process.env.WORKER_SECRET = "worker-token";

      const fallback = await POST(makeReq({ "x-api-key": "worker-token" }));
      expect(fallback.status).toBe(401);

      const primary = await POST(makeReq({ "x-api-key": SECRET }));
      expect(primary.status).toBe(201);
    });
  });

  describe("request ordering", () => {
    it("rejects unauthenticated requests before rate limiting and database access", async () => {
      process.env.GATEWAY_API_TOKEN = SECRET;
      setNodeEnv("production");

      await POST(makeReq());
      await POST(makeReq({ authorization: "Bearer wrong" }));

      expect(rateLimit).not.toHaveBeenCalled();
      expect((prisma as any).venueTelemetry.createMany).not.toHaveBeenCalled();
    });

    it("returns 503 without consulting the rate limiter or database", async () => {
      setNodeEnv("production");
      await POST(makeReq());
      expect(rateLimit).not.toHaveBeenCalled();
      expect((prisma as any).venueTelemetry.createMany).not.toHaveBeenCalled();
    });
  });

  describe("verifyGatewayToken", () => {
    it("returns false in production with no secret, even with a token", () => {
      setNodeEnv("production");
      expect(verifyGatewayToken(makeReq())).toBe(false);
      expect(
        verifyGatewayToken(makeReq({ authorization: "Bearer anything" })),
      ).toBe(false);
    });

    it("returns true only for the exact configured token", () => {
      process.env.GATEWAY_API_TOKEN = SECRET;
      expect(
        verifyGatewayToken(makeReq({ authorization: `Bearer ${SECRET}` })),
      ).toBe(true);
      expect(
        verifyGatewayToken(makeReq({ authorization: `Bearer ${SECRET}x` })),
      ).toBe(false);
      expect(verifyGatewayToken(makeReq())).toBe(false);
    });

    it("does not accept unsupported authorization casing", () => {
      process.env.GATEWAY_API_TOKEN = SECRET;
      expect(
        verifyGatewayToken(makeReq({ authorization: `BEARER ${SECRET}` })),
      ).toBe(false);
    });
  });
});
