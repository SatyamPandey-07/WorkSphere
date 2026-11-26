import {
  expandRecurringDates,
  type ConflictDetail,
  type DateRangeInput,
  type SeatOccupancyStore,
} from "@/features/seats/recurringBookingService";

export type OccurrenceStatus = "ACTIVE" | "SKIPPED" | "MODIFIED" | "CANCELLED";
export type SeriesStatus = "ACTIVE" | "CANCELLED";

export interface RecurringOccurrenceRecord {
  occurrenceId: string;
  seriesId: string;
  seatId: string;
  userId: string;
  originalDate: string;
  effectiveDate: string;
  status: OccurrenceStatus;
}

export interface RecurringSeriesRecord {
  seriesId: string;
  seatId: string;
  userId: string;
  rrulePattern: string;
  dateRange: DateRangeInput;
  timezone: string;
  status: SeriesStatus;
  createdAtMs: number;
  occurrences: RecurringOccurrenceRecord[];
}

function slotKey(seatId: string, date: string): string {
  return `${seatId}::${date}`;
}

/**
 * Atomic recurring reservation series manager & SeatOccupancyStore implementation.
 * Prevents overlapping active occurrences on the same seat/date and supports
 * single-occurrence exceptions (skip, modify, cancel) without corrupting the series.
 */
export class RecurringSeriesManager implements SeatOccupancyStore {
  private seriesMap = new Map<string, RecurringSeriesRecord>();
  private activeSlotIndex = new Map<string, RecurringOccurrenceRecord>();
  private registeredSeats = new Set<string>();
  private seq = 0;

  public registerSeat(seatId: string): void {
    this.registeredSeats.add(seatId);
  }

  public createSeries(input: {
    seatId: string;
    userId: string;
    rrulePattern: string;
    dateRange: DateRangeInput;
    timezone?: string;
    nowMs?: number;
  }): {
    created: boolean;
    series?: RecurringSeriesRecord;
    conflicts?: ConflictDetail[];
  } {
    const requestedDates = expandRecurringDates(
      input.rrulePattern,
      input.dateRange,
    );
    if (requestedDates.length === 0) {
      return { created: false, conflicts: [] };
    }

    // Atomic conflict check across all requested dates
    const conflicts: ConflictDetail[] = [];
    for (const date of requestedDates) {
      const existing = this.activeSlotIndex.get(slotKey(input.seatId, date));
      if (existing) {
        conflicts.push({
          date,
          reason: "BOOKED",
          referenceId: existing.occurrenceId,
        });
      }
    }

    if (conflicts.length > 0) {
      return { created: false, conflicts };
    }

    const nowMs = input.nowMs ?? Date.now();
    const seriesId = `rseries_${nowMs}_${++this.seq}`;
    this.registeredSeats.add(input.seatId);

    const occurrences: RecurringOccurrenceRecord[] = requestedDates.map(
      (date, idx) => ({
        occurrenceId: `${seriesId}_occ_${idx + 1}`,
        seriesId,
        seatId: input.seatId,
        userId: input.userId,
        originalDate: date,
        effectiveDate: date,
        status: "ACTIVE",
      }),
    );

    for (const occ of occurrences) {
      this.activeSlotIndex.set(slotKey(occ.seatId, occ.effectiveDate), occ);
    }

    const series: RecurringSeriesRecord = {
      seriesId,
      seatId: input.seatId,
      userId: input.userId,
      rrulePattern: input.rrulePattern,
      dateRange: { ...input.dateRange },
      timezone: input.timezone ?? "UTC",
      status: "ACTIVE",
      createdAtMs: nowMs,
      occurrences,
    };

    this.seriesMap.set(seriesId, series);
    return { created: true, series };
  }

  public cancelOccurrence(seriesId: string, originalDate: string): boolean {
    return this.deactivateOccurrence(seriesId, originalDate, "CANCELLED");
  }

