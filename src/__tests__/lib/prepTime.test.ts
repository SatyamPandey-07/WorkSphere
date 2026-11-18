import {
  estimatePrepMinutes,
  minutesRemaining,
  formatReadyIn,
} from "@/lib/cafe/prepTime";
import { SAMPLE_CAFE_MENU, SmartCafeEngine } from "@/lib/cafe/smartCafeEngine";

describe("estimatePrepMinutes", () => {
  it("adds 2 minutes per queued order to the base prep time", () => {
    expect(estimatePrepMinutes(3, 0)).toBe(3);
    expect(estimatePrepMinutes(3, 2)).toBe(7);
    expect(estimatePrepMinutes(0, 3)).toBe(6);
    expect(estimatePrepMinutes(2.5, 1)).toBe(4.5);
  });

  it("treats negative and invalid inputs as 0", () => {
    expect(estimatePrepMinutes(-5, -2)).toBe(0);
    expect(estimatePrepMinutes(NaN, 2)).toBe(4);
    expect(estimatePrepMinutes(3, NaN)).toBe(3);
    expect(estimatePrepMinutes(Infinity, Infinity)).toBe(0);
  });

  it("ignores fractional queue positions", () => {
    expect(estimatePrepMinutes(3, 2.9)).toBe(7);
  });
});

describe("minutesRemaining", () => {
  const now = 1_000_000;

  it("returns whole minutes for exact minute boundaries", () => {
    expect(minutesRemaining(now + 120_000, now)).toBe(2);
  });

  it("rounds partial minutes up", () => {
    expect(minutesRemaining(now + 90_000, now)).toBe(2);
    expect(minutesRemaining(now + 1, now)).toBe(1);
  });

  it("is 0 once the time has passed or arrived", () => {
    expect(minutesRemaining(now, now)).toBe(0);
    expect(minutesRemaining(now - 5_000, now)).toBe(0);
  });

  it("is 0 for invalid input", () => {
    expect(minutesRemaining(NaN, now)).toBe(0);
    expect(minutesRemaining(now, Infinity)).toBe(0);
  });
});

describe("formatReadyIn", () => {
  it("formats plural minutes", () => {
    expect(formatReadyIn(4)).toBe("Ready in ~4 mins");
    expect(formatReadyIn(12)).toBe("Ready in ~12 mins");
  });

  it("uses the singular for one minute", () => {
    expect(formatReadyIn(1)).toBe("Ready in ~1 min");
  });

  it("shows 'Ready any moment' at zero or for invalid values", () => {
    expect(formatReadyIn(0)).toBe("Ready any moment");
    expect(formatReadyIn(-1)).toBe("Ready any moment");
    expect(formatReadyIn(NaN)).toBe("Ready any moment");
  });
});

describe("SmartCafeEngine prep estimate", () => {
  const item = SAMPLE_CAFE_MENU[0];
  const order = [{ menuItemId: item.id, quantity: 1, customizations: [] }];
  const orderOwnPrep = item.prepTimeMinutes + item.prepTimeMinutes * 0.4;

  it("uses the order's own prep time plus 2 minutes per queued order", () => {
    for (const queue of [0, 1, 3, 6]) {
      const { estimatedPrepMinutes } = SmartCafeEngine.calculateOrderDetails(
        order,
        SAMPLE_CAFE_MENU,
        queue,
      );
      expect(estimatedPrepMinutes).toBe(
        Math.max(3, Math.round(orderOwnPrep + queue * 2)),
      );
    }
  });

  it("adds exactly 10 minutes for 5 more queued orders", () => {
    const short = SmartCafeEngine.calculateOrderDetails(
      order,
      SAMPLE_CAFE_MENU,
      2,
    ).estimatedPrepMinutes;
    const long = SmartCafeEngine.calculateOrderDetails(
      order,
      SAMPLE_CAFE_MENU,
      7,
    ).estimatedPrepMinutes;
    expect(long - short).toBe(10);
  });
});
