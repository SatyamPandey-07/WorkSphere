/**
 * Reservation and Booking Domain Types.
 */

export interface BookingSlot {
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:mm" (24-hour)
  timeZone?: string | null; // IANA timezone string
  duration?: number | null; // minutes
}

export type StoredBookingSlot = Omit<BookingSlot, "date"> & {
  id?: string;
  seatId?: string | null;
  venueId?: string | null;
  userId?: string | null;
  status?: string | null;
  date?: string;
};

export interface BookingInterval {
  start: number; // ms since epoch
  end: number; // ms since epoch
}

export interface AvailableSlot {
  date: string;
  time: string;
  endTime: string;
  timeZone: string;
  duration: number;
  available: boolean;
  availableSeatIds?: string[];
  totalSeats?: number;
  bookedSeatsCount?: number;
}

export interface CalculateSlotsParams {
  date: string; // "YYYY-MM-DD"
  timeZone: string;
  slotDurationMinutes?: number;
  openingTime?: string; // "09:00"
  closingTime?: string; // "18:00"
  isClosed?: boolean;
  totalSeats?: number;
  seatIds?: string[];
  existingBookings?: StoredBookingSlot[];
  minAdvanceMinutes?: number;
  now?: Date;
}

export interface BookingWindowPolicy {
  minNoticeMinutes?: number; // e.g. 0 or 15 mins
  maxAdvanceDays?: number; // e.g. 30, 60, or 90 days
  minDurationMinutes?: number; // e.g. 15 or 30 mins
  maxDurationMinutes?: number; // e.g. 480 mins (8 hours)
  allowedDurationIncrementsMinutes?: number; // e.g. 15, 30, or 60 mins
}

export interface ValidateWindowParams {
  date: string;
  time: string;
  duration?: number;
  timeZone?: string | null;
  policy?: BookingWindowPolicy;
  openingTime?: string;
  closingTime?: string;
  isClosed?: boolean;
  now?: Date;
}

export interface BookingWindowValidation {
  valid: boolean;
  bookingStart: Date | null;
  bookingEnd: Date | null;
  errors: string[];
}

export interface CheckConflictsParams<T extends StoredBookingSlot = StoredBookingSlot> {
  requestedSlot: BookingSlot;
  existingBookings: readonly T[];
  seatId?: string | null;
  excludeBookingId?: string | null;
}

export interface ConflictCheckResult<T extends StoredBookingSlot = StoredBookingSlot> {
  hasConflict: boolean;
  conflictingBookings: T[];
  requestedInterval: BookingInterval | null;
}

export const BOOKING_CANCELLATION_WINDOW_HOURS = 2;
export const BOOKING_CANCELLATION_WINDOW_MS =
  BOOKING_CANCELLATION_WINDOW_HOURS * 60 * 60 * 1000;

export const BOOKING_CANCELLATION_POLICY_MESSAGE =
  "Bookings can only be cancelled at least 2 hours before the scheduled start time.";

export type BookingCancellationEligibility =
  | {
      allowed: true;
      bookingStart: Date;
      millisecondsUntilStart: number;
    }
  | {
      allowed: false;
      bookingStart: Date | null;
      millisecondsUntilStart: number | null;
      reason:
        | "INVALID_START_TIME"
        | "BOOKING_ALREADY_STARTED"
        | "INSIDE_WINDOW";
      message: string;
    };

export interface CancellationEligibilityParams {
  date: string;
  time: string;
  timeZone?: string | null;
  now?: Date;
  cancellationWindowMs?: number;
  customPolicyMessage?: string;
}

export interface BookingEngineConfig {
  defaultDurationMinutes?: number;
  conflictDateRadiusDays?: number;
  cancellationWindowMs?: number;
  defaultTimeZone?: string;
  windowPolicy?: BookingWindowPolicy;
}
