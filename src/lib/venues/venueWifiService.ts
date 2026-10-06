/**
 * Venue Wi-Fi Auto-Configuration & QR Generation Service
 * 
 * Generates standard WPA/WPA2/WPA3 Wi-Fi connection strings conforming to the
 * ZXing / IEEE 802.11 Wi-Fi QR standard (WIFI:T:<auth>;S:<ssid>;P:<password>;H:<hidden>;;)
 * and renders high-resolution SVG QR codes & printable table tent cards.
 */

import { generateQRCodeSVG, escapeXmlText } from "@/lib/qr/svgQr";

export type WifiAuthType = "WPA" | "WPA2" | "WPA3" | "WEP" | "nopass";

export interface VenueWifiConfig {
  venueId: string;
  venueName: string;
  ssid: string;
  password?: string;
  authType: WifiAuthType;
  hidden: boolean;
  frequencyBand?: "2.4 GHz" | "5 GHz" | "6 GHz (Wi-Fi 6E/7)";
  speedMbps?: number;
  captivePortalUrl?: string;
  lastVerifiedAt: string;
}

// In-memory store for custom venue Wi-Fi credentials
const venueWifiStore = new Map<string, VenueWifiConfig>();

/**
 * Escapes characters for standard Wi-Fi QR string formatting:
 * Special characters \ , ; : " must be preceded by \.
 */
export function escapeWifiQrString(str: string): string {
  return str.replace(/([\\;,:"\\])/g, "\\$1");
}

/**
 * Constructs the standard Wi-Fi QR Code string URI.
 * Example: WIFI:T:WPA;S:WorkSphere_Guest;P:secret123;H:false;;
 */
export function buildWifiQrString(config: {
  ssid: string;
  password?: string;
  authType?: WifiAuthType;
  hidden?: boolean;
}): string {
  const type = config.authType || (config.password ? "WPA" : "nopass");
  const escapedSsid = escapeWifiQrString(config.ssid);
  const escapedPass = config.password ? escapeWifiQrString(config.password) : "";
  const hiddenFlag = config.hidden ? "true" : "false";

  let qr = `WIFI:T:${type};S:${escapedSsid};`;
  if (type !== "nopass" && escapedPass) {
    qr += `P:${escapedPass};`;
  }
  if (config.hidden) {
    qr += `H:${hiddenFlag};`;
  }
  qr += ";";

  return qr;
}

/**
 * Retrieves or initializes default auto-configured Wi-Fi settings for a venue.
 */
export function getVenueWifiConfig(venueId: string, venueName: string, defaultSpeed?: number | null): VenueWifiConfig {
  const existing = venueWifiStore.get(venueId);
  if (existing) return existing;

  // Clean venue name to generate clean standard SSID
  const sanitizedName = venueName.replace(/[^a-zA-Z0-9]/g, "").slice(0, 18);
  const defaultSsid = `${sanitizedName || "Venue"}_Guest`;
  const defaultPassword = `${sanitizedName.toLowerCase()}work2026`;

  const config: VenueWifiConfig = {
    venueId,
    venueName,
    ssid: defaultSsid,
    password: defaultPassword,
    authType: "WPA",
    hidden: false,
    frequencyBand: "5 GHz",
    speedMbps: defaultSpeed || 250,
    lastVerifiedAt: new Date().toISOString(),
  };

  venueWifiStore.set(venueId, config);
  return config;
}

/**
 * Updates Wi-Fi credentials for a venue.
 */
export function updateVenueWifiConfig(config: VenueWifiConfig): VenueWifiConfig {
  config.lastVerifiedAt = new Date().toISOString();
  venueWifiStore.set(config.venueId, config);
  return config;
}

/**
 * Generates an SVG QR code for the venue Wi-Fi configuration.
 */
export function generateWifiQrSvg(config: VenueWifiConfig, size = 260): string {
  const payload = buildWifiQrString({
    ssid: config.ssid,
    password: config.password,
    authType: config.authType,
    hidden: config.hidden,
  });

  return generateQRCodeSVG(payload, {
    size,
    padding: 3,
    fgColor: "#09090b", // zinc-950
    bgColor: "#ffffff",
    title: `Wi-Fi QR for ${config.ssid}`,
  });
}

/**
 * Generates a printable Table Tent Card SVG with venue branding, QR code, and credentials.
 */
export function generatePrintableTableTentSvg(config: VenueWifiConfig): string {
  const qrSvgRaw = generateWifiQrSvg(config, 200);
  // Extract path and viewbox from qr svg
  const safeVenue = escapeXmlText(config.venueName);
  const safeSsid = escapeXmlText(config.ssid);
  const safePass = escapeXmlText(config.password || "No Password Required (Open)");
  const safeSpeed = config.speedMbps ? `${config.speedMbps} Mbps High-Speed Fiber` : "High-Speed Wi-Fi";

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 560" width="400" height="560" font-family="system-ui, -apple-system, sans-serif">
  <defs>
    <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2563eb" />
      <stop offset="100%" stop-color="#7c3aed" />
    </linearGradient>
    <filter id="cardShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-opacity="0.12" />
    </filter>
  </defs>

  <!-- Card Background -->
  <rect x="10" y="10" width="380" height="540" rx="24" fill="#ffffff" stroke="#e4e4e7" stroke-width="2" filter="url(#cardShadow)" />

  <!-- Header Gradient Area -->
  <rect x="10" y="10" width="380" height="110" rx="24" fill="url(#headerGrad)" />
  <rect x="10" y="90" width="380" height="30" fill="url(#headerGrad)" />

  <!-- Header Content -->
  <text x="200" y="50" fill="#ffffff" font-size="12" font-weight="800" letter-spacing="2" text-anchor="middle" text-transform="uppercase">WorkSphere Connected Venue</text>
  <text x="200" y="80" fill="#ffffff" font-size="20" font-weight="900" text-anchor="middle">${safeVenue}</text>

  <!-- Speed Pill Badge -->
  <rect x="100" y="130" width="200" height="28" rx="14" fill="#ecfdf5" stroke="#a7f3d0" stroke-width="1" />
  <text x="200" y="149" fill="#059669" font-size="11" font-weight="700" text-anchor="middle">⚡ ${safeSpeed}</text>

  <!-- QR Code Container -->
  <g transform="translate(100, 175)">
    ${qrSvgRaw}
  </g>

  <!-- Instructions -->
  <text x="200" y="400" fill="#18181b" font-size="13" font-weight="800" text-anchor="middle">Scan with Camera to Auto-Join</text>
  <text x="200" y="418" fill="#71717a" font-size="11" text-anchor="middle">iOS and Android support native 1-tap connection</text>

  <!-- Divider -->
  <line x1="40" y1="435" x2="360" y2="435" stroke="#f4f4f5" stroke-width="2" />

  <!-- Credentials Table -->
  <text x="60" y="465" fill="#71717a" font-size="10" font-weight="700" text-transform="uppercase" letter-spacing="1">Network (SSID)</text>
  <text x="60" y="485" fill="#09090b" font-size="14" font-weight="800">${safeSsid}</text>

  <text x="220" y="465" fill="#71717a" font-size="10" font-weight="700" text-transform="uppercase" letter-spacing="1">Password</text>
  <text x="220" y="485" fill="#09090b" font-size="14" font-weight="800">${safePass}</text>

  <!-- Footer -->
  <text x="200" y="525" fill="#a1a1aa" font-size="10" font-weight="600" text-anchor="middle">Powered by WorkSphere Smart Coworking</text>
</svg>
`.trim();
}
