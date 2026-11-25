import {
  NotificationHttpClient,
  SsrfBlockedError,
  RedirectError,
} from "@/lib/notifications/httpClient";
import { deliverToEndpoint } from "@/lib/notifications/channels/webhookChannel";
import { prisma } from "@/lib/prisma";
import type { WebhookEndpoint } from "@prisma/client";
import type { WebhookEnvelope } from "@/lib/notifications/types";

jest.mock("svix", () => ({
  Webhook: jest.fn().mockImplementation(() => ({
    verify: jest.fn().mockReturnValue({}),
  })),
}));

// Mock prisma for webhook delivery logging
jest.mock("@/lib/prisma", () => ({
  prisma: {
    webhookDeliveryLog: {
      create: jest.fn().mockResolvedValue({ id: "log-1" }),
    },
  },
}));

describe("NotificationHttpClient - Redirect SSRF Revalidation & Security", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it("blocks redirect to loopback (127.0.0.1) destination with SsrfBlockedError", async () => {
    const mockValidator = jest.fn(async (url: string) => {
      if (url.includes("127.0.0.1") || url.includes("localhost")) {
        return {
          isSafe: false,
          reason: "Target IP falls into forbidden loopback range.",
        };
      }
      return { isSafe: true };
    });

    const client = new NotificationHttpClient({
      validateUrl: mockValidator,
      maxRetries: 0,
    });

    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url === "https://public.example.com/webhook") {
        return new Response(null, {
          status: 307,
          headers: { location: "http://127.0.0.1:8080/internal/admin" },
        });
      }
      return new Response("OK", { status: 200 });
    });

    await expect(
      client.fetch("https://public.example.com/webhook", { method: "POST" }),
    ).rejects.toThrow(SsrfBlockedError);

    expect(mockValidator).toHaveBeenCalledWith(
      "https://public.example.com/webhook",
    );
    expect(mockValidator).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/internal/admin",
    );
  });

  it("blocks redirect to cloud metadata (169.254.169.254)", async () => {
    const mockValidator = jest.fn(async (url: string) => {
      if (url.includes("169.254.")) {
        return { isSafe: false, reason: "Forbidden cloud metadata IP." };
      }
      return { isSafe: true };
    });

    const client = new NotificationHttpClient({
      validateUrl: mockValidator,
      maxRetries: 0,
    });

    global.fetch = jest.fn().mockImplementation(async () => {
      return new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      });
    });

    await expect(
      client.fetch("https://public.example.com/hook", { method: "POST" }),
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("blocks redirect to invalid non-http protocols (e.g. file:// or ftp://)", async () => {
    const mockValidator = jest.fn().mockResolvedValue({ isSafe: true });
    const client = new NotificationHttpClient({
      validateUrl: mockValidator,
      maxRetries: 0,
    });

    global.fetch = jest.fn().mockImplementation(async () => {
      return new Response(null, {
        status: 301,
        headers: { location: "file:///etc/passwd" },
      });
    });

    await expect(
      client.fetch("https://public.example.com/hook", { method: "POST" }),
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("detects and rejects redirect loops", async () => {
    const mockValidator = jest.fn().mockResolvedValue({ isSafe: true });
    const client = new NotificationHttpClient({
      validateUrl: mockValidator,
      maxRetries: 0,
    });

    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url === "https://public.example.com/step-1") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://public.example.com/step-2" },
        });
      }
      if (url === "https://public.example.com/step-2") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://public.example.com/step-1" },
        });
      }
      return new Response("OK", { status: 200 });
    });

    await expect(
      client.fetch("https://public.example.com/step-1"),
    ).rejects.toThrow(RedirectError);

    await expect(
      client.fetch("https://public.example.com/step-1"),
    ).rejects.toThrow(/Redirect loop detected/);
  });

  it("enforces maximum redirect limit", async () => {
    const mockValidator = jest.fn().mockResolvedValue({ isSafe: true });
    const client = new NotificationHttpClient({
      validateUrl: mockValidator,
      maxRetries: 0,
      maxRedirects: 2,
    });

    let hop = 0;
    global.fetch = jest.fn().mockImplementation(async () => {
      hop++;
      return new Response(null, {
        status: 302,
        headers: { location: `https://public.example.com/hop-${hop}` },
      });
    });

    await expect(
      client.fetch("https://public.example.com/hop-0"),
    ).rejects.toThrow(/Maximum redirect limit/);
  });

  it("strips sensitive authentication headers when redirecting cross-origin", async () => {
    const mockValidator = jest.fn().mockResolvedValue({ isSafe: true });
    const client = new NotificationHttpClient({
      validateUrl: mockValidator,
      maxRetries: 0,
    });

    const receivedHeaders: Record<string, Headers> = {};

    global.fetch = jest
      .fn()
      .mockImplementation(async (url: string, init: any) => {
        receivedHeaders[url] = new Headers(init.headers);
        if (url === "https://source.example.com/hook") {
          return new Response(null, {
            status: 307,
            headers: { location: "https://destination.otherdomain.com/hook" },
          });
        }
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      });

    const response = await client.fetch("https://source.example.com/hook", {
      method: "POST",
      headers: {
        authorization: "Bearer secret-token-123",
        "webhook-signature": "sig-abc",
        "svix-signature": "svix-abc",
        "x-api-key": "my-secret-key",
        "user-agent": "WorkSphere-Webhooks/1.0",
        "content-type": "application/json",
      },
      body: JSON.stringify({ event: "test" }),
    });

    expect(response.status).toBe(200);

    // Initial hop received sensitive headers
    const initialHeaders = receivedHeaders["https://source.example.com/hook"];
    expect(initialHeaders.get("authorization")).toBe("Bearer secret-token-123");
    expect(initialHeaders.get("webhook-signature")).toBe("sig-abc");

    // Cross-origin redirect hop stripped sensitive headers
    const destHeaders =
      receivedHeaders["https://destination.otherdomain.com/hook"];
    expect(destHeaders.get("authorization")).toBeNull();
    expect(destHeaders.get("webhook-signature")).toBeNull();
    expect(destHeaders.get("svix-signature")).toBeNull();
    expect(destHeaders.get("x-api-key")).toBeNull();
    // Non-sensitive headers were preserved
    expect(destHeaders.get("user-agent")).toBe("WorkSphere-Webhooks/1.0");
    expect(destHeaders.get("content-type")).toBe("application/json");
  });

  it("preserves authentication headers when redirecting to the same origin", async () => {
    const mockValidator = jest.fn().mockResolvedValue({ isSafe: true });
    const client = new NotificationHttpClient({
      validateUrl: mockValidator,
      maxRetries: 0,
    });

    const receivedHeaders: Record<string, Headers> = {};

    global.fetch = jest
      .fn()
      .mockImplementation(async (url: string, init: any) => {
        receivedHeaders[url] = new Headers(init.headers);
        if (url === "https://source.example.com/v1") {
          return new Response(null, {
            status: 307,
            headers: { location: "https://source.example.com/v2" },
          });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

    await client.fetch("https://source.example.com/v1", {
      method: "POST",
      headers: {
        "webhook-signature": "sig-preserved",
      },
    });

    const destHeaders = receivedHeaders["https://source.example.com/v2"];
    expect(destHeaders.get("webhook-signature")).toBe("sig-preserved");
  });

  it("respects redirect: manual option by returning 3xx response directly", async () => {
    const mockValidator = jest.fn().mockResolvedValue({ isSafe: true });
    const client = new NotificationHttpClient({
      validateUrl: mockValidator,
      maxRetries: 0,
    });

    global.fetch = jest.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://example.com/other" },
      }),
    );

    const res = await client.fetch("https://example.com/initial", {
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/other");
  });
});

