/**
 * Tests for venue category badge icon mapping.
 */

import { Coffee, BookOpen, Building2, Wifi } from "lucide-react";

const CATEGORY_ICONS: Record<string, { icon: unknown; label: string; color: string }> = {
  cafe:       { icon: Coffee,    label: "Café",       color: "text-amber-600" },
  library:    { icon: BookOpen,  label: "Library",    color: "text-blue-600" },
  coworking:  { icon: Building2, label: "Coworking",  color: "text-purple-600" },
  default:    { icon: Wifi,      label: "Workspace",  color: "text-zinc-600" },
};

function getCategoryBadge(category?: string): { icon: unknown; label: string; color: string } {
  if (!category) return CATEGORY_ICONS.default;
  return CATEGORY_ICONS[category.toLowerCase()] ?? CATEGORY_ICONS.default;
}

describe("Venue category badge mapping", () => {
  it("returns cafe badge for 'cafe'", () => {
    const badge = getCategoryBadge("cafe");
    expect(badge.label).toBe("Café");
    expect(badge.color).toContain("amber");
  });

  it("returns library badge for 'library'", () => {
    const badge = getCategoryBadge("library");
    expect(badge.label).toBe("Library");
    expect(badge.color).toContain("blue");
  });

  it("returns coworking badge for 'coworking'", () => {
    const badge = getCategoryBadge("coworking");
    expect(badge.label).toBe("Coworking");
    expect(badge.color).toContain("purple");
  });

  it("returns default for undefined category", () => {
    expect(getCategoryBadge(undefined).label).toBe("Workspace");
  });

  it("returns default for unknown category", () => {
    expect(getCategoryBadge("gym").label).toBe("Workspace");
  });

  it("case-insensitive matching", () => {
    expect(getCategoryBadge("CAFE").label).toBe("Café");
    expect(getCategoryBadge("Library").label).toBe("Library");
  });
});
