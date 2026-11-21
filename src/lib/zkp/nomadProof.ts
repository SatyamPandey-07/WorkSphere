export const NOMAD_BADGE_POLICIES = {
  NOMAD_100_HOURS: {
    badgeType: "NOMAD_100_HOURS",
    tierTitle: "100-Hour Deep Work Focus Master",
    minThresholdStreak: 14,
    minThresholdHours: 100,
  },
  STREAK_30_DAYS: {
    badgeType: "STREAK_30_DAYS",
    tierTitle: "30-Day Workspace Streak Champion",
    minThresholdStreak: 30,
    minThresholdHours: 60,
  },
} as const;

export type ClaimableNomadBadgeType = keyof typeof NOMAD_BADGE_POLICIES;

export type NomadBadgeType =
  ClaimableNomadBadgeType | "NOMAD_50_HOURS" | "MULTI_CITY_EXPLORER";

export interface NomadProductivityStatement {
  badgeType: ClaimableNomadBadgeType;
  tierTitle: string;
  minThresholdStreak: number;
  minThresholdHours: number;
  epoch: number;
}

export interface NomadProverInput {
  minThresholdStreak: string;
  minThresholdHours: string;
  epoch: string;
  expectedCommitment: string;
  identitySecret: string;
  actualStreakDays: string;
  actualWorkMinutes: string;
}

export interface NomadProofChallenge {
  statement: NomadProductivityStatement;
  input: NomadProverInput;
}

export interface NomadProofPayload {
  proof: unknown;
  publicSignals: unknown;
}

export interface PassportStamp {
  stampId: string;
  badgeType: string;
  tierTitle: string;
  epoch: number;
  issuedAt: string;
  nullifierHash: string;
  verificationSignature: string;
  svgMarkup: string;
  venueName?: string;
  visitDate?: string;
  countryCode?: string;
  countryName?: string;
}

export function createNomadProductivityStatement(
  badgeType: unknown,
  epoch = new Date().getUTCFullYear(),
): NomadProductivityStatement | null {
  if (
    typeof badgeType !== "string" ||
    !Object.prototype.hasOwnProperty.call(NOMAD_BADGE_POLICIES, badgeType) ||
    !Number.isSafeInteger(epoch) ||
    epoch <= 0
  ) {
    return null;
  }

  const policy = NOMAD_BADGE_POLICIES[badgeType as ClaimableNomadBadgeType];

  return {
    ...policy,
    epoch,
  };
}

function escapeSvgText(value: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  };

  return value.replace(/[&<>"']/g, (character) => entities[character]);
}

export function generateBadgeSvgMarkup(stamp: PassportStamp): string {
  const venue = escapeSvgText(stamp.venueName || "WorkSphere Verified Hub");

  const issuedAt = stamp.issuedAt ? new Date(stamp.issuedAt) : null;

  const visit =
    stamp.visitDate ||
    (issuedAt && !Number.isNaN(issuedAt.getTime())
      ? issuedAt.toISOString().split("T")[0]
      : "Unknown");

  const badgeTitle = escapeSvgText(
    stamp.countryName
      ? `${stamp.countryName.toUpperCase()} NOMAD STAMP`
      : stamp.tierTitle.toUpperCase(),
  );

  const safeVisit = escapeSvgText(visit);
  const safeNullifier = escapeSvgText((stamp.nullifierHash || "").slice(0, 20));
  const safeStampId = escapeSvgText(stamp.stampId);

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="100%" height="100%">
  <defs>
    <linearGradient id="stampBadgeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4f46e5" />
      <stop offset="50%" stop-color="#06b6d4" />
      <stop offset="100%" stop-color="#10b981" />
    </linearGradient>
  </defs>
  <circle cx="200" cy="200" r="185" fill="#0f172a" stroke="url(#stampBadgeGrad)" stroke-width="8" stroke-dasharray="12,6" />
  <circle cx="200" cy="200" r="158" fill="none" stroke="#334155" stroke-width="2" />
  <text x="200" y="75" text-anchor="middle" fill="#38bdf8" font-family="system-ui, sans-serif" font-size="12" font-weight="bold" letter-spacing="3">WORKSPHERE NOMAD PASSPORT</text>
  <text x="200" y="115" text-anchor="middle" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="16" font-weight="900">${badgeTitle}</text>
  <text x="200" y="142" text-anchor="middle" fill="#a5f3fc" font-family="system-ui, sans-serif" font-size="13">📍 ${venue}</text>
  <text x="200" y="166" text-anchor="middle" fill="#94a3b8" font-family="monospace" font-size="11">VISIT DATE: ${safeVisit} • EPOCH ${stamp.epoch}</text>
  <circle cx="200" cy="220" r="30" fill="#1e293b" stroke="#38bdf8" stroke-width="3" />
  <path d="M190 220 l7 7 l14 -14" fill="none" stroke="#38bdf8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
  <text x="200" y="278" text-anchor="middle" fill="#34d399" font-family="system-ui, sans-serif" font-size="11" font-weight="bold">✓ ZERO-KNOWLEDGE VERIFIED</text>
  <text x="200" y="306" text-anchor="middle" fill="#64748b" font-family="monospace" font-size="9">NULLIFIER: ${safeNullifier}...</text>
  <text x="200" y="328" text-anchor="middle" fill="#38bdf8" font-family="monospace" font-size="10" font-weight="bold">ID: ${safeStampId}</text>
</svg>`.trim();
}
