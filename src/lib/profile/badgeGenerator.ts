/**
 * Nomad passport credential badge generator.
 *
 * Produces a self-contained, high resolution SVG (no external references, no
 * scripts) showing the user's display name, nomad rank, verified check-in
 * count, and issue timestamp. All user supplied text is validated and
 * XML escaped before it is placed into the markup.
 */

import { downloadSVG } from "@/lib/qr/svgQr";

export const BADGE_VIEWBOX_WIDTH = 600;
export const BADGE_VIEWBOX_HEIGHT = 340;
export const BADGE_EXPORT_WIDTH = 1200;
export const BADGE_EXPORT_HEIGHT = 680;
export const BADGE_MAX_NAME_LENGTH = 28;
export const BADGE_MAX_RANK_LENGTH = 20;
export const BADGE_MAX_CHECK_INS = 999_999;

export interface NomadBadgeParams {
  /** User display name. Truncated to BADGE_MAX_NAME_LENGTH characters. */
  displayName: string;
  /** Nomad passport tier, for example Explorer, Veteran, or Pioneer. */
  rank: string;
  /** Number of verified check-ins. Must be a non negative integer. */
  verifiedCheckIns: number;
  /** Issue time. Defaults to now. */
  issuedAt?: Date | string | number;
}

export interface SanitizedNomadBadgeParams {
  displayName: string;
  rank: string;
  verifiedCheckIns: number;
  issuedAt: Date;
}

export class BadgeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadgeValidationError";
    Object.setPrototypeOf(this, BadgeValidationError.prototype);
  }
}

// XML 1.0 forbids most C0 control characters and U+FFFE / U+FFFF.
const INVALID_XML_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFE\uFFFF]/g;

