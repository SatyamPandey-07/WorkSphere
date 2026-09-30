/**
 * Tests for venue inventory automatic restock order generation.
 */

interface InventoryItem {
  itemId: string;
  name: string;
  currentStock: number;
  minStock: number;       // reorder point
  maxStock: number;       // target after reorder
  unitCostCents: number;
  leadTimeDays: number;   // days to receive
}

interface RestockOrder {
  itemId: string;
  orderQuantity: number;
  estimatedCostCents: number;
  urgency: "normal" | "urgent" | "critical";
}

function needsRestock(item: InventoryItem): boolean {
  return item.currentStock <= item.minStock;
}

function restockQuantity(item: InventoryItem): number {
  return Math.max(0, item.maxStock - item.currentStock);
}

function restockUrgency(item: InventoryItem): RestockOrder["urgency"] {
  if (item.currentStock === 0) return "critical";
  if (item.currentStock <= Math.floor(item.minStock / 2)) return "urgent";
  return "normal";
}

function generateRestockOrder(item: InventoryItem): RestockOrder | null {
  if (!needsRestock(item)) return null;
  const quantity = restockQuantity(item);
  return {
    itemId: item.itemId,
    orderQuantity: quantity,
    estimatedCostCents: quantity * item.unitCostCents,
    urgency: restockUrgency(item),
  };
}

function totalRestockCost(orders: RestockOrder[]): number {
  return orders.reduce((sum, o) => sum + o.estimatedCostCents, 0);
}

const ITEM_OK:       InventoryItem = { itemId: "i1", name: "Coffee pods", currentStock: 50, minStock: 10, maxStock: 100, unitCostCents: 50, leadTimeDays: 2 };
const ITEM_LOW:      InventoryItem = { itemId: "i2", name: "Tea bags",     currentStock: 8,  minStock: 10, maxStock: 50,  unitCostCents: 30, leadTimeDays: 3 };
const ITEM_CRITICAL: InventoryItem = { itemId: "i3", name: "Milk",         currentStock: 0,  minStock: 5,  maxStock: 20,  unitCostCents: 200, leadTimeDays: 1 };

describe("Venue inventory restock", () => {
  it("needsRestock: above min → false", () => {
    expect(needsRestock(ITEM_OK)).toBe(false);
  });

  it("needsRestock: at or below min → true", () => {
    expect(needsRestock(ITEM_LOW)).toBe(true);
    expect(needsRestock(ITEM_CRITICAL)).toBe(true);
  });

  it("restockQuantity: max - current", () => {
    expect(restockQuantity(ITEM_LOW)).toBe(42); // 50 - 8
  });

  it("restockUrgency: 0 stock → critical", () => {
    expect(restockUrgency(ITEM_CRITICAL)).toBe("critical");
  });

  it("restockUrgency: at or below half min → urgent", () => {
    expect(restockUrgency({ ...ITEM_LOW, currentStock: 4 })).toBe("urgent");
  });

  it("restockUrgency: at min → normal", () => {
    expect(restockUrgency(ITEM_LOW)).toBe("normal");
  });

  it("generateRestockOrder: not needed → null", () => {
    expect(generateRestockOrder(ITEM_OK)).toBeNull();
  });

  it("generateRestockOrder: generates order with correct cost", () => {
    const order = generateRestockOrder(ITEM_CRITICAL)!;
    expect(order.orderQuantity).toBe(20); // max 20, current 0
    expect(order.estimatedCostCents).toBe(4000); // 20 × 200
    expect(order.urgency).toBe("critical");
  });

  it("totalRestockCost: sums all orders", () => {
    const orders = [generateRestockOrder(ITEM_LOW)!, generateRestockOrder(ITEM_CRITICAL)!];
    expect(totalRestockCost(orders)).toBe(42 * 30 + 20 * 200);
  });
});
