/**
 * Tests for venue space type recommendation based on meeting purpose.
 */

type MeetingPurpose = "1on1" | "team_standup" | "client_meeting" | "workshop" | "all_hands" | "focus_work";
type SpaceType = "phone_booth" | "small_room" | "medium_room" | "large_room" | "open_desk" | "event_hall";

interface SpaceRequirement {
  purpose: MeetingPurpose;
  participants: number;
  durationHours: number;
  needsAV: boolean;
  needsWhiteboard: boolean;
}

function recommendSpaceType(req: SpaceRequirement): SpaceType {
  if (req.purpose === "focus_work" || req.participants === 1) return "open_desk";
  if (req.participants <= 2) return "phone_booth";
  if (req.participants <= 5) return "small_room";
  if (req.participants <= 15) return req.needsAV ? "medium_room" : "small_room";
  if (req.participants <= 50) return req.needsAV ? "large_room" : "medium_room";
  return "event_hall";
}

function spaceCapacityFor(type: SpaceType): { min: number; max: number } {
  const caps: Record<SpaceType, { min: number; max: number }> = {
    phone_booth: { min: 1, max: 2 },
    small_room:  { min: 2, max: 6 },
    medium_room: { min: 6, max: 20 },
    large_room:  { min: 20, max: 50 },
    open_desk:   { min: 1, max: 1 },
    event_hall:  { min: 50, max: 500 },
  };
  return caps[type];
}

function meetsSpaceNeeds(type: SpaceType, req: SpaceRequirement): boolean {
  const capacity = spaceCapacityFor(type);
  return req.participants >= capacity.min && req.participants <= capacity.max;
}

describe("Venue space type recommendation", () => {
  it("recommendSpaceType: 1 person focus → open_desk", () => {
    const req: SpaceRequirement = { purpose: "focus_work", participants: 1, durationHours: 4, needsAV: false, needsWhiteboard: false };
    expect(recommendSpaceType(req)).toBe("open_desk");
  });

  it("recommendSpaceType: 1on1 → phone_booth", () => {
    const req: SpaceRequirement = { purpose: "1on1", participants: 2, durationHours: 1, needsAV: false, needsWhiteboard: false };
    expect(recommendSpaceType(req)).toBe("phone_booth");
  });

  it("recommendSpaceType: team standup 8 with AV → medium_room", () => {
    const req: SpaceRequirement = { purpose: "team_standup", participants: 8, durationHours: 0.5, needsAV: true, needsWhiteboard: false };
    expect(recommendSpaceType(req)).toBe("medium_room");
  });

  it("recommendSpaceType: all hands 100 → event_hall", () => {
    const req: SpaceRequirement = { purpose: "all_hands", participants: 100, durationHours: 2, needsAV: true, needsWhiteboard: false };
    expect(recommendSpaceType(req)).toBe("event_hall");
  });

  it("spaceCapacityFor: small_room max is 6", () => {
    expect(spaceCapacityFor("small_room").max).toBe(6);
  });

  it("meetsSpaceNeeds: 4 people in small_room → true", () => {
    const req: SpaceRequirement = { purpose: "client_meeting", participants: 4, durationHours: 1, needsAV: false, needsWhiteboard: false };
    expect(meetsSpaceNeeds("small_room", req)).toBe(true);
  });

  it("meetsSpaceNeeds: 10 people in phone_booth → false", () => {
    const req: SpaceRequirement = { purpose: "team_standup", participants: 10, durationHours: 1, needsAV: false, needsWhiteboard: false };
    expect(meetsSpaceNeeds("phone_booth", req)).toBe(false);
  });
});
