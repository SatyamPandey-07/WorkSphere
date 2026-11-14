import { computeWebhookRetryDelayMs } from "@/lib/events/outbox";

describe("durable webhook outbox retry policy", () => {
  it("uses exponential backoff with bounded jitter", () => {
    expect(computeWebhookRetryDelayMs(1, 0)).toBe(45_000);
    expect(computeWebhookRetryDelayMs(1, 1)).toBe(75_000);
    expect(computeWebhookRetryDelayMs(2, 0.5)).toBe(120_000);
  });

  it("caps retry delays at 24 hours", () => {
    expect(computeWebhookRetryDelayMs(20, 0.5)).toBe(24 * 60 * 60 * 1000);
  });

  it("normalizes invalid attempt numbers to the first attempt", () => {
    expect(computeWebhookRetryDelayMs(0, 0.5)).toBe(60_000);
    expect(computeWebhookRetryDelayMs(-3, 0.5)).toBe(60_000);
  });
});
