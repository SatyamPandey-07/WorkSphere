/**
 * Guest Invitation System - Public API
 *
 * Barrel export for the guest invitation module.
 * Import from '@/lib/guests' for convenience.
 */

export {
  inviteGuestsToBooking,
  sendGuestInvitation,
  cancelGuestInvitations,
  getBookingGuests,
} from "./guest-manager";
export {
  generateIcsContent,
  buildIcsEventData,
  generateIcsUid,
  createIcsBlob,
} from "./ics-generator";
export {
  getMapProvider,
  getVenueDirectionsLink,
  getVenuePhoto,
  registerMapProvider,
} from "./map-provider";
export { sendGuestInvite } from "./email-service";

export type {
  GuestInfo,
  BookingInfo,
  VenueInfo,
  HostInfo,
  IcsEventData,
  DirectionsLink,
  InviteResult,
  BookingGuestRecord,
} from "./types";

export type { MapProvider } from "./map-provider";
