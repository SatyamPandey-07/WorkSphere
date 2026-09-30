/**
 * Tests for venue supply ordering and vendor management.
 */

interface Vendor {
  vendorId: string;
  name: string;
  category: string;
  reliabilityScore: number; // 0-10
  avgDeliveryDays: number;
  minOrderCents: number;
  discountPct: number; // bulk discount
}

interface SupplyOrder {
  orderId: string;
  venueId: string;
  vendorId: string;
  itemDescription: string;
  quantityUnits: number;
  unitCostCents: number;
  orderedAt: number;
  expectedDeliveryAt: number;
  receivedAt: number | null;
}

function orderTotal(order: SupplyOrder): number {
  return order.quantityUnits * order.unitCostCents;
}

function applyVendorDiscount(order: SupplyOrder, vendor: Vendor): number {
  const total = orderTotal(order);
  if (total < vendor.minOrderCents) return total; // no discount below minimum
  return Math.round(total * (1 - vendor.discountPct / 100));
}

function isOrderLate(order: SupplyOrder, nowMs: number): boolean {
  if (order.receivedAt !== null) return false;
  return nowMs > order.expectedDeliveryAt;
}

function orderLeadTimeMs(order: SupplyOrder): number | null {
  if (!order.receivedAt) return null;
  return order.receivedAt - order.orderedAt;
}

function bestVendorForCategory(vendors: Vendor[], category: string): Vendor | null {
  const catVendors = vendors.filter((v) => v.category === category);
  if (catVendors.length === 0) return null;
  return catVendors.reduce((best, v) => {
    const score = v.reliabilityScore * 2 - v.avgDeliveryDays;
    const bestScore = best.reliabilityScore * 2 - best.avgDeliveryDays;
    return score > bestScore ? v : best;
  });
}

const NOW = 1_700_000_000_000;
const VENDOR: Vendor = { vendorId: "v1", name: "OfficeSupply Co", category: "stationery", reliabilityScore: 8, avgDeliveryDays: 2, minOrderCents: 5000, discountPct: 10 };
const ORDER: SupplyOrder = { orderId: "o1", venueId: "ve1", vendorId: "v1", itemDescription: "A4 Paper", quantityUnits: 10, unitCostCents: 800, orderedAt: NOW - 5 * 86_400_000, expectedDeliveryAt: NOW - 2 * 86_400_000, receivedAt: NOW - 1 * 86_400_000 };

describe("Venue supply chain management", () => {
  it("orderTotal: 10 × 800 = 8000", () => {
    expect(orderTotal(ORDER)).toBe(8000);
  });

  it("applyVendorDiscount: 8000 above min → 10% off = 7200", () => {
    expect(applyVendorDiscount(ORDER, VENDOR)).toBe(7200);
  });

  it("applyVendorDiscount: below min → no discount", () => {
    const smallOrder = { ...ORDER, quantityUnits: 3 }; // 2400 < 5000 min
    expect(applyVendorDiscount(smallOrder, VENDOR)).toBe(2400);
  });

  it("isOrderLate: received → false", () => {
    expect(isOrderLate(ORDER, NOW)).toBe(false);
  });

  it("isOrderLate: not received, past expected → true", () => {
    const late = { ...ORDER, receivedAt: null };
    expect(isOrderLate(late, NOW)).toBe(true);
  });

  it("orderLeadTimeMs: received - ordered", () => {
    expect(orderLeadTimeMs(ORDER)).toBe(4 * 86_400_000);
  });

  it("bestVendorForCategory: selects highest score vendor", () => {
    const vendors = [
      VENDOR,
      { ...VENDOR, vendorId: "v2", reliabilityScore: 9, avgDeliveryDays: 5 },
    ];
    expect(bestVendorForCategory(vendors, "stationery")!.vendorId).toBe("v1"); // 8×2-2=14 vs 9×2-5=13
  });
});
