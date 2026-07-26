/**
 * WebPush Content-Encoding selection (#1032).
 *
 * Safari iOS 17.4 PWAs fail to decrypt `aes128gcm` payloads (blank title/body).
 * The backend must support both encodings and pick per subscription.
 */

export const WEBPUSH_CONTENT_ENCODINGS = {
  AES_GCM: "aesgcm",
  AES_128_GCM: "aes128gcm",
} as const;

export type WebPushContentEncoding =
  (typeof WEBPUSH_CONTENT_ENCODINGS)[keyof typeof WEBPUSH_CONTENT_ENCODINGS];

export type ResolveWebPushEncodingInput = {
  endpoint: string;
  userAgent?: string | null;
};

/**
 * Resolve Content-Encoding for a push subscription.
 * Apple Push / Safari iOS → aesgcm; everyone else → RFC 8291 aes128gcm.
 */
export function resolveWebPushContentEncoding(
  input: ResolveWebPushEncodingInput,
): WebPushContentEncoding {
  const endpoint = input.endpoint ?? "";
  const ua = input.userAgent ?? "";

  const isApplePushService =
    /web\.push\.apple\.com/i.test(endpoint) ||
    /\.push\.apple\.com/i.test(endpoint);

  // iPhone/iPad Safari (and CriOS still reports Mobile/...Safari)
  const isSafariIos =
    /iPhone|iPad|iPod/i.test(ua) &&
    /WebKit/i.test(ua) &&
    !/Chrome|Chromium|Edg|Firefox/i.test(ua);

  if (isApplePushService || isSafariIos) {
    return WEBPUSH_CONTENT_ENCODINGS.AES_GCM;
  }

  return WEBPUSH_CONTENT_ENCODINGS.AES_128_GCM;
}
