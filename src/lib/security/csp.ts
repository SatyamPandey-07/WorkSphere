/**
 * Content Security Policy (CSP) and Cryptographic Nonce generation utilities.
 */

export function getClerkFrontendApiHost(): string | null {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const match = key?.match(/^pk_(?:test|live)_(.+)$/);
  if (!match) return null;
  try {
    return atob(match[1]).replace(/\$$/, "");
  } catch {
    return null;
  }
}

export function getPartyKitOrigins(): string[] {
  const host = process.env.NEXT_PUBLIC_PARTYKIT_HOST;
  const origins = ["https://*.partykit.dev", "wss://*.partykit.dev"];
  if (host) {
    const bare = host.replace(/^(https?|wss?):\/\//, "").replace(/\/.*$/, "");
    origins.push(`https://${bare}`, `wss://${bare}`);
    if (process.env.NODE_ENV === "development") {
      origins.push(`http://${bare}`, `ws://${bare}`);
    }
  }
  return origins;
}

/**
 * Generates a 16-byte cryptographically secure random nonce encoded in base64.
 */
export function generateCryptographicNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes));
  }
  return btoa(crypto.randomUUID());
}

/**
 * Builds the strict Content-Security-Policy header directive string.
 */
export function generateCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  const clerkFrontendApi = getClerkFrontendApiHost();
  const clerkHosts = [
    "https://*.clerk.com",
    "https://*.clerk.accounts.dev",
    ...(clerkFrontendApi ? [`https://${clerkFrontendApi}`] : []),
  ].join(" ");

  // Map tile CDNs, geocoding and routing endpoints
  const mapboxOrigins = "https://*.mapbox.com https://api.mapbox.com https://events.mapbox.com";
  const openStreetMapOrigins = "https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://nominatim.openstreetmap.org https://router.project-osrm.org";
  const cartoOrigins = "https://*.basemaps.cartocdn.com";
  const pexelsOrigins = "https://api.pexels.com https://images.pexels.com";

  return [
    `default-src 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'self'`,
    `form-action 'self'`,
    `script-src 'self' 'nonce-${nonce}' ${clerkHosts} ${mapboxOrigins} https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com ${mapboxOrigins}`,
    `font-src 'self' https://fonts.gstatic.com data:`,
    // Map tiles (OpenStreetMap, CartoCDN, Mapbox), avatars, venue photos, and user uploads
    `img-src 'self' data: blob: https: ${openStreetMapOrigins} ${cartoOrigins} ${mapboxOrigins}`,
    `media-src 'self' blob: data:`,
    `connect-src 'self' ${clerkHosts} https://clerk-telemetry.com ${openStreetMapOrigins} ${cartoOrigins} ${mapboxOrigins} ${pexelsOrigins} ${getPartyKitOrigins().join(" ")}`,
    `frame-src 'self' ${clerkHosts} https://challenges.cloudflare.com`,
    `worker-src 'self' blob:`,
    `upgrade-insecure-requests`,
  ].join("; ");
}
