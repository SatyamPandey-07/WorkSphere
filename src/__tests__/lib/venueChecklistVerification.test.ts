/**
 * Tests for venue owner submission checklist verification.
 */

type ChecklistItemStatus = "pending" | "verified" | "rejected";

interface ChecklistItem {
  id: string;
  name: string;
  required: boolean;
  status: ChecklistItemStatus;
  rejectionReason?: string;
}

function allRequiredVerified(items: ChecklistItem[]): boolean {
  return items
    .filter((i) => i.required)
    .every((i) => i.status === "verified");
}

function pendingRequiredItems(items: ChecklistItem[]): ChecklistItem[] {
  return items.filter((i) => i.required && i.status === "pending");
}

function verifyItem(items: ChecklistItem[], id: string): ChecklistItem[] {
  return items.map((i) =>
    i.id === id ? { ...i, status: "verified" as const } : i
  );
}

function rejectItem(items: ChecklistItem[], id: string, reason: string): ChecklistItem[] {
  return items.map((i) =>
    i.id === id ? { ...i, status: "rejected" as const, rejectionReason: reason } : i
  );
}

function completionPercent(items: ChecklistItem[]): number {
  if (items.length === 0) return 0;
  const verified = items.filter((i) => i.status === "verified").length;
  return Math.round((verified / items.length) * 100);
}

const ITEMS: ChecklistItem[] = [
  { id: "i1", name: "Business License",   required: true,  status: "verified"  },
  { id: "i2", name: "Insurance",          required: true,  status: "pending"   },
  { id: "i3", name: "Floor Plan",         required: true,  status: "pending"   },
  { id: "i4", name: "Menu/Pricing Guide", required: false, status: "pending"   },
];

describe("Venue checklist verification", () => {
  it("allRequiredVerified: not all verified → false", () => {
    expect(allRequiredVerified(ITEMS)).toBe(false);
  });

  it("allRequiredVerified: all required verified → true", () => {
    const all = ITEMS.map((i) => i.required ? { ...i, status: "verified" as const } : i);
    expect(allRequiredVerified(all)).toBe(true);
  });

  it("pendingRequiredItems: 2 required pending", () => {
    expect(pendingRequiredItems(ITEMS)).toHaveLength(2);
  });

  it("verifyItem sets status to verified", () => {
    const updated = verifyItem(ITEMS, "i2");
    expect(updated.find((i) => i.id === "i2")!.status).toBe("verified");
  });

  it("verifyItem is immutable", () => {
    verifyItem(ITEMS, "i2");
    expect(ITEMS.find((i) => i.id === "i2")!.status).toBe("pending");
  });

  it("rejectItem sets status and reason", () => {
    const updated = rejectItem(ITEMS, "i3", "blurry photo");
    const item = updated.find((i) => i.id === "i3")!;
    expect(item.status).toBe("rejected");
    expect(item.rejectionReason).toBe("blurry photo");
  });

  it("completionPercent: 1/4 = 25%", () => {
    expect(completionPercent(ITEMS)).toBe(25);
  });

  it("completionPercent: empty → 0", () => {
    expect(completionPercent([])).toBe(0);
  });
});
