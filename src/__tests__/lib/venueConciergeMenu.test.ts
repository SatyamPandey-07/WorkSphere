/**
 * Tests for venue concierge service menu management.
 */

type ServiceCategory = "food" | "printing" | "transport" | "av_tech" | "wellness" | "admin";

interface ConciergeService {
  serviceId: string;
  name: string;
  category: ServiceCategory;
  priceCents: number;
  estimatedMinutes: number;
  isAvailable: boolean;
  requiresAdvanceBooking: boolean;
  advanceHours?: number;
}

function availableServices(
  services: ConciergeService[],
  category?: ServiceCategory
): ConciergeService[] {
  return services.filter(
    (s) => s.isAvailable && (category === undefined || s.category === category)
  );
}

function canOrderNow(service: ConciergeService, hoursNotice: number): boolean {
  if (!service.isAvailable) return false;
  if (!service.requiresAdvanceBooking) return true;
  return hoursNotice >= (service.advanceHours ?? 1);
}

function cheapestInCategory(services: ConciergeService[], category: ServiceCategory): ConciergeService | null {
  const available = availableServices(services, category);
  if (available.length === 0) return null;
  return available.reduce((min, s) => s.priceCents < min.priceCents ? s : min);
}

function estimatedServiceTime(serviceIds: string[], services: ConciergeService[]): number {
  return serviceIds.reduce((sum, id) => {
    const s = services.find((sv) => sv.serviceId === id);
    return sum + (s ? s.estimatedMinutes : 0);
  }, 0);
}

const SERVICES: ConciergeService[] = [
  { serviceId: "sv1", name: "Coffee",       category: "food",     priceCents: 400,  estimatedMinutes: 5,  isAvailable: true,  requiresAdvanceBooking: false },
  { serviceId: "sv2", name: "Lunch Box",    category: "food",     priceCents: 1200, estimatedMinutes: 30, isAvailable: true,  requiresAdvanceBooking: true, advanceHours: 2 },
  { serviceId: "sv3", name: "Print 10p",    category: "printing", priceCents: 150,  estimatedMinutes: 5,  isAvailable: true,  requiresAdvanceBooking: false },
  { serviceId: "sv4", name: "IT Support",   category: "av_tech",  priceCents: 0,    estimatedMinutes: 15, isAvailable: false, requiresAdvanceBooking: false },
];

describe("Venue concierge service menu", () => {
  it("availableServices: 3 available (sv4 is not)", () => {
    expect(availableServices(SERVICES)).toHaveLength(3);
  });

  it("availableServices: food category = 2", () => {
    expect(availableServices(SERVICES, "food")).toHaveLength(2);
  });

  it("canOrderNow: coffee (no advance) → true", () => {
    expect(canOrderNow(SERVICES[0], 0)).toBe(true);
  });

  it("canOrderNow: lunch box with 3h notice → true (need 2h)", () => {
    expect(canOrderNow(SERVICES[1], 3)).toBe(true);
  });

  it("canOrderNow: lunch box with 1h notice → false", () => {
    expect(canOrderNow(SERVICES[1], 1)).toBe(false);
  });

  it("canOrderNow: unavailable service → false", () => {
    expect(canOrderNow(SERVICES[3], 24)).toBe(false);
  });

  it("cheapestInCategory: food = coffee (400)", () => {
    expect(cheapestInCategory(SERVICES, "food")!.serviceId).toBe("sv1");
  });

  it("cheapestInCategory: wellness = null (none available)", () => {
    expect(cheapestInCategory(SERVICES, "wellness")).toBeNull();
  });

  it("estimatedServiceTime: sv1 + sv3 = 10 min", () => {
    expect(estimatedServiceTime(["sv1", "sv3"], SERVICES)).toBe(10);
  });
});
