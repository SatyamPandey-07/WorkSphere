/**
 * Tests for venue seat type to price mapping.
 */

type SeatType = "hot_desk" | "dedicated_desk" | "private_office" | "meeting_room" | "phone_booth";

interface SeatTypeInfo {
  label: string;
  icon: string;
  baseHourlyRateCents: number;
  minBookingHours: number;
  maxCapacity: number;
}

const SEAT_TYPE_INFO: Record<SeatType, SeatTypeInfo> = {
  hot_desk:        { label: "Hot Desk",        icon: "desk",    baseHourlyRateCents: 500,  minBookingHours: 1, maxCapacity: 1  },
  dedicated_desk:  { label: "Dedicated Desk",  icon: "desk-lock",baseHourlyRateCents: 800, minBookingHours: 4, maxCapacity: 1  },
  private_office:  { label: "Private Office",  icon: "office",  baseHourlyRateCents: 2000, minBookingHours: 2, maxCapacity: 10 },
  meeting_room:    { label: "Meeting Room",    icon: "users",   baseHourlyRateCents: 1500, minBookingHours: 1, maxCapacity: 12 },
  phone_booth:     { label: "Phone Booth",     icon: "phone",   baseHourlyRateCents: 300,  minBookingHours: 1, maxCapacity: 1  },
};

function getSeatTypeInfo(type: SeatType): SeatTypeInfo {
  return SEAT_TYPE_INFO[type];
}

function estimateCost(type: SeatType, hours: number): number {
  const info = getSeatTypeInfo(type);
  const actualHours = Math.max(hours, info.minBookingHours);
  return info.baseHourlyRateCents * actualHours;
}

function supportsGroup(type: SeatType, groupSize: number): boolean {
  return getSeatTypeInfo(type).maxCapacity >= groupSize;
}

function affordableTypes(budgetCents: number, hours: number): SeatType[] {
  return (Object.keys(SEAT_TYPE_INFO) as SeatType[])
    .filter((t) => estimateCost(t, hours) <= budgetCents);
}

describe("Venue seat type mapping", () => {
  it("getSeatTypeInfo: hot_desk base rate = 500 cents/hr", () => {
    expect(getSeatTypeInfo("hot_desk").baseHourlyRateCents).toBe(500);
  });

  it("estimateCost: phone_booth 2 hours = 600 cents", () => {
    expect(estimateCost("phone_booth", 2)).toBe(600);
  });

  it("estimateCost: respects minimum booking hours", () => {
    // dedicated_desk min 4 hours: 1hr booking → charges for 4
    expect(estimateCost("dedicated_desk", 1)).toBe(3200);
  });

  it("supportsGroup: meeting_room supports 10 people", () => {
    expect(supportsGroup("meeting_room", 10)).toBe(true);
  });

  it("supportsGroup: hot_desk does not support 2 people", () => {
    expect(supportsGroup("hot_desk", 2)).toBe(false);
  });

  it("affordableTypes: budget 1000 for 1hr → phone_booth and hot_desk", () => {
    const affordable = affordableTypes(1000, 1);
    expect(affordable).toContain("phone_booth");
    expect(affordable).toContain("hot_desk");
    expect(affordable).not.toContain("private_office");
  });

  it("affordableTypes: 0 budget → none", () => {
    expect(affordableTypes(0, 1)).toHaveLength(0);
  });
});
