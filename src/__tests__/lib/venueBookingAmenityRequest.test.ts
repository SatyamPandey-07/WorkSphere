/**
 * Tests for venue amenity add-on request processing.
 */

type AmenityCategory = "catering" | "av_tech" | "decor" | "security" | "cleanup" | "transport";

interface AmenityAddOn {
  id: string;
  name: string;
  category: AmenityCategory;
  unitPrice: number;
  unit: "per_hour" | "per_head" | "flat" | "per_item";
  minQuantity: number;
  maxQuantity: number | null;
  leadTimeDays: number; // must book this many days in advance
}

interface AmenityRequest {
  addOnId: string;
  quantity: number;
  bookingDate: string; // YYYY-MM-DD
  requestDate: string;
}

const ADD_ONS: AmenityAddOn[] = [
  { id: "a1", name: "Catering Basic",   category: "catering",  unitPrice: 25,  unit: "per_head", minQuantity: 10, maxQuantity: 500, leadTimeDays: 3 },
  { id: "a2", name: "AV Tech Setup",    category: "av_tech",   unitPrice: 300, unit: "flat",     minQuantity: 1,  maxQuantity: 1,   leadTimeDays: 1 },
  { id: "a3", name: "Extra Security",   category: "security",  unitPrice: 50,  unit: "per_hour", minQuantity: 2,  maxQuantity: 12,  leadTimeDays: 2 },
];

function findAddOn(id: string): AmenityAddOn | null {
  return ADD_ONS.find((a) => a.id === id) ?? null;
}

function addOnCost(addOn: AmenityAddOn, quantity: number, durationHours?: number): number {
  switch (addOn.unit) {
    case "per_head":
    case "per_item":
      return Math.round(addOn.unitPrice * quantity * 100) / 100;
    case "per_hour":
      return Math.round(addOn.unitPrice * quantity * (durationHours ?? 1) * 100) / 100;
    case "flat":
      return addOn.unitPrice;
  }
}

function isLeadTimeMet(addOn: AmenityAddOn, req: AmenityRequest): boolean {
  const bookingDate = new Date(req.bookingDate).getTime();
  const requestDate = new Date(req.requestDate).getTime();
  const diffDays = (bookingDate - requestDate) / 86_400_000;
  return diffDays >= addOn.leadTimeDays;
}

function quantityValid(addOn: AmenityAddOn, quantity: number): boolean {
  if (quantity < addOn.minQuantity) return false;
  if (addOn.maxQuantity !== null && quantity > addOn.maxQuantity) return false;
  return true;
}

function validateRequest(addOn: AmenityAddOn, req: AmenityRequest): string[] {
  const errors: string[] = [];
  if (!quantityValid(addOn, req.quantity)) errors.push("Invalid quantity");
  if (!isLeadTimeMet(addOn, req)) errors.push("Insufficient lead time");
  return errors;
}

describe("Amenity add-on request processing", () => {
  it("addOnCost: catering 30 heads at $25 = $750", () => {
    expect(addOnCost(ADD_ONS[0], 30)).toBe(750);
  });

  it("addOnCost: security 4h × 3 staff at $50 = $600", () => {
    expect(addOnCost(ADD_ONS[2], 3, 4)).toBe(600);
  });

  it("addOnCost: AV tech flat = $300", () => {
    expect(addOnCost(ADD_ONS[1], 1)).toBe(300);
  });

  it("quantityValid: below min → false", () => {
    expect(quantityValid(ADD_ONS[0], 5)).toBe(false);
  });

  it("isLeadTimeMet: 5 days ahead for 3-day lead = valid", () => {
    const req: AmenityRequest = { addOnId: "a1", quantity: 20, bookingDate: "2026-10-10", requestDate: "2026-10-05" };
    expect(isLeadTimeMet(ADD_ONS[0], req)).toBe(true);
  });

  it("validateRequest: short lead time adds error", () => {
    const req: AmenityRequest = { addOnId: "a1", quantity: 20, bookingDate: "2026-10-06", requestDate: "2026-10-05" };
    const errors = validateRequest(ADD_ONS[0], req);
    expect(errors).toContain("Insufficient lead time");
  });
});
