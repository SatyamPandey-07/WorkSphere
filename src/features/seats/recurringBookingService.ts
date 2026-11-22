import { generateRecurringDates, MAX_RECURRING_OCCURRENCES } from "@/lib/booking/recurrence";

export type WeekdayCode = "SU" | "MO" | "TU" | "WE" | "TH" | "FR" | "SA";

export interface DateRangeInput {
  startDate: string;
  endDate: string;
}

export interface ConflictDetail {
  date: string;
  reason: "BOOKED" | "HELD";
  referenceId?: string;
}

export interface AlternativeDeskSuggestion {
  deskId: string;
  availableForAllRequestedDates: boolean;
  freeDates: string[];
  conflictedDates: string[];
}

export interface RecurringValidationResult {
  seatId: string;
  rrulePattern: string;
  requestedDates: string[];
  availableDates: string[];
  conflictedDates: ConflictDetail[];
  alternativeDesks: AlternativeDeskSuggestion[];
}

export interface SeatOccupancyStore {
  getOccupiedDates(
    seatId: string,
    dates: string[],
  ): Promise<Map<string, ConflictDetail>>;
  listCandidateDesks?(
    seatId: string,
    dates: string[],
  ): Promise<Array<{ deskId: string; occupiedDates: Set<string> }>>;
}

const JS_DAY_TO_CODE: WeekdayCode[] = [
  "SU",
  "MO",
  "TU",
  "WE",
  "TH",
  "FR",
  "SA",
];
const CODE_TO_JS_DAY: Record<WeekdayCode, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

function parseUtcDay(dateStr: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) {
    throw new Error(`Invalid date format (expected YYYY-MM-DD): ${dateStr}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month ||
    dt.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${dateStr}`);
  }
  return dt;
}

function formatUtcDay(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function expandRecurringDates(
  rrulePattern: string,
  range: DateRangeInput,
): string[] {
  const start = parseUtcDay(range.startDate);
  const end = parseUtcDay(range.endDate);
  if (end.getTime() < start.getTime()) {
    return [];
  }

  const normalized = rrulePattern.trim().toUpperCase();
  const parts = new Map<string, string>();
  for (const segment of normalized.split(";")) {
    const [k, v] = segment.split("=");
    if (k && v) {
      parts.set(k.trim(), v.trim());
    }
  }

  const freq = parts.get("FREQ") ?? "";
  const intervalRaw = Number(parts.get("INTERVAL") ?? "1");
  const interval =
    Number.isFinite(intervalRaw) && intervalRaw > 0
      ? Math.floor(intervalRaw)
      : 1;

  // Handle RFC 5545 monthly recurrence (FREQ=MONTHLY)
  if (freq === "MONTHLY") {
    // Reuse battle-tested shared monthly recurrence engine with leap-year & month-end clamping
    const allMonthly = generateRecurringDates(
      range.startDate,
      "monthly",
      range.endDate,
      MAX_RECURRING_OCCURRENCES,
    );

    if (interval === 1) {
      return allMonthly;
    }

    // Step by interval (e.g. INTERVAL=2 for bi-monthly)
    const filtered: string[] = [];
    for (let i = 0; i < allMonthly.length; i += interval) {
      filtered.push(allMonthly[i]);
    }
    return filtered;
  }

  const intervalWeeks = interval;
  const byDayRaw = parts.get("BYDAY");
  let allowedDays = new Set<number>();

  if (byDayRaw) {
    for (const token of byDayRaw.split(",")) {
      const code = token.trim() as WeekdayCode;
      if (code in CODE_TO_JS_DAY) {
        allowedDays.add(CODE_TO_JS_DAY[code]);
      }
    }
  } else if (normalized.includes("WEEKDAYS")) {
    allowedDays = new Set([1, 2, 3, 4, 5]);
  } else {
    allowedDays = new Set([1, 2, 3, 4, 5]);
  }

  const startWeekStartMs = start.getTime() - start.getUTCDay() * 86_400_000;

  const matched: string[] = [];
  for (let ms = start.getTime(); ms <= end.getTime(); ms += 86_400_000) {
    const current = new Date(ms);
    const weekIndex = Math.floor((ms - startWeekStartMs) / (7 * 86_400_000));
    if (weekIndex % intervalWeeks !== 0) {
      continue;
    }
    if (allowedDays.has(current.getUTCDay())) {
      matched.push(formatUtcDay(current));
    }
  }

  return matched;
}

export async function validateRecurringBookingSlots(
  seatId: string,
  rrulePattern: string,
  dateRange: DateRangeInput,
  store: SeatOccupancyStore,
): Promise<RecurringValidationResult> {
  const requestedDates = expandRecurringDates(rrulePattern, dateRange);
  const occupiedMap = await store.getOccupiedDates(seatId, requestedDates);

  const availableDates: string[] = [];
  const conflictedDates: ConflictDetail[] = [];

  for (const date of requestedDates) {
    const conflict = occupiedMap.get(date);
    if (conflict) {
      conflictedDates.push({
        date,
        reason: conflict.reason,
        referenceId: conflict.referenceId,
      });
    } else {
      availableDates.push(date);
    }
  }

  const alternativeDesks: AlternativeDeskSuggestion[] = [];
  if (conflictedDates.length > 0 && store.listCandidateDesks) {
    const candidates = await store.listCandidateDesks(seatId, requestedDates);
    for (const candidate of candidates) {
      if (candidate.deskId === seatId) continue;
      // Only check conflicts against the dates where the requested seat was actually conflicted
      const freeDates = conflictedDates
        .map((c) => c.date)
        .filter((d) => !candidate.occupiedDates.has(d));
      const candidateConflicts = conflictedDates
        .map((c) => c.date)
        .filter((d) => candidate.occupiedDates.has(d));
      alternativeDesks.push({
        deskId: candidate.deskId,
        availableForAllRequestedDates: candidateConflicts.length === 0,
        freeDates,
        conflictedDates: candidateConflicts,
      });
    }

    alternativeDesks.sort((a, b) => {
      if (a.availableForAllRequestedDates !== b.availableForAllRequestedDates) {
        return a.availableForAllRequestedDates ? -1 : 1;
      }
      return b.freeDates.length - a.freeDates.length;
    });
  }

  return {
    seatId,
    rrulePattern,
    requestedDates,
    availableDates,
    conflictedDates,
    alternativeDesks,
  };
}

export { JS_DAY_TO_CODE };
