/**
 * Tests for event attendee digital badge generation.
 */

interface AttendeeBadge {
  attendeeId: string;
  eventId: string;
  name: string;
  role: "speaker" | "sponsor" | "organizer" | "attendee";
  company?: string;
  qrCode: string;
  issuedat: number;
  expiresAt: number | null;
}

function generateQrCode(attendeeId: string, eventId: string): string {
  return `${eventId}:${attendeeId}:${Date.now()}`;
}

function isBadgeValid(badge: AttendeeBadge, nowMs: number): boolean {
  if (badge.expiresAt !== null && nowMs >= badge.expiresAt) return false;
  return true;
}

function badgeDisplayName(badge: AttendeeBadge): string {
  const rolePrefixes: Record<AttendeeBadge["role"], string> = {
    speaker:   "🎤",
    sponsor:   "⭐",
    organizer: "🎯",
    attendee:  "",
  };
  const prefix = rolePrefixes[badge.role];
  return prefix ? `${prefix} ${badge.name}` : badge.name;
}

function organizerBadges(badges: AttendeeBadge[]): AttendeeBadge[] {
  return badges.filter((b) => b.role === "organizer");
}

function speakerBadges(badges: AttendeeBadge[]): AttendeeBadge[] {
  return badges.filter((b) => b.role === "speaker");
}

const NOW = 1_700_000_000_000;
const BADGES: AttendeeBadge[] = [
  { attendeeId: "a1", eventId: "e1", name: "Alice",  role: "speaker",   company: "TechCorp", qrCode: "qr1", issuedat: NOW - 1000, expiresAt: NOW + 86_400_000 },
  { attendeeId: "a2", eventId: "e1", name: "Bob",    role: "organizer", company: "WorkSphere", qrCode: "qr2", issuedat: NOW - 2000, expiresAt: null },
  { attendeeId: "a3", eventId: "e1", name: "Carol",  role: "attendee",  qrCode: "qr3", issuedat: NOW - 500, expiresAt: NOW + 86_400_000 },
];

describe("Event attendee badge", () => {
  it("isBadgeValid: future expiry → valid", () => {
    expect(isBadgeValid(BADGES[0], NOW)).toBe(true);
  });

  it("isBadgeValid: null expiry → always valid", () => {
    expect(isBadgeValid(BADGES[1], NOW + 999_999_999)).toBe(true);
  });

  it("isBadgeValid: past expiry → invalid", () => {
    const expired = { ...BADGES[0], expiresAt: NOW - 1 };
    expect(isBadgeValid(expired, NOW)).toBe(false);
  });

  it("badgeDisplayName: speaker gets emoji prefix", () => {
    expect(badgeDisplayName(BADGES[0])).toContain("Alice");
    expect(badgeDisplayName(BADGES[0])).toContain("🎤");
  });

  it("badgeDisplayName: attendee has no prefix", () => {
    expect(badgeDisplayName(BADGES[2])).toBe("Carol");
  });

  it("organizerBadges: returns Bob", () => {
    const organizers = organizerBadges(BADGES);
    expect(organizers).toHaveLength(1);
    expect(organizers[0].name).toBe("Bob");
  });

  it("speakerBadges: returns Alice", () => {
    expect(speakerBadges(BADGES).map((b) => b.name)).toContain("Alice");
  });

  it("generateQrCode: includes attendeeId and eventId", () => {
    const qr = generateQrCode("a1", "e1");
    expect(qr).toContain("e1");
    expect(qr).toContain("a1");
  });
});