  public skipOccurrence(seriesId: string, originalDate: string): boolean {
    return this.deactivateOccurrence(seriesId, originalDate, "SKIPPED");
  }

  private deactivateOccurrence(
    seriesId: string,
    originalDate: string,
    targetStatus: "CANCELLED" | "SKIPPED",
  ): boolean {
    const series = this.seriesMap.get(seriesId);
    if (!series) return false;
    const occ = series.occurrences.find((o) => o.originalDate === originalDate);
    if (!occ || occ.status === "CANCELLED" || occ.status === "SKIPPED") {
      return false;
    }

    this.activeSlotIndex.delete(slotKey(occ.seatId, occ.effectiveDate));
    occ.status = targetStatus;
    return true;
  }

  public modifyOccurrence(
    seriesId: string,
    originalDate: string,
    updates: { newDate?: string; newSeatId?: string },
  ): { updated: boolean; error?: string } {
    const series = this.seriesMap.get(seriesId);
    if (!series) return { updated: false, error: "Series not found" };

    const occ = series.occurrences.find((o) => o.originalDate === originalDate);
    if (!occ || (occ.status !== "ACTIVE" && occ.status !== "MODIFIED")) {
      return { updated: false, error: "Occurrence is not active" };
    }

    const nextDate = updates.newDate ?? occ.effectiveDate;
    const nextSeat = updates.newSeatId ?? occ.seatId;
    const targetKey = slotKey(nextSeat, nextDate);
    const occupant = this.activeSlotIndex.get(targetKey);

    if (occupant && occupant.occurrenceId !== occ.occurrenceId) {
      return {
        updated: false,
        error: `Target slot ${nextSeat} on ${nextDate} is already booked`,
      };
    }

    this.activeSlotIndex.delete(slotKey(occ.seatId, occ.effectiveDate));
    occ.seatId = nextSeat;
    occ.effectiveDate = nextDate;
    occ.status = "MODIFIED";
    this.registeredSeats.add(nextSeat);
    this.activeSlotIndex.set(targetKey, occ);

    return { updated: true };
  }

  public cancelSeries(seriesId: string): boolean {
    const series = this.seriesMap.get(seriesId);
    if (!series) return false;
    series.status = "CANCELLED";
    for (const occ of series.occurrences) {
      if (occ.status === "ACTIVE" || occ.status === "MODIFIED") {
        this.activeSlotIndex.delete(slotKey(occ.seatId, occ.effectiveDate));
        occ.status = "CANCELLED";
      }
    }
    return true;
  }

  public async getOccupiedDates(
    seatId: string,
    dates: string[],
  ): Promise<Map<string, ConflictDetail>> {
    const result = new Map<string, ConflictDetail>();
    for (const date of dates) {
      const occ = this.activeSlotIndex.get(slotKey(seatId, date));
      if (occ) {
        result.set(date, {
          date,
          reason: "BOOKED",
          referenceId: occ.occurrenceId,
        });
      }
    }
    return result;
  }

  public async listCandidateDesks(
    seatId: string,
    dates: string[],
  ): Promise<Array<{ deskId: string; occupiedDates: Set<string> }>> {
    const candidates: Array<{ deskId: string; occupiedDates: Set<string> }> = [];
    for (const candidateSeatId of this.registeredSeats) {
      if (candidateSeatId === seatId) continue;
      const occupied = new Set<string>();
      for (const d of dates) {
        if (this.activeSlotIndex.has(slotKey(candidateSeatId, d))) {
          occupied.add(d);
        }
      }
      candidates.push({ deskId: candidateSeatId, occupiedDates: occupied });
    }
    return candidates;
  }

  public getSeries(seriesId: string): RecurringSeriesRecord | undefined {
    const s = this.seriesMap.get(seriesId);
    return s ? structuredClone(s) : undefined;
  }
}

export const defaultRecurringSeriesManager = new RecurringSeriesManager();