/** Escapes text for safe use in XML text nodes and attribute values. */
export function escapeSvgText(value: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  };
  return value
    .replace(INVALID_XML_CHARS, "")
    .replace(/[&<>"']/g, (character) => entities[character]);
}

function cleanText(value: string, maxLength: number): string {
  const collapsed = value
    .replace(INVALID_XML_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(collapsed);
  if (chars.length <= maxLength) return collapsed;
  return `${chars.slice(0, maxLength - 1).join("")}\u2026`;
}

/**
 * Validates and normalizes badge parameters. Throws BadgeValidationError on
 * invalid input. Does not XML escape: escaping happens at render time.
 */
export function validateBadgeParams(
  params: NomadBadgeParams,
): SanitizedNomadBadgeParams {
  if (params === null || typeof params !== "object") {
    throw new BadgeValidationError("Badge parameters are required");
  }

  if (typeof params.displayName !== "string") {
    throw new BadgeValidationError("displayName must be a string");
  }
  const displayName = cleanText(params.displayName, BADGE_MAX_NAME_LENGTH);
  if (displayName.length === 0) {
    throw new BadgeValidationError("displayName must not be empty");
  }

  if (typeof params.rank !== "string") {
    throw new BadgeValidationError("rank must be a string");
  }
  const rank = cleanText(params.rank, BADGE_MAX_RANK_LENGTH);
  if (rank.length === 0) {
    throw new BadgeValidationError("rank must not be empty");
  }

  const count = params.verifiedCheckIns;
  if (
    typeof count !== "number" ||
    !Number.isFinite(count) ||
    !Number.isInteger(count) ||
    count < 0
  ) {
    throw new BadgeValidationError(
      "verifiedCheckIns must be a non negative integer",
    );
  }
  if (count > BADGE_MAX_CHECK_INS) {
    throw new BadgeValidationError(
      `verifiedCheckIns must not exceed ${BADGE_MAX_CHECK_INS}`,
    );
  }

  const issuedAt =
    params.issuedAt === undefined ? new Date() : new Date(params.issuedAt);
  if (Number.isNaN(issuedAt.getTime())) {
    throw new BadgeValidationError("issuedAt must be a valid date");
  }

  return { displayName, rank, verifiedCheckIns: count, issuedAt };
}

const RANK_ACCENTS: Record<string, [string, string]> = {
  explorer: ["#22d3ee", "#3b82f6"],
  veteran: ["#a78bfa", "#6366f1"],
  pioneer: ["#fbbf24", "#f97316"],
};
const DEFAULT_ACCENT: [string, string] = ["#22d3ee", "#a78bfa"];

function formatIssueTimestamp(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** Builds the badge SVG string. Throws BadgeValidationError on bad input. */
export function generateNomadBadgeSvg(params: NomadBadgeParams): string {
  const clean = validateBadgeParams(params);
  const name = escapeSvgText(clean.displayName);
  const rank = escapeSvgText(clean.rank.toUpperCase());
  const checkIns = escapeSvgText(
    clean.verifiedCheckIns.toLocaleString("en-US"),
  );
  const issued = escapeSvgText(formatIssueTimestamp(clean.issuedAt));
  const [accentA, accentB] =
    RANK_ACCENTS[clean.rank.toLowerCase()] ?? DEFAULT_ACCENT;
  const label = escapeSvgText(
    `WorkSphere nomad badge for ${clean.displayName}, rank ${clean.rank}, ${clean.verifiedCheckIns} verified check-ins`,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BADGE_VIEWBOX_WIDTH} ${BADGE_VIEWBOX_HEIGHT}" width="${BADGE_EXPORT_WIDTH}" height="${BADGE_EXPORT_HEIGHT}" role="img" aria-label="${label}">
  <title>${label}</title>
  <defs>
    <linearGradient id="wsBorder" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${accentA}"/>
      <stop offset="0.5" stop-color="#8b5cf6"/>
      <stop offset="1" stop-color="${accentB}"/>
    </linearGradient>
    <linearGradient id="wsBg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0b1020"/>
      <stop offset="1" stop-color="#050816"/>
    </linearGradient>
    <linearGradient id="wsGlass" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.12"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.03"/>
    </linearGradient>
  </defs>
  <rect x="2" y="2" width="596" height="336" rx="22" fill="url(#wsBg)"/>
  <g stroke="#ffffff" stroke-opacity="0.04" stroke-width="1">
    <path d="M0 85H600M0 170H600M0 255H600M150 0V340M300 0V340M450 0V340"/>
  </g>
  <rect x="24" y="24" width="552" height="292" rx="16" fill="url(#wsGlass)" stroke="url(#wsBorder)" stroke-width="3"/>
  <text x="48" y="64" fill="#94a3b8" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="13" letter-spacing="3">WORKSPHERE NOMAD PASSPORT</text>
  <circle cx="530" cy="58" r="16" fill="none" stroke="${accentA}" stroke-width="2"/>
  <path d="M522 58l6 6 11-12" fill="none" stroke="${accentA}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="48" y="150" fill="#f8fafc" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="34" font-weight="700">${name}</text>
  <text x="48" y="188" fill="${accentA}" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="18" font-weight="600" letter-spacing="4">${rank}</text>
  <line x1="48" y1="216" x2="552" y2="216" stroke="url(#wsBorder)" stroke-opacity="0.6" stroke-width="1"/>
  <text x="48" y="248" fill="#94a3b8" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="12" letter-spacing="2">VERIFIED CHECK-INS</text>
  <text x="48" y="290" fill="#f8fafc" font-family="'SFMono-Regular', Consolas, monospace" font-size="36" font-weight="700">${checkIns}</text>
  <text x="552" y="248" fill="#94a3b8" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="12" letter-spacing="2" text-anchor="end">ISSUED</text>
  <text x="552" y="290" fill="#e2e8f0" font-family="'SFMono-Regular', Consolas, monospace" font-size="16" text-anchor="end">${issued}</text>
</svg>`;
}

/** Wraps the generated SVG in a Blob ready for download. */
export function createNomadBadgeBlob(params: NomadBadgeParams): Blob {
  return new Blob([generateNomadBadgeSvg(params)], {
    type: "image/svg+xml;charset=utf-8",
  });
}

/** Builds a safe lowercase file name such as `nomad-badge-alex-nomad.svg`. */
export function getNomadBadgeFilename(displayName: string): string {
  const slug = String(displayName ?? "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 40);
  return `nomad-badge-${slug || "member"}.svg`;
}

/** Generates the badge and triggers a browser download. */
export function downloadNomadBadge(params: NomadBadgeParams): void {
  const svg = generateNomadBadgeSvg(params);
  downloadSVG(svg, getNomadBadgeFilename(params.displayName));
}
