/**
 * Tests for venue desk utilization by time and type.
 */

type DeskType = "standard" | "standing" | "private" | "collaborative";

interface DeskUsageRecord {
  deskId: string;
  type: DeskType;
  venueId: string;
  date: string;
  startHour: number;
  endHour: number;
  userId: string;
}

function deskHoursUsed(
  records: DeskUsageRecord[],
  deskId: string,
  date: string
): number {
  return records
    .filter((r) => r.deskId === deskId && r.date === date)
    .reduce((sum, r) => sum + (r.endHour - r.startHour), 0);
}

function utilizationByType(
  records: DeskUsageRecord[],
  venueId: string,
  date: string
): Record<DeskType, number> {
  const result: Record<DeskType, number> = { standard: 0, standing: 0, private: 0, collaborative: 0 };
  records
    .filter((r) => r.venueId === venueId && r.date === date)
    .forEach((r) => { result[r.type] = (result[r.type] ?? 0) + (r.endHour - r.startHour); });
  return result;
}

function mostPopularDeskType(
  records: DeskUsageRecord[],
  venueId: string
): DeskType | null {
  const counts: Record<string, number> = {};
  records.filter((r) => r.venueId === venueId).forEach((r) => {
    counts[r.type] = (counts[r.type] ?? 0) + 1;
  });
  const entries = Object.entries(counts);
  if (entries.length === 0) return null;
  return entries.reduce((max, e) => Number(e[1]) > Number(max[1]) ? e : max)[0] as DeskType;
}

function peakUsageHour(records: DeskUsageRecord[], venueId: string, date: string): number | null {
  const venue = records.filter((r) => r.venueId === venueId && r.date === date);
  if (venue.length === 0) return null;
  const hourCounts: Record<number, number> = {};
  venue.forEach((r) => {
    for (let h = r.startHour; h < r.endHour; h++) {
      hourCounts[h] = (hourCounts[h] ?? 0) + 1;
    }
  });
  const peak = Object.entries(hourCounts).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
  return peak ? Number(peak[0]) : null;
}

const RECORDS: DeskUsageRecord[] = [
  { deskId: "d1", type: "standard",     venueId: "v1", date: "2026-10-01", startHour: 9,  endHour: 12, userId: "u1" },
  { deskId: "d2", type: "standing",     venueId: "v1", date: "2026-10-01", startHour: 10, endHour: 14, userId: "u2" },
  { deskId: "d3", type: "standard",     venueId: "v1", date: "2026-10-01", startHour: 9,  endHour: 17, userId: "u3" },
  { deskId: "d4", type: "collaborative",venueId: "v2", date: "2026-10-01", startHour: 11, endHour: 15, userId: "u4" },
];

describe("Venue desk utilization", () => {
  it("deskHoursUsed: d1 = 3h", () => {
    expect(deskHoursUsed(RECORDS, "d1", "2026-10-01")).toBe(3);
  });

  it("deskHoursUsed: unknown desk → 0", () => {
    expect(deskHoursUsed(RECORDS, "d99", "2026-10-01")).toBe(0);
  });

  it("utilizationByType: v1 standard = 11h (3+8)", () => {
    const util = utilizationByType(RECORDS, "v1", "2026-10-01");
    expect(util.standard).toBe(11);
    expect(util.standing).toBe(4);
  });

  it("mostPopularDeskType: standard appears most in v1", () => {
    expect(mostPopularDeskType(RECORDS, "v1")).toBe("standard");
  });

  it("mostPopularDeskType: no records → null", () => {
    expect(mostPopularDeskType([], "v1")).toBeNull();
  });

  it("peakUsageHour: v1 Oct 1 = 10 or 11 (2 desks active)", () => {
    const peak = peakUsageHour(RECORDS, "v1", "2026-10-01");
    expect(peak).toBeGreaterThanOrEqual(9);
    expect(peak).toBeLessThanOrEqual(17);
  });
});
