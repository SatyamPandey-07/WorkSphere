/**
 * Tests for venue time slot pricing model and calculation.
 */

interface PricingTier {
  name: string;
  startHour: number;  // 0-23
  endHour: number;
  multiplier: number;
  daysOfWeek: number[]; // 0=Sun; empty=all days
}

const PRICING_TIERS: PricingTier[] = [
  { name: "peak_evening",  startHour: 18, endHour: 22, multiplier: 1.5, daysOfWeek: [] },
  { name: "weekend_day",   startHour: 9,  endHour: 18, multiplier: 1.3, daysOfWeek: [0, 6] },
  { name: "business_hours",startHour: 9,  endHour: 18, multiplier: 1.1, daysOfWeek: [1,2,3,4,5] },
  { name: "off_peak",      startHour: 0,  endHour: 9,  multiplier: 0.75,daysOfWeek: [] },
];

function applicableTier(hour: number, dayOfWeek: number): PricingTier | null {
  return PRICING_TIERS.find((tier) => {
    const inHours = hour >= tier.startHour && hour < tier.endHour;
    const inDays = tier.daysOfWeek.length === 0 || tier.daysOfWeek.includes(dayOfWeek);
    return inHours && inDays;
  }) ?? null;
}

function slotPrice(basePrice: number, hour: number, dayOfWeek: number): number {
  const tier = applicableTier(hour, dayOfWeek);
  const multiplier = tier?.multiplier ?? 1.0;
  return Math.round(basePrice * multiplier * 100) / 100;
}

function dailyPriceProfile(basePrice: number, dayOfWeek: number): { hour: number; price: number }[] {
  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    price: slotPrice(basePrice, h, dayOfWeek),
  }));
}

function avgDailyRate(basePrice: number, dayOfWeek: number): number {
  const profile = dailyPriceProfile(basePrice, dayOfWeek);
  return Math.round(profile.reduce((s, p) => s + p.price, 0) / profile.length * 100) / 100;
}

function peakHourRange(dayOfWeek: number): { startHour: number; endHour: number } | null {
  const tier = PRICING_TIERS.find(
    (t) => t.multiplier >= 1.4 && (t.daysOfWeek.length === 0 || t.daysOfWeek.includes(dayOfWeek))
  );
  return tier ? { startHour: tier.startHour, endHour: tier.endHour } : null;
}

describe("Slot pricing model", () => {
  it("slotPrice: Monday 10am business hours = 10% premium", () => {
    expect(slotPrice(100, 10, 1)).toBe(110);
  });

  it("slotPrice: Saturday 10am weekend day = 30% premium", () => {
    expect(slotPrice(100, 10, 6)).toBe(130);
  });

  it("slotPrice: any day 8pm peak evening = 50% premium", () => {
    expect(slotPrice(100, 19, 3)).toBe(150);
  });

  it("slotPrice: 3am off-peak = 25% discount", () => {
    expect(slotPrice(100, 3, 2)).toBe(75);
  });

  it("dailyPriceProfile: 24 hours", () => {
    expect(dailyPriceProfile(100, 1).length).toBe(24);
  });

  it("peakHourRange: Monday peak evening = 18-22", () => {
    const range = peakHourRange(1);
    expect(range?.startHour).toBe(18);
    expect(range?.endHour).toBe(22);
  });
});
