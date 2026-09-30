/**
 * Tests for group booking participant permission management.
 */

type ParticipantRole = "organizer" | "attendee" | "viewer";

interface BookingParticipant {
  userId: string;
  role: ParticipantRole;
  invitedBy: string;
  rsvpStatus: "pending" | "accepted" | "declined";
}

function canModifyBooking(participant: BookingParticipant): boolean {
  return participant.role === "organizer";
}

function canViewDetails(participant: BookingParticipant): boolean {
  return participant.role !== "viewer" ||
         participant.rsvpStatus === "accepted";
}

function acceptInvite(participant: BookingParticipant): BookingParticipant {
  if (participant.rsvpStatus !== "pending") throw new Error("RSVP already finalized");
  return { ...participant, rsvpStatus: "accepted" };
}

function declineInvite(participant: BookingParticipant): BookingParticipant {
  if (participant.rsvpStatus !== "pending") throw new Error("RSVP already finalized");
  return { ...participant, rsvpStatus: "declined" };
}

function confirmedAttendees(participants: BookingParticipant[]): BookingParticipant[] {
  return participants.filter(
    (p) => p.rsvpStatus === "accepted" && p.role !== "viewer"
  );
}

const ORGANIZER: BookingParticipant = { userId: "u1", role: "organizer",  invitedBy: "u1", rsvpStatus: "accepted" };
const ATTENDEE:  BookingParticipant = { userId: "u2", role: "attendee",   invitedBy: "u1", rsvpStatus: "pending"  };
const VIEWER:    BookingParticipant = { userId: "u3", role: "viewer",     invitedBy: "u1", rsvpStatus: "pending"  };

describe("Group booking participant permissions", () => {
  it("organizer can modify booking", () => {
    expect(canModifyBooking(ORGANIZER)).toBe(true);
  });

  it("attendee cannot modify booking", () => {
    expect(canModifyBooking(ATTENDEE)).toBe(false);
  });

  it("attendee can view details", () => {
    expect(canViewDetails(ATTENDEE)).toBe(true);
  });

  it("viewer with pending RSVP cannot view details", () => {
    expect(canViewDetails(VIEWER)).toBe(false);
  });

  it("viewer with accepted RSVP can view details", () => {
    expect(canViewDetails({ ...VIEWER, rsvpStatus: "accepted" })).toBe(true);
  });

  it("acceptInvite: pending → accepted", () => {
    const accepted = acceptInvite(ATTENDEE);
    expect(accepted.rsvpStatus).toBe("accepted");
  });

  it("acceptInvite throws if already finalized", () => {
    expect(() => acceptInvite(ORGANIZER)).toThrow("RSVP already finalized");
  });

  it("declineInvite: pending → declined", () => {
    expect(declineInvite(ATTENDEE).rsvpStatus).toBe("declined");
  });

  it("confirmedAttendees: organizer + accepted attendee", () => {
    const participants = [ORGANIZER, { ...ATTENDEE, rsvpStatus: "accepted" as const }, VIEWER];
    const confirmed = confirmedAttendees(participants);
    expect(confirmed).toHaveLength(2);
    expect(confirmed.every((p) => p.rsvpStatus === "accepted" && p.role !== "viewer")).toBe(true);
  });
});
