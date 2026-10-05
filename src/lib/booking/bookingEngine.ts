/**
 * Core Booking Engine & Reservation Availability Manager.
 *
 * Encapsulates domain logic for:
 * 1. Available slot calculation with operating hours, capacities, and seat-level tracking.
 * 2. Booking window validation (advance notice, max advance window, operating hours, durations).
 * 3. Cross-timezone conflict detection with DST-aware interval overlap checks.
 * 4. Cancellation policy evaluation.
 */

import {
  AvailableSlot,
  BookingCancellationEligibility,
  BookingEngineConfig,
  BookingInterval,
  BookingSlot,
  BookingWindowValidation,
  BOOKING_CANCELLATION_POLICY_MESSAGE,
  BOOKING_CANCELLATION_WINDOW_MS,
  CalculateSlotsParams,
  CancellationEligibilityParams,
  CheckConflictsParams,
  ConflictCheckResult,
  StoredBookingSlot,
  ValidateWindowParams,
} from "./types";
import {
  BookingDateTimeAdapter,
  DateTimeAdapter,
  defaultDateTimeAdapter,
} from "./dateTimeAdapter";

export class BookingEngine {
  private dateTimeAdapter: DateTimeAdapter;
  private config: BookingEngineConfig;

  constructor(
    config: BookingEngineConfig = {},
    dateTimeAdapter: DateTimeAdapter = defaultDateTimeAdapter,
  ) {
    this.config = {
      defaultDurationMinutes: 60,
      conflictDateRadiusDays: 3,
      cancellationWindowMs: BOOKING_CANCELLATION_WINDOW_MS,
      defaultTimeZone: "UTC",
      ...config,
      windowPolicy: {
        minNoticeMinutes: 0,
        maxAdvanceDays: 90,
        minDurationMinutes: 15,
        maxDurationMinutes: 480,
        allowedDurationIncrementsMinutes: 15,
        ...config.windowPolicy,
      },
    };
    this.dateTimeAdapter = dateTimeAdapter;
  }

  /**
   * Calculates all available time slots and seat availability on a requested date.
   */
  public calculateAvailableSlots(params: CalculateSlotsParams): AvailableSlot[] {
    const {
      date,
      timeZone = this.config.defaultTimeZone || "UTC",
      slotDurationMinutes = this.config.defaultDurationMinutes || 60,
      openingTime = "08:00",
      closingTime = "20:00",
      isClosed = false,
      seatIds = [],
      existingBookings = [],
      minAdvanceMinutes = 0,
      now = new Date(),
    } = params;

    if (isClosed || !this.dateTimeAdapter.isValidBookingDate(date)) {
      return [];
    }

    const normOpen = this.dateTimeAdapter.normalizeBookingTime(openingTime);
    const normClose = this.dateTimeAdapter.normalizeBookingTime(closingTime);
    if (!normOpen || !normClose) {
      return [];
    }

    const [openH, openM] = normOpen.split(":").map(Number);
    const [closeH, closeM] = normClose.split(":").map(Number);
    const openMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;

    if (closeMinutes <= openMinutes) {
      return [];
    }

    const slots: AvailableSlot[] = [];
    const minAdvanceMs = minAdvanceMinutes * 60_000;
    const earliestAllowedTime = now.getTime() + minAdvanceMs;

    for (
      let currentMin = openMinutes;
      currentMin + slotDurationMinutes <= closeMinutes;
      currentMin += slotDurationMinutes
    ) {
      const startH = Math.floor(currentMin / 60);
      const startM = currentMin % 60;
      const endTotalMin = currentMin + slotDurationMinutes;
      const endH = Math.floor(endTotalMin / 60);
      const endM = endTotalMin % 60;

      const timeStr = `${String(startH).padStart(2, "0")}:${String(startM).padStart(2, "0")}`;
      const endTimeStr = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;

      const slotStart = this.dateTimeAdapter.parseBookingDateTime(
        date,
        timeStr,
        timeZone,
      );

      if (!slotStart) continue;

      const slotInterval: BookingInterval = {
        start: slotStart.getTime(),
        end: slotStart.getTime() + slotDurationMinutes * 60_000,
      };

      // Past check
      if (slotInterval.start < earliestAllowedTime) {
        slots.push({
          date,
          time: timeStr,
          endTime: endTimeStr,
          timeZone,
          duration: slotDurationMinutes,
          available: false,
          availableSeatIds: [],
          totalSeats: seatIds.length || params.totalSeats || 0,
          bookedSeatsCount: seatIds.length || params.totalSeats || 0,
        });
        continue;
      }

      // Identify conflicting bookings in this slot interval
      const conflictingBookings = existingBookings.filter((b) => {
        const rowInterval = this.dateTimeAdapter.bookingInterval(
          { ...b, date: b.date ?? date },
          timeZone,
          slotDurationMinutes,
        );
        return (
          rowInterval !== null &&
          this.dateTimeAdapter.intervalsOverlap(rowInterval, slotInterval)
        );
      });

      const bookedSeatIds = new Set<string>();
      for (const b of conflictingBookings) {
        if (b.seatId) {
          bookedSeatIds.add(b.seatId);
        }
      }

      const availableSeatIds =
        seatIds.length > 0
          ? seatIds.filter((sId) => !bookedSeatIds.has(sId))
          : [];

      const totalSeats =
        seatIds.length > 0
          ? seatIds.length
          : params.totalSeats !== undefined
            ? params.totalSeats
            : 1;

      const isAvailable =
        seatIds.length > 0
          ? availableSeatIds.length > 0
          : conflictingBookings.length < totalSeats;

      slots.push({
        date,
        time: timeStr,
        endTime: endTimeStr,
        timeZone,
        duration: slotDurationMinutes,
        available: isAvailable,
        availableSeatIds,
        totalSeats,
        bookedSeatsCount: bookedSeatIds.size || conflictingBookings.length,
      });
    }

    return slots;
  }

