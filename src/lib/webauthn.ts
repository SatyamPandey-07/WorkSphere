/**
 * WebAuthn RP ID + origin helpers.
 *
 * Passkeys are bound to an RP ID. If we pin that to a single host like
 * `app.worksphere.dev`, staging / embed subdomains fail verification even
 * though they belong to the same site. We normalize to the parent domain and
 * accept any origin whose hostname is that RP ID or a subdomain of it.
 */

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
    // allow full URLs in env by accident
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

  // Simple eTLD+1: foo.bar.com → bar.com, staging.app.io → app.io
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

export type WebAuthnVerifyInput = {
  /** Browser origin from clientDataJSON (or request Origin header). */
  origin: string;
  /** Expected challenge previously issued to the client. */
  expectedChallenge: string;
  /** Challenge echoed back inside clientDataJSON. */
  challenge: string;
  /** Optional override; otherwise WEBAUTHN_RP_ID / derived from origin. */
  rpId?: string;
  /** User-Agent header from incoming request. */
  userAgent?: string | null;
};

export type WebAuthnVerifyResult =
  | { ok: true; rpId: string }
  | { ok: false; error: "Invalid WebAuthn challenge signature" };

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

/** Decode a base64url clientDataJSON payload. */
export function parseClientDataJSON(clientDataJSON: string): {
  type?: string;
  challenge?: string;
  origin?: string;
} | null {
  try {
    const b64 = clientDataJSON.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const json = atob(b64 + pad);
    return JSON.parse(json);
  } catch {
    return null;
  }
}
