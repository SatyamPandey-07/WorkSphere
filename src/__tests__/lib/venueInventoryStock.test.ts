/**
 * Tests for venue inventory stock management (amenity supplies).
 */

interface StockItem {
  id: string;
  name: string;
  quantity: number;
  minQuantity: number; // reorder threshold
  unitCost: number;    // cents
}

function isLowStock(item: StockItem): boolean {
  return item.quantity <= item.minQuantity;
}

function isOutOfStock(item: StockItem): boolean {
  return item.quantity === 0;
}

function reorderQuantity(item: StockItem, targetQuantity: number): number {
  return Math.max(0, targetQuantity - item.quantity);
}

function reorderCost(item: StockItem, targetQuantity: number): number {
  return reorderQuantity(item, targetQuantity) * item.unitCost;
}

function consume(item: StockItem, amount: number): StockItem {
  if (amount > item.quantity) throw new Error("Insufficient stock");
  return { ...item, quantity: item.quantity - amount };
}

function restock(item: StockItem, amount: number): StockItem {
  return { ...item, quantity: item.quantity + amount };
}

const ITEM: StockItem = { id: "i1", name: "Coffee pods", quantity: 20, minQuantity: 5, unitCost: 50 };

describe("Venue inventory stock", () => {
  it("isLowStock: 20 > 5 → false", () => {
    expect(isLowStock(ITEM)).toBe(false);
  });

  it("isLowStock: at threshold → true", () => {
    expect(isLowStock({ ...ITEM, quantity: 5 })).toBe(true);
  });

  it("isOutOfStock: 0 → true", () => {
    expect(isOutOfStock({ ...ITEM, quantity: 0 })).toBe(true);
  });

  it("isOutOfStock: non-zero → false", () => {
    expect(isOutOfStock(ITEM)).toBe(false);
  });

  it("reorderQuantity: 50 target - 20 current = 30", () => {
    expect(reorderQuantity(ITEM, 50)).toBe(30);
  });

  it("reorderQuantity: already above target → 0", () => {
    expect(reorderQuantity(ITEM, 10)).toBe(0);
  });

  it("reorderCost: 30 units × 50 cents = 1500", () => {
    expect(reorderCost(ITEM, 50)).toBe(1500);
  });

  it("consume: reduces quantity", () => {
    expect(consume(ITEM, 5).quantity).toBe(15);
  });

  it("consume: throws on insufficient stock", () => {
    expect(() => consume(ITEM, 25)).toThrow("Insufficient stock");
  });

  it("restock: increases quantity", () => {
    expect(restock(ITEM, 10).quantity).toBe(30);
  });

  it("restock is immutable", () => {
    restock(ITEM, 10);
    expect(ITEM.quantity).toBe(20);
  });
});
