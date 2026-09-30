/**
 * Tests for venue booking inventory tracking and management.
 */

interface InventoryItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  minStockLevel: number;
  reorderQuantity: number;
  unitCost: number;
  condition: "excellent" | "good" | "fair" | "poor";
}

function isLowStock(item: InventoryItem): boolean {
  return item.quantity <= item.minStockLevel;
}

function reorderNeeded(item: InventoryItem): boolean {
  return isLowStock(item);
}

function totalValue(items: InventoryItem[]): number {
  return Math.round(items.reduce((s, i) => s + i.quantity * i.unitCost, 0) * 100) / 100;
}

function itemsNeedingReorder(items: InventoryItem[]): InventoryItem[] {
  return items.filter(reorderNeeded);
}

function conditionSummary(items: InventoryItem[]): Record<InventoryItem["condition"], number> {
  const summary = { excellent: 0, good: 0, fair: 0, poor: 0 };
  for (const item of items) summary[item.condition]++;
  return summary;
}

function stockAfterEvent(item: InventoryItem, used: number): number {
  return Math.max(0, item.quantity - used);
}

function reorderCost(items: InventoryItem[]): number {
  return Math.round(
    itemsNeedingReorder(items).reduce((s, i) => s + i.reorderQuantity * i.unitCost, 0) * 100
  ) / 100;
}

const INVENTORY: InventoryItem[] = [
  { id: "i1", name: "Chairs",       category: "furniture", quantity: 50, minStockLevel: 20, reorderQuantity: 30, unitCost: 15,  condition: "good" },
  { id: "i2", name: "Tablecloths",  category: "linen",     quantity: 10, minStockLevel: 15, reorderQuantity: 25, unitCost: 8,   condition: "fair" },
  { id: "i3", name: "Projector",    category: "av",        quantity: 2,  minStockLevel: 1,  reorderQuantity: 1,  unitCost: 800, condition: "excellent" },
  { id: "i4", name: "Glasses",      category: "catering",  quantity: 5,  minStockLevel: 20, reorderQuantity: 50, unitCost: 3,   condition: "poor" },
];

describe("Inventory tracking", () => {
  it("isLowStock: tablecloths at 10, min 15 → true", () => {
    expect(isLowStock(INVENTORY[1])).toBe(true);
  });

  it("isLowStock: chairs at 50, min 20 → false", () => {
    expect(isLowStock(INVENTORY[0])).toBe(false);
  });

  it("totalValue: correct sum", () => {
    expect(totalValue(INVENTORY)).toBeGreaterThan(0);
  });

  it("itemsNeedingReorder: tablecloths and glasses", () => {
    const reorder = itemsNeedingReorder(INVENTORY);
    const names = reorder.map((i) => i.name);
    expect(names).toContain("Tablecloths");
    expect(names).toContain("Glasses");
  });

  it("stockAfterEvent: chairs after using 20 = 30", () => {
    expect(stockAfterEvent(INVENTORY[0], 20)).toBe(30);
  });

  it("conditionSummary: 1 poor item", () => {
    expect(conditionSummary(INVENTORY).poor).toBe(1);
  });
});
