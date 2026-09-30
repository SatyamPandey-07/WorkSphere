/**
 * Tests for venue café/food menu filtering by dietary preferences.
 */

type DietaryTag = "vegan" | "vegetarian" | "gluten_free" | "dairy_free" | "halal" | "kosher" | "nut_free";

interface MenuItem {
  itemId: string;
  name: string;
  priceCents: number;
  dietaryTags: DietaryTag[];
  isAvailable: boolean;
  calories?: number;
}

function filterByDietaryTags(
  menu: MenuItem[],
  requiredTags: DietaryTag[]
): MenuItem[] {
  if (requiredTags.length === 0) return menu.filter((m) => m.isAvailable);
  return menu.filter(
    (m) => m.isAvailable && requiredTags.every((tag) => m.dietaryTags.includes(tag))
  );
}

function averageMenuPrice(items: MenuItem[]): number {
  if (items.length === 0) return 0;
  return Math.round(items.reduce((s, i) => s + i.priceCents, 0) / items.length);
}

function hasDietaryOption(menu: MenuItem[], tag: DietaryTag): boolean {
  return menu.some((m) => m.isAvailable && m.dietaryTags.includes(tag));
}

function sortByCalories(items: MenuItem[]): MenuItem[] {
  return [...items].sort((a, b) => (a.calories ?? 999) - (b.calories ?? 999));
}

const MENU: MenuItem[] = [
  { itemId: "m1", name: "Oat Latte",    priceCents: 450, dietaryTags: ["vegan", "dairy_free", "gluten_free"], isAvailable: true,  calories: 120 },
  { itemId: "m2", name: "Avocado Toast", priceCents: 850, dietaryTags: ["vegetarian", "vegan"],               isAvailable: true,  calories: 350 },
  { itemId: "m3", name: "Cheese Bagel",  priceCents: 650, dietaryTags: ["vegetarian"],                        isAvailable: true,  calories: 450 },
  { itemId: "m4", name: "Halal Wrap",    priceCents: 900, dietaryTags: ["halal"],                              isAvailable: false, calories: 580 }, // unavailable
];

describe("Venue food menu filtering", () => {
  it("filterByDietaryTags: vegan options (available only)", () => {
    const vegan = filterByDietaryTags(MENU, ["vegan"]);
    expect(vegan).toHaveLength(2);
  });

  it("filterByDietaryTags: vegan AND dairy_free", () => {
    const filtered = filterByDietaryTags(MENU, ["vegan", "dairy_free"]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].itemId).toBe("m1");
  });

  it("filterByDietaryTags: unavailable excluded", () => {
    const halal = filterByDietaryTags(MENU, ["halal"]);
    expect(halal).toHaveLength(0);
  });

  it("filterByDietaryTags: empty tags → all available", () => {
    expect(filterByDietaryTags(MENU, [])).toHaveLength(3);
  });

  it("hasDietaryOption: vegan exists → true", () => {
    expect(hasDietaryOption(MENU, "vegan")).toBe(true);
  });

  it("hasDietaryOption: kosher not available → false", () => {
    expect(hasDietaryOption(MENU, "kosher")).toBe(false);
  });

  it("averageMenuPrice: avg of available items", () => {
    expect(averageMenuPrice(filterByDietaryTags(MENU, []))).toBeGreaterThan(0);
  });

  it("sortByCalories: lowest first", () => {
    const sorted = sortByCalories(filterByDietaryTags(MENU, []));
    expect(sorted[0].calories!).toBeLessThanOrEqual(sorted[1].calories!);
  });
});
