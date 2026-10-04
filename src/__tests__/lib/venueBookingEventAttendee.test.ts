/**
 * Tests for venue booking event attendee management utilities.
 */

type AttendeeStatus = "registered" | "confirmed" | "checked_in" | "cancelled" | "no_show" | "waitlisted";

interface Attendee {
  id: string;
  bookingId: string;
  name: string;
  email: string;
  status: AttendeeStatus;
  registeredAt: number;
  checkedInAt: number | null;
  dietaryRequirements: string[];
  accessibilityNeeds: string[];
}

function checkedInCount(attendees: Attendee[]): number {
  return attendees.filter((a) => a.status === "checked_in").length;
}

function checkInRate(attendees: Attendee[]): number {
  const confirmed = attendees.filter((a) => a.status === "confirmed" || a.status === "checked_in").length;
  if (confirmed === 0) return 0;
  const checkedIn = checkedInCount(attendees);
  return Math.round((checkedIn / confirmed) * 100);
}

function noShowRate(attendees: Attendee[]): number {
  const expected = attendees.filter((a) => a.status !== "cancelled" && a.status !== "waitlisted").length;
  if (expected === 0) return 0;
  const noShows = attendees.filter((a) => a.status === "no_show").length;
  return Math.round((noShows / expected) * 100);
}

function withDietaryRequirements(attendees: Attendee[]): Attendee[] {
  return attendees.filter((a) => a.dietaryRequirements.length > 0);
}

function withAccessibilityNeeds(attendees: Attendee[]): Attendee[] {
  return attendees.filter((a) => a.accessibilityNeeds.length > 0);
}

function avgCheckInTimeMs(attendees: Attendee[]): number | null {
  const withTime = attendees.filter((a) => a.checkedInAt !== null);
  if (withTime.length === 0) return null;
  return Math.round(withTime.reduce((s, a) => s + (a.checkedInAt! - a.registeredAt), 0) / withTime.length);
}

const NOW = 1_700_000_000_000;
const ATTENDEES: Attendee[] = [
  { id: "a1", bookingId: "b1", name: "Alice", email: "a@x.com", status: "checked_in", registeredAt: NOW - 7 * 86_400_000, checkedInAt: NOW - 3600_000, dietaryRequirements: ["vegan"],   accessibilityNeeds: [] },
  { id: "a2", bookingId: "b1", name: "Bob",   email: "b@x.com", status: "confirmed",  registeredAt: NOW - 5 * 86_400_000, checkedInAt: null,           dietaryRequirements: [],          accessibilityNeeds: ["wheelchair"] },
  { id: "a3", bookingId: "b1", name: "Carol", email: "c@x.com", status: "no_show",    registeredAt: NOW - 4 * 86_400_000, checkedInAt: null,           dietaryRequirements: ["gluten_free"],accessibilityNeeds: [] },
  { id: "a4", bookingId: "b1", name: "Dave",  email: "d@x.com", status: "cancelled",  registeredAt: NOW - 3 * 86_400_000, checkedInAt: null,           dietaryRequirements: [],          accessibilityNeeds: [] },
];

describe("Event attendee management", () => {
  it("checkedInCount: 1 checked in", () => {
    expect(checkedInCount(ATTENDEES)).toBe(1);
  });

  it("checkInRate: 1 of 2 confirmed/checked_in = 50%", () => {
    expect(checkInRate(ATTENDEES)).toBe(50);
  });

  it("noShowRate: 1 of 3 non-cancelled = 33%", () => {
    expect(noShowRate(ATTENDEES)).toBe(33);
  });

  it("withDietaryRequirements: alice and carol", () => {
    expect(withDietaryRequirements(ATTENDEES).length).toBe(2);
  });

  it("withAccessibilityNeeds: bob needs wheelchair", () => {
    const needs = withAccessibilityNeeds(ATTENDEES);
    expect(needs.map((a) => a.name)).toContain("Bob");
  });

  it("avgCheckInTimeMs: only alice has check-in time", () => {
    const avg = avgCheckInTimeMs(ATTENDEES);
    expect(avg).not.toBeNull();
    expect(avg).toBeGreaterThan(0);
  });
});
