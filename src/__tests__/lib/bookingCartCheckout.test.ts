/**
 * Tests for booking cart (multi-venue/multi-date) checkout.
 */

interface CartItem {
  itemId: string;
  venueId: string;
  date: string;
  startTime: string;
  endTime: string;
  seats: number;
  pricePerSeatCents: number;
}

function itemSubtotal(item: CartItem): number {
  // Simplified: assume 1 hour per slot
  return item.seats * item.pricePerSeatCents;
}

function cartSubtotal(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + itemSubtotal(i), 0);
}

function applyCartDiscount(subtotal: number, discountPct: number): number {
  return Math.round(subtotal * (1 - discountPct / 100));
}

function hasDuplicateSlots(items: CartItem[]): boolean {
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${item.venueId}:${item.date}:${item.startTime}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

function removeItem(items: CartItem[], itemId: string): CartItem[] {
  return items.filter((i) => i.itemId !== itemId);
}

function cartSummary(items: CartItem[]): { totalItems: number; totalSeats: number; subtotalCents: number } {
  return {
    totalItems: items.length,
    totalSeats: items.reduce((sum, i) => sum + i.seats, 0),
    subtotalCents: cartSubtotal(items),
  };
}

const CART: CartItem[] = [
  { itemId: "i1", venueId: "v1", date: "2026-10-01", startTime: "09:00", endTime: "10:00", seats: 2, pricePerSeatCents: 500 },
  { itemId: "i2", venueId: "v2", date: "2026-10-01", startTime: "14:00", endTime: "16:00", seats: 3, pricePerSeatCents: 800 },
];

describe("Booking cart checkout", () => {
  it("itemSubtotal: 2 seats × 500 = 1000", () => {
    expect(itemSubtotal(CART[0])).toBe(1000);
  });

  it("cartSubtotal: 1000 + 2400 = 3400", () => {
    expect(cartSubtotal(CART)).toBe(3400);
  });

  it("applyCartDiscount: 10% off 3400 = 3060", () => {
    expect(applyCartDiscount(3400, 10)).toBe(3060);
  });

  it("hasDuplicateSlots: unique slots → false", () => {
    expect(hasDuplicateSlots(CART)).toBe(false);
  });

  it("hasDuplicateSlots: duplicate slot → true", () => {
    const dup = [...CART, { ...CART[0], itemId: "i3" }];
    expect(hasDuplicateSlots(dup)).toBe(true);
  });

  it("removeItem: removes i1", () => {
    const updated = removeItem(CART, "i1");
    expect(updated).toHaveLength(1);
    expect(updated[0].itemId).toBe("i2");
  });

  it("cartSummary: correct totals", () => {
    const summary = cartSummary(CART);
    expect(summary.totalItems).toBe(2);
    expect(summary.totalSeats).toBe(5);
    expect(summary.subtotalCents).toBe(3400);
  });
});
