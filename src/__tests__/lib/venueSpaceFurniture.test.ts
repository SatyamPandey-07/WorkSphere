/**
 * Tests for venue space furniture inventory and layout capacity.
 */

type FurnitureType = "desk" | "chair" | "standing_desk" | "sofa" | "whiteboard" | "monitor";

interface FurnitureItem {
  id: string;
  type: FurnitureType;
  quantity: number;
  isAvailable: boolean;
  zone: string;
}

function countByType(furniture: FurnitureItem[], type: FurnitureType): number {
  return furniture
    .filter((f) => f.type === type && f.isAvailable)
    .reduce((sum, f) => sum + f.quantity, 0);
}

function availableFurnitureInZone(furniture: FurnitureItem[], zone: string): FurnitureItem[] {
  return furniture.filter((f) => f.zone === zone && f.isAvailable);
}

function canConfigureWorkstation(
  furniture: FurnitureItem[],
  requiredDesk: number,
  requiredChair: number,
  requiredMonitor: number
): boolean {
  return (
    countByType(furniture, "desk") >= requiredDesk &&
    countByType(furniture, "chair") >= requiredChair &&
    countByType(furniture, "monitor") >= requiredMonitor
  );
}

function totalFurnitureValue(furniture: FurnitureItem[], priceMap: Record<FurnitureType, number>): number {
  return furniture.reduce((sum, f) => sum + (priceMap[f.type] ?? 0) * f.quantity, 0);
}

const FURNITURE: FurnitureItem[] = [
  { id: "f1", type: "desk",           quantity: 10, isAvailable: true,  zone: "quiet"    },
  { id: "f2", type: "chair",          quantity: 15, isAvailable: true,  zone: "quiet"    },
  { id: "f3", type: "monitor",        quantity: 8,  isAvailable: true,  zone: "quiet"    },
  { id: "f4", type: "standing_desk",  quantity: 5,  isAvailable: true,  zone: "social"   },
  { id: "f5", type: "whiteboard",     quantity: 2,  isAvailable: false, zone: "meeting"  }, // not available
];

describe("Venue space furniture", () => {
  it("countByType: 10 available desks", () => {
    expect(countByType(FURNITURE, "desk")).toBe(10);
  });

  it("countByType: whiteboard not available → 0", () => {
    expect(countByType(FURNITURE, "whiteboard")).toBe(0);
  });

  it("availableFurnitureInZone: quiet has 3 items", () => {
    expect(availableFurnitureInZone(FURNITURE, "quiet")).toHaveLength(3);
  });

  it("availableFurnitureInZone: meeting has 0 available", () => {
    expect(availableFurnitureInZone(FURNITURE, "meeting")).toHaveLength(0);
  });

  it("canConfigureWorkstation: 5 desks, 5 chairs, 5 monitors → true", () => {
    expect(canConfigureWorkstation(FURNITURE, 5, 5, 5)).toBe(true);
  });

  it("canConfigureWorkstation: needs 20 desks → false", () => {
    expect(canConfigureWorkstation(FURNITURE, 20, 5, 5)).toBe(false);
  });

  it("totalFurnitureValue: calculates correctly", () => {
    const prices: Record<FurnitureType, number> = {
      desk: 100, chair: 50, standing_desk: 200, sofa: 300, whiteboard: 150, monitor: 250,
    };
    const value = totalFurnitureValue(FURNITURE, prices);
    expect(value).toBe(10 * 100 + 15 * 50 + 8 * 250 + 5 * 200 + 2 * 150);
  });
});
