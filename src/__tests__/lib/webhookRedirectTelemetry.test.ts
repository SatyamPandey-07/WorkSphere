import { deliverToEndpoint } from "@/lib/notifications/channels/webhookChannel";
import { prisma } from "@/lib/prisma";
import { isSafeWebhookUrl } from "@/lib/ssrfValidation";
import { defaultNotificationHttpClient } from "@/lib/notifications/httpClient";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    webhookDeliveryLog: {
      create: jest.fn().mockResolvedValue(undefined),
    },
  },
}));

jest.mock("@/lib/ssrfValidation", () => ({
  isSafeWebhookUrl: jest.fn(),
}));

jest.mock("@/lib/notifications/httpClient", () => ({
  defaultNotificationHttpClient: {
    fetch: jest.fn(),
    isCircuitOpen: jest.fn().mockReturnValue(false),
  },
}));

describe("webhook redirect SSRF telemetry", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("counts each redirect hop and records a blocked private-IP target safely", async () => {
    (isSafeWebhookUrl as jest.Mock)
      .mockResolvedValueOnce({ isSafe: true })
      .mockResolvedValueOnce({ isSafe: true })
      .mockResolvedValueOnce({
        isSafe: false,
        reason: "Resolved IP (127.0.0.1) falls into a forbidden private network range.",
      });
    (defaultNotificationHttpClient.fetch as jest.Mock)
      .mockResolvedValueOnce({
        status: 302,
        ok: false,
        headers: new Headers({
          location: "https://public.example/next?token=private-query",
        }),
      })
      .mockResolvedValueOnce({
        status: 307,
        ok: false,
        headers: new Headers({
          location: "http://127.0.0.1/internal?token=private-query",
        }),
      });
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});

    const result = await deliverToEndpoint(
      {
        id: "endpoint-1",
        url: "https://hooks.example/deliver?secret=url-secret",
        secret: "whsec_webhook-secret",
        isActive: true,
        eventTypes: [],
        headers: null,
        userId: "user-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Parameters<typeof deliverToEndpoint>[0],
      {
        id: "event-1",
        type: "VENUE_CREATED",
        timestamp: new Date().toISOString(),
        data: { privatePayload: "payload-secret" },
      },
    );

    expect(result.status).toBe("BLOCKED");
    expect(result.details).toEqual({ redirectHopCount: 2 });
    expect(defaultNotificationHttpClient.fetch).toHaveBeenCalledTimes(2);
    expect(prisma.webhookDeliveryLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "BLOCKED" }),
      }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      JSON.stringify({
        event: "webhook.ssrf_redirect_blocked",
        endpointId: "endpoint-1",
        redirectHopCount: 2,
        blockReason: "redirect_target_resolved_to_private_or_prohibited_ip",
      }),
    );

    const logs = JSON.stringify([...warnSpy.mock.calls, ...infoSpy.mock.calls]);
    expect(logs).not.toContain("url-secret");
    expect(logs).not.toContain("private-query");
    expect(logs).not.toContain("webhook-secret");
    expect(logs).not.toContain("payload-secret");

    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });
});
