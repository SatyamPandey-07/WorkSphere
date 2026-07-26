import {
  resolveWebPushContentEncoding,
  WEBPUSH_CONTENT_ENCODINGS,
} from "../../lib/webPushContentEncoding";

describe("resolveWebPushContentEncoding (#1032)", () => {
  it("uses aesgcm for Apple web push endpoints", () => {
    expect(
      resolveWebPushContentEncoding({
        endpoint: "https://web.push.apple.com/QABC123",
      }),
    ).toBe(WEBPUSH_CONTENT_ENCODINGS.AES_GCM);
  });

  it("uses aesgcm for Safari iOS user agents", () => {
    expect(
      resolveWebPushContentEncoding({
        endpoint: "https://fcm.googleapis.com/fcm/send/abc",
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
      }),
    ).toBe(WEBPUSH_CONTENT_ENCODINGS.AES_GCM);
  });

  it("uses aes128gcm for Chromium / FCM subscriptions", () => {
    expect(
      resolveWebPushContentEncoding({
        endpoint:
          "https://fcm.googleapis.com/fcm/send/d61c5u920dw:APA91bExample",
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      }),
    ).toBe(WEBPUSH_CONTENT_ENCODINGS.AES_128_GCM);
  });

  it("uses aes128gcm for Firefox / Mozilla endpoints", () => {
    expect(
      resolveWebPushContentEncoding({
        endpoint: "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
      }),
    ).toBe(WEBPUSH_CONTENT_ENCODINGS.AES_128_GCM);
  });

  it("exposes both supported WebPush encodings", () => {
    expect(Object.values(WEBPUSH_CONTENT_ENCODINGS).sort()).toEqual([
      "aes128gcm",
      "aesgcm",
    ]);
  });
});
