/**
 * Guest Invitation System - Type Definitions
 *
 * Defines the data structures used throughout the guest invitation module.
 */

/**
 * Basic information about a guest invited to a workspace booking.
 */
export interface GuestInfo {
  /** Guest email address (required for sending invites) */
  email: string;
  /** Optional guest name for personalization */
  name?: string;
  /** Optional phone number */
  phone?: string;
}

/**
 * Booking information needed to generate and send invites.
 */
export interface BookingInfo {
  id: string;
  confirmationId: string;
  venue: VenueInfo;
  host: HostInfo;
  date: string;
  time: string;
  durationMinutes: number;
}

/**
 * Venue details for calendar invites and map links.
 */
export interface VenueInfo {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  category: string;
  photoUrl?: string;
}

/**
 * Host details for personalization.
 */
export interface HostInfo {
  name: string;
  email: string;
}

/**
 * ICS calendar event data.
 */
export interface IcsEventData {
  title: string;
  description: string;
  location: string;
  locationAddress: string;
  startDate: string; // YYYYMMDDTHHmmSS format
  endDate: string; // YYYYMMDDTHHmmSS format
  organizerName: string;
  organizerEmail: string;
  attendeeEmail: string;
  attendeeName?: string;
  uid: string;
  venueLatitude: number;
  venueLongitude: number;
  venuePhotoUrl?: string;
}

/**
 * Directions link data.
 */
export interface DirectionsLink {
  provider: string;
  url: string;
  label: string;
}

/**
 * Result of sending a guest invitation.
 */
export interface InviteResult {
  email: string;
  success: boolean;
  error?: string;
  calendarUid?: string;
}

/**
 * Database record for a booking guest.
 * This matches the Prisma BookingGuest model.
 */
export interface BookingGuestRecord {
  id: string;
  bookingId: string;
  email: string;
  name?: string | null;
  phone?: string | null;
  status: "PENDING" | "SENT" | "FAILED" | "CANCELLED";
  calendarUid?: string | null;
  sentAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
