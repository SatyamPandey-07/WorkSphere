/**
 * Tests for venue space configuration and layout management.
 */

type SpaceLayout = "open_plan" | "cubicles" | "private_offices" | "mixed";

interface SpaceConfig {
  venueId: string;
  layout: SpaceLayout;
  totalDesks: number;
  standinDesks: number;
  conferenceRooms: number;
  phoneBooths: number;
  kitchenSeats: number;
}

function totalCapacity(config: SpaceConfig): number {
  return config.totalDesks + config.kitchenSeats;
}

function privateSpaceRatio(config: SpaceConfig): number {
  if (config.totalDesks === 0) return 0;
  const private_desks = config.layout === "private_offices"
    ? config.totalDesks
    : config.conferenceRooms * 4; // rough estimate
  return Math.min(1, private_desks / config.totalDesks);
}

function isStandingDeskAvailable(config: SpaceConfig): boolean {
  return config.standinDesks > 0;
}

function suggestConfiguration(targetSeats: number): SpaceConfig {
  return {
    venueId: "new",
    layout: targetSeats > 50 ? "open_plan" : "mixed",
    totalDesks: targetSeats,
    standinDesks: Math.round(targetSeats * 0.2),
    conferenceRooms: Math.max(1, Math.floor(targetSeats / 20)),
    phoneBooths: Math.max(1, Math.floor(targetSeats / 10)),
    kitchenSeats: Math.max(6, Math.floor(targetSeats * 0.1)),
  };
}

const CONFIG: SpaceConfig = {
  venueId: "v1", layout: "mixed",
  totalDesks: 40, standinDesks: 8,
  conferenceRooms: 2, phoneBooths: 4, kitchenSeats: 10,
};

describe("Venue space configuration", () => {
  it("totalCapacity: desks + kitchen", () => {
    expect(totalCapacity(CONFIG)).toBe(50);
  });

  it("isStandingDeskAvailable: true when standinDesks > 0", () => {
    expect(isStandingDeskAvailable(CONFIG)).toBe(true);
  });

  it("isStandingDeskAvailable: false when none", () => {
    expect(isStandingDeskAvailable({ ...CONFIG, standinDesks: 0 })).toBe(false);
  });

  it("suggestConfiguration: layout open_plan for > 50 seats", () => {
    expect(suggestConfiguration(60).layout).toBe("open_plan");
  });

  it("suggestConfiguration: at least 1 conference room", () => {
    expect(suggestConfiguration(5).conferenceRooms).toBeGreaterThanOrEqual(1);
  });

  it("suggestConfiguration: 20% standing desks", () => {
    const config = suggestConfiguration(100);
    expect(config.standinDesks).toBe(20);
  });

  it("privateSpaceRatio: private_offices layout = 1.0", () => {
    const privateConfig = { ...CONFIG, layout: "private_offices" as SpaceLayout };
    expect(privateSpaceRatio(privateConfig)).toBe(1);
  });

  it("privateSpaceRatio: 0 desks → 0", () => {
    expect(privateSpaceRatio({ ...CONFIG, totalDesks: 0 })).toBe(0);
  });
});
