import type { WebAuthnVerifyInput, WebAuthnVerifyResult } from "../types";

function tryHostname(value: string): string | null {
  const raw = value.trim().toLowerCase();
  if (!raw) return null;

  try {
    if (raw.includes("://")) {
      return new URL(raw).hostname.toLowerCase();
    }
  } catch {
    return null;
  }

  // bare hostname (maybe with port)
  return raw.split(":")[0] || null;
}

/**
 * Resolve the RP ID used for challenge verification.
 * Prefer an explicit config (WEBAUTHN_RP_ID), otherwise derive a parent-domain
 * RP ID from the request origin / app URL so sibling subdomains share it.
 */
export function normalizeRpId(
  originOrHost: string,
  configuredRpId?: string | null,
): string {
  const configured = (configuredRpId || process.env.WEBAUTHN_RP_ID || "")
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "");

  if (configured) {
    return tryHostname(configured) || configured;
  }

  const host = tryHostname(originOrHost);
  if (!host) return "";

  if (host === "localhost" || host.endsWith(".localhost")) {
    return "localhost";
  }

  // IPv4 — WebAuthn can't use these as RP IDs meaningfully; keep as-is
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return host;
  }

  let normalized = host.startsWith("www.") ? host.slice(4) : host;
  const labels = normalized.split(".").filter(Boolean);

  // Simple eTLD+1: foo.bar.com -> bar.com, staging.app.io -> app.io
  if (labels.length > 2) {
    normalized = labels.slice(-2).join(".");
  }

  return normalized;
}

/**
 * Detects if a User-Agent string corresponds to a mobile webview
 * (e.g. iOS Safari WKWebView inside custom app wrappers, Android webview).
 */
export function isMobileWebview(userAgent?: string | null): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();

  const isIOSDevice = /iphone|ipad|ipod/.test(ua);
  const isAppleWebKit = ua.includes("applewebkit");

  const isIOSWebview =
    isIOSDevice &&
    isAppleWebKit &&
    (!ua.includes("safari/") ||
      !ua.includes("version/") ||
      ua.includes("wkwebview") ||
      ua.includes("wv"));

  const isAndroidWebview = ua.includes("wv") || ua.includes("androidwebview");

  return isIOSWebview || isAndroidWebview;
}

/** Origin host equals RP ID, or is a subdomain of it. Relaxed for recognized mobile webviews. */
export function isOriginAllowedForRpId(
  origin: string,
  rpId: string,
  userAgent?: string | null,
): boolean {
  if (isMobileWebview(userAgent)) {
    return true;
  }

  const host = tryHostname(origin);
  const rp = rpId.trim().toLowerCase();
  if (!host || !rp) return false;

  return host === rp || host.endsWith(`.${rp}`);
}

/**
 * Resolves the Relying Party ID (hostname) from the incoming request.
 */
export function getRpId(req: Request): string {
  const host = req.headers.get("host") || "localhost";
  return host.split(":")[0];
}

/**
 * Resolves the absolute Origin URL from the incoming request.
 */
export function getOrigin(req: Request): string {
  const host = req.headers.get("host") || "localhost:3000";
  const protocol =
    req.headers.get("x-forwarded-proto") ||
    (host.includes("localhost") || host.includes("127.0.0.1")
      ? "http"
      : "https");
  return `${protocol}://${host}`;
}

/**
 * Resolves the expected origin(s) for WebAuthn response verification.
 * For recognized mobile webview user agent strings, origin checks are relaxed
 * by accepting clientDataOrigin alongside the request origin.
 */
export function getExpectedOrigin(
  req: Request,
  clientDataOrigin?: string,
): string | string[] {
  const defaultOrigin = getOrigin(req);
  const userAgent = req.headers.get("user-agent");

  const expectedOrigins = new Set<string>([defaultOrigin]);

  if (isMobileWebview(userAgent) && clientDataOrigin) {
    expectedOrigins.add(clientDataOrigin);
  }

  const allowedEmbedOrigins = (process.env.ALLOWED_EMBED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (clientDataOrigin && allowedEmbedOrigins.includes(clientDataOrigin)) {
    expectedOrigins.add(clientDataOrigin);
  }

  const origins = Array.from(expectedOrigins);
  return origins.length === 1 ? origins[0] : origins;
}

/**
 * Verify the challenge + origin against a normalized RP ID.
 * Cross-subdomain embeds (e.g. staging.*) pass when they share the parent RP ID.
 */
export function verifyWebAuthnChallenge(
  input: WebAuthnVerifyInput,
): WebAuthnVerifyResult {
  const rpId = normalizeRpId(input.origin, input.rpId);

  if (!rpId || !input.expectedChallenge || !input.challenge) {
    return { ok: false, error: "Invalid WebAuthn challenge signature" };
  }

  if (input.challenge !== input.expectedChallenge) {
    return { ok: false, error: "Invalid WebAuthn challenge signature" };
  }

  if (!isOriginAllowedForRpId(input.origin, rpId, input.userAgent)) {
    return { ok: false, error: "Invalid WebAuthn challenge signature" };
  }

  return { ok: true, rpId };
}
