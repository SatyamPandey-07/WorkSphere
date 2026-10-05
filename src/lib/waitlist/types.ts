/**
 * Venue Seat Waitlist Types & Interfaces
 */

export type WaitlistStatus = "ACTIVE" | "NOTIFIED" | "CLAIMED" | "EXPIRED" | "CANCELLED";

export type SeatTypePreference = "HOT_DESK" | "FIXED_DESK" | "MEETING_ROOM" | "PHONE_BOOTH";

export interface JoinWaitlistInput {
  venueId: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  duration?: number; // minutes (default: 60)
  timeZone?: string;
  seatId?: string | null;
  seatType?: SeatTypePreference | null;
  requiresQuiet?: boolean;
  requiresOutlets?: boolean;
}

export interface WaitlistEntry {
  id: string;
  userId: string;
  venueId: string;
  venueName?: string;
  seatId?: string | null;
  seatNumber?: string | null;
  seatType?: SeatTypePreference | null;
  date: string;
  time: string;
  duration: number;
  timeZone: string;
  requiresQuiet: boolean;
  requiresOutlets: boolean;
  status: WaitlistStatus;
  queuePosition: number;
  totalInQueue: number;
  notifiedAt?: string | null;
  claimExpiresAt?: string | null;
  claimedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WaitlistQueueStats {
  venueId: string;
  date: string;
  time: string;
  totalActiveWaiters: number;
  estimatedWaitMinutes?: number;
}

export interface ClaimWaitlistSeatResult {
  success: boolean;
  waitlistId: string;
  bookingId?: string;
  confirmationId?: string;
  seatId?: string;
  seatNumber?: string;
  error?: string;
}