  /**
   * Validates a requested booking window against notice constraints, operating hours, and policies.
   */
  public validateBookingWindow(params: ValidateWindowParams): BookingWindowValidation {
    const {
      date,
      time,
      duration = this.config.defaultDurationMinutes || 60,
      timeZone = this.config.defaultTimeZone || "UTC",
      policy = this.config.windowPolicy || {},
      openingTime,
      closingTime,
      isClosed = false,
      now = new Date(),
    } = params;

    const errors: string[] = [];

    if (!this.dateTimeAdapter.isValidBookingDate(date)) {
      errors.push("Invalid booking date format. Expected YYYY-MM-DD.");
    }

    const normTime = this.dateTimeAdapter.normalizeBookingTime(time);
    if (!normTime) {
      errors.push("Invalid booking time format. Expected HH:mm.");
    }

    if (isClosed) {
      errors.push("The venue is closed on the selected date.");
    }

    const zone = this.dateTimeAdapter.isValidTimeZone(timeZone)
      ? timeZone
      : "UTC";

    // Duration limits
    const minDur = policy.minDurationMinutes ?? 15;
    const maxDur = policy.maxDurationMinutes ?? 480;
    if (duration < minDur || duration > maxDur) {
      errors.push(
        `Booking duration must be between ${minDur} and ${maxDur} minutes.`,
      );
    }

    const increment = policy.allowedDurationIncrementsMinutes ?? 15;
    if (duration % increment !== 0) {
      errors.push(
        `Booking duration must be in increments of ${increment} minutes.`,
      );
    }

    let bookingStart: Date | null = null;
    let bookingEnd: Date | null = null;

    if (errors.length === 0 && normTime) {
      bookingStart = this.dateTimeAdapter.parseBookingDateTime(
        date,
        normTime,
        zone,
      );

      if (!bookingStart) {
        errors.push("Could not resolve booking start time instant.");
      } else {
        bookingEnd = new Date(bookingStart.getTime() + duration * 60_000);

        // Advance notice check
        const minNoticeMs = (policy.minNoticeMinutes ?? 0) * 60_000;
        if (bookingStart.getTime() < now.getTime() + minNoticeMs) {
          errors.push(
            "Booking start time must satisfy the minimum advance notice requirement.",
          );
        }

        // Max advance window check
        const maxAdvanceMs =
          (policy.maxAdvanceDays ?? 90) * 24 * 60 * 60 * 1000;
        if (bookingStart.getTime() > now.getTime() + maxAdvanceMs) {
          errors.push(
            `Bookings can only be scheduled up to ${policy.maxAdvanceDays ?? 90} days in advance.`,
          );
        }

        // Operating hours check
        if (openingTime && closingTime) {
          const normOpen =
            this.dateTimeAdapter.normalizeBookingTime(openingTime);
          const normClose =
            this.dateTimeAdapter.normalizeBookingTime(closingTime);

          if (normOpen && normClose) {
            const [openH, openM] = normOpen.split(":").map(Number);
            const [closeH, closeM] = normClose.split(":").map(Number);
            const [reqH, reqM] = normTime.split(":").map(Number);

            const openMinutes = openH * 60 + openM;
            const closeMinutes = closeH * 60 + closeM;
            const reqStartMinutes = reqH * 60 + reqM;
            const reqEndMinutes = reqStartMinutes + duration;

            if (
              reqStartMinutes < openMinutes ||
              reqEndMinutes > closeMinutes
            ) {
              errors.push(
                `Booking must fall within venue operating hours (${normOpen} - ${normClose}).`,
              );
            }
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      bookingStart,
      bookingEnd,
      errors,
    };
  }

  /**
   * Checks for overlapping reservations across seat IDs and time ranges.
   */
  public checkConflicts<T extends StoredBookingSlot = StoredBookingSlot>(
    params: CheckConflictsParams<T>,
  ): ConflictCheckResult<T> {
    const {
      requestedSlot,
      existingBookings,
      seatId = requestedSlot.seatId,
      excludeBookingId,
    } = params;

    const requestedInterval = this.dateTimeAdapter.bookingInterval(
      requestedSlot,
      requestedSlot.timeZone || this.config.defaultTimeZone,
      this.config.defaultDurationMinutes,
    );

    if (!requestedInterval) {
      throw new Error(
        "findConflictingBookings: requested slot has an invalid date or time",
      );
    }

    const fallbackZone =
      requestedSlot.timeZone || this.config.defaultTimeZone || "UTC";

    const conflictingBookings = existingBookings.filter((row) => {
      if (excludeBookingId && row.id === excludeBookingId) {
        return false;
      }

      // If seatId is specified for conflict checking, match seatId
      if (seatId && row.seatId && row.seatId !== seatId) {
        return false;
      }

      const rowInterval = this.dateTimeAdapter.bookingInterval(
        { ...row, date: row.date ?? requestedSlot.date },
        fallbackZone,
        this.config.defaultDurationMinutes,
      );

      return (
        rowInterval !== null &&
        this.dateTimeAdapter.intervalsOverlap(rowInterval, requestedInterval)
      );
    });

    return {
      hasConflict: conflictingBookings.length > 0,
      conflictingBookings,
      requestedInterval,
    };
  }

  /**
   * Evaluates if a booking can be cancelled based on its start time and policy window.
   */
  public evaluateCancellationEligibility(
    params: CancellationEligibilityParams,
  ): BookingCancellationEligibility {
    const {
      date,
      time,
      timeZone,
      now = new Date(),
      cancellationWindowMs = this.config.cancellationWindowMs ||
        BOOKING_CANCELLATION_WINDOW_MS,
      customPolicyMessage = BOOKING_CANCELLATION_POLICY_MESSAGE,
    } = params;

    const bookingStart = this.dateTimeAdapter.parseBookingDateTime(
      date,
      time,
      timeZone || this.config.defaultTimeZone || "UTC",
    );

    if (!bookingStart) {
      return {
        allowed: false,
        bookingStart: null,
        millisecondsUntilStart: null,
        reason: "INVALID_START_TIME",
        message:
          "The booking start date or time is invalid. Please contact support.",
      };
    }

    const millisecondsUntilStart = bookingStart.getTime() - now.getTime();

    if (millisecondsUntilStart <= 0) {
      return {
        allowed: false,
        bookingStart,
        millisecondsUntilStart,
        reason: "BOOKING_ALREADY_STARTED",
        message:
          "This booking has already started and can no longer be cancelled.",
      };
    }

    if (millisecondsUntilStart < cancellationWindowMs) {
      return {
        allowed: false,
        bookingStart,
        millisecondsUntilStart,
        reason: "INSIDE_WINDOW",
        message: customPolicyMessage,
      };
    }

    return {
      allowed: true,
      bookingStart,
      millisecondsUntilStart,
    };
  }

  /**
   * Returns date window for querying potentially conflicting rows.
   */
  public getConflictDateWindow(
    date: string,
    radiusDays = this.config.conflictDateRadiusDays || 3,
  ): string[] {
    return this.dateTimeAdapter.conflictDateWindow(date, radiusDays);
  }
}

export const globalBookingEngine = new BookingEngine();
