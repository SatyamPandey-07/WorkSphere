/**
 * Attendee Admission Token & Ticket Generator for Social Sessions (#5066)
 */
import { generateQRCodeSVG } from "@/lib/qr/svgQr";

export interface AdmissionTokenPayload {
  sessionSlug: string;
  userId: string;
  venueName?: string;
  startsAt?: string;
  issuedAt?: number;
}

/**
 * Encodes an attendee admission token into a portable URL-safe token.
 * Format: "ws-admit:v1:<base64url>"
 */
export function encodeAdmissionToken(payload: AdmissionTokenPayload): string {
  const data = {
    s: payload.sessionSlug,
    u: payload.userId,
    v: payload.venueName,
    t: payload.startsAt,
    iat: payload.issuedAt ?? Math.floor(Date.now() / 1000),
  };
  const json = JSON.stringify(data);
  // ponytail: standard Base64 encoding without heavy external token packages
  const b64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(json, "utf-8").toString("base64url")
      : btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `ws-admit:v1:${b64}`;
}

/**
 * Decodes and validates an attendee admission token string.
 */
export function decodeAdmissionToken(token: string): AdmissionTokenPayload | null {
  if (!token || typeof token !== "string" || !token.startsWith("ws-admit:v1:")) {
    return null;
  }
  const b64 = token.slice("ws-admit:v1:".length);
  try {
    let json: string;
    if (typeof Buffer !== "undefined") {
      json = Buffer.from(b64, "base64url").toString("utf-8");
    } else {
      const padded = b64.replace(/-/g, "+").replace(/_/g, "/");
      json = atob(padded);
    }
    const data = JSON.parse(json);
    if (!data || typeof data.s !== "string" || typeof data.u !== "string") {
      return null;
    }
    return {
      sessionSlug: data.s,
      userId: data.u,
      venueName: data.v,
      startsAt: data.t,
      issuedAt: data.iat,
    };
  } catch {
    return null;
  }
}

/**
 * Generates an SVG QR code encoding the attendee admission token.
 */
export function generateAdmissionTicketQR(
  payload: AdmissionTokenPayload,
  options: { size?: number } = {},
): string {
  const token = encodeAdmissionToken(payload);
  return generateQRCodeSVG(token, {
    size: options.size || 120,
    title: `Admission Ticket for ${payload.sessionSlug}`,
    fgColor: "#09090b",
    bgColor: "#ffffff",
    padding: 2,
  });
}