describe("deliverToEndpoint - SSRF Redirect Protection", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  const dummyEndpoint: WebhookEndpoint = {
    id: "ep-1",
    userId: "user-1",
    url: "https://93.184.216.34/receive",
    secret: "whsec_dGVzdHNlY3JldDEyMzQ1Njc4OTA=",
    isActive: true,
    headers: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const dummyEnvelope: WebhookEnvelope = {
    id: "msg-1",
    type: "BOOKING_CREATED",
    timestamp: "1700000000",
    data: { bookingId: "b-1" },
  };

  it("marks delivery as BLOCKED when redirect leads to private network", async () => {
    // Initial fetch returns redirect to 10.0.0.1
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes("93.184.216.34/receive")) {
        return new Response(null, {
          status: 302,
          headers: { location: "http://10.0.0.1/admin/callback" },
        });
      }
      return new Response("OK", { status: 200 });
    });

    const result = await deliverToEndpoint(dummyEndpoint, dummyEnvelope);

    expect(result.status).toBe("BLOCKED");
    expect(prisma.webhookDeliveryLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        endpointId: "ep-1",
        status: "BLOCKED",
      }),
    });
  });

  it("marks delivery as SUCCESS when redirect leads to valid public endpoint", async () => {
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url === "https://93.184.216.34/receive") {
        return new Response(null, {
          status: 307,
          headers: { location: "https://93.184.216.34/receive-v2" },
        });
      }
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    });

    const result = await deliverToEndpoint(dummyEndpoint, dummyEnvelope);

    expect(result.status).toBe("SUCCESS");
    expect(result.statusCode).toBe(200);
    expect(prisma.webhookDeliveryLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        endpointId: "ep-1",
        status: "SUCCESS",
        statusCode: 200,
      }),
    });
  });
});
