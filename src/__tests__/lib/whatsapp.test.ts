import { isPrivateIp, isValidWebhookUrl, whatsAppService } from "@/lib/whatsapp";
import dns from "dns";
import https from "https";

jest.mock("dns", () => {
  return {
    promises: {
      lookup: jest.fn().mockImplementation((hostname: string) => {
        if (hostname === "example.com" || hostname === "safe-domain.org") {
          return { address: "93.184.216.34" }; // Safe public IP
        }
        if (hostname === "bypass.nip.io") {
          return { address: "127.0.0.1" }; // Bypassed IP
        }
        if (hostname === "internal.localdomain") {
          return { address: "10.0.0.5" }; // Private IP
        }
        throw new Error("DNS resolution failed");
      }),
    },
  };
});

jest.mock("https", () => {
  return {
    request: jest.fn().mockImplementation((options, callback) => {
      const mockRes = {
        statusCode: 200,
        on: jest.fn().mockImplementation((event, cb) => {
          if (event === "data") {
            cb(Buffer.from("OK"));
          }
          if (event === "end") {
            cb();
          }
        }),
      };
      const mockReq = {
        on: jest.fn(),
        write: jest.fn(),
        end: jest.fn().mockImplementation(() => {
          if (callback) callback(mockRes);
        }),
      };
      return mockReq;
    }),
  };
});

describe("isPrivateIp", () => {
  it("should detect private and local IPv4 ranges", () => {
    // Loopback
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("127.255.255.255")).toBe(true);

    // Private classes
    expect(isPrivateIp("10.0.0.1")).toBe(true);
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("172.31.255.255")).toBe(true);
    expect(isPrivateIp("192.168.1.100")).toBe(true);

    // Link-local & Shared
    expect(isPrivateIp("169.254.1.1")).toBe(true);
    expect(isPrivateIp("100.64.0.1")).toBe(true);
    expect(isPrivateIp("100.127.255.255")).toBe(true);

    // Local net
    expect(isPrivateIp("0.0.0.0")).toBe(true);

    // Public IPv4
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("142.250.190.46")).toBe(false);
  });

  it("should detect private and local IPv6 ranges", () => {
    // Loopback
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("0:0:0:0:0:0:0:1")).toBe(true);

    // Local / Link-local
    expect(isPrivateIp("fc00::")).toBe(true);
    expect(isPrivateIp("fdff::")).toBe(true);
    expect(isPrivateIp("fe80::1234")).toBe(true);
    expect(isPrivateIp("::")).toBe(true);

    // Public IPv6
    expect(isPrivateIp("2001:4860:4860::8888")).toBe(false);
  });

  it("should reject invalid IP representations", () => {
    expect(isPrivateIp("invalid-ip")).toBe(true);
    expect(isPrivateIp("256.256.256.256")).toBe(true);
  });
});

describe("isValidWebhookUrl", () => {
  it("should return true for a valid public HTTPS URL", async () => {
    const res = await isValidWebhookUrl("https://example.com/webhook");
    expect(res).toBe(true);
  });

  it("should return false for non-https URLs", async () => {
    const res = await isValidWebhookUrl("http://example.com/webhook");
    expect(res).toBe(false);
  });

  it("should return false for blocked hostnames on string match", async () => {
    expect(await isValidWebhookUrl("https://localhost/webhook")).toBe(false);
    expect(await isValidWebhookUrl("https://my-app.local/webhook")).toBe(false);
  });

  it("should return false for blocked IPs directly in URL", async () => {
    expect(await isValidWebhookUrl("https://127.0.0.1/webhook")).toBe(false);
    expect(await isValidWebhookUrl("https://10.0.0.1/webhook")).toBe(false);
  });

  it("should resolve hostname and return false if it points to a private IP", async () => {
    // Rebinding / nip.io bypass
    const res = await isValidWebhookUrl("https://bypass.nip.io/webhook");
    expect(res).toBe(false);
    expect(dns.promises.lookup).toHaveBeenCalledWith("bypass.nip.io");
  });

  it("should return false if DNS resolution fails", async () => {
    const res = await isValidWebhookUrl(
      "https://nonexistent-domain.xyz/webhook",
    );
    expect(res).toBe(false);
  });
});

describe("whatsAppService webhook delivery", () => {
  const mockRequest = https.request as jest.Mock;

  beforeEach(() => {
    mockRequest.mockClear();
  });

  it("should successfully send webhook to a public IP using resolved IP hostname and servername", async () => {
    const payload = {
      to: "+1234567890",
      venueName: "Cool Venue",
      date: "2026-07-19",
      time: "12:00",
      confirmationId: "123456",
    };

    await whatsAppService.sendBookingConfirmation(
      null,
      "https://example.com/webhook",
      payload
    );

    expect(mockRequest).toHaveBeenCalled();
    const callArgs = mockRequest.mock.calls[0][0];
    expect(callArgs.hostname).toBe("93.184.216.34"); // resolved IP
    expect(callArgs.servername).toBe("example.com"); // original hostname
    expect(callArgs.headers["Host"]).toBe("example.com");
  });

  it("should block webhook and not call https.request if IP resolves to private IP", async () => {
    const payload = {
      to: "+1234567890",
      venueName: "Cool Venue",
      date: "2026-07-19",
      time: "12:00",
      confirmationId: "123456",
    };

    await whatsAppService.sendBookingConfirmation(
      null,
      "https://internal.localdomain/webhook",
      payload
    );

    expect(mockRequest).not.toHaveBeenCalled();
  });
});
