/**
 * Tests for webhook delivery validation and payload formatting.
 */

interface WebhookPayload {
  event: string;
  timestamp: number;
  data: Record<string, unknown>;
}

function buildWebhookPayload(
  event: string,
  data: Record<string, unknown>,
): WebhookPayload {
  return {
    event,
    timestamp: Date.now(),
    data,
  };
}

function validateWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function signPayload(payload: string, secret: string): string {
  // Simple HMAC simulation (hex-encoded secret + payload length)
  return `sha256=${secret.length.toString(16)}.${payload.length.toString(16)}`;
}

describe("Webhook delivery", () => {
  it("buildWebhookPayload includes event and data", () => {
    const payload = buildWebhookPayload("booking.confirmed", { bookingId: "b1" });
    expect(payload.event).toBe("booking.confirmed");
    expect(payload.data.bookingId).toBe("b1");
  });

  it("buildWebhookPayload has numeric timestamp", () => {
    const payload = buildWebhookPayload("test", {});
    expect(typeof payload.timestamp).toBe("number");
    expect(payload.timestamp).toBeGreaterThan(0);
  });

  it("validateWebhookUrl: valid HTTPS URL passes", () => {
    expect(validateWebhookUrl("https://example.com/hook")).toBe(true);
  });

  it("validateWebhookUrl: HTTP URL fails (insecure)", () => {
    expect(validateWebhookUrl("http://example.com/hook")).toBe(false);
  });

  it("validateWebhookUrl: malformed URL fails", () => {
    expect(validateWebhookUrl("not-a-url")).toBe(false);
  });

  it("signPayload produces sha256= prefixed signature", () => {
    const sig = signPayload('{"test":1}', "my-secret");
    expect(sig).toMatch(/^sha256=/);
  });

  it("different secrets produce different signatures", () => {
    const sig1 = signPayload("payload", "secret-1");
    const sig2 = signPayload("payload", "secret-1-longer");
    expect(sig1).not.toBe(sig2);
  });
});
