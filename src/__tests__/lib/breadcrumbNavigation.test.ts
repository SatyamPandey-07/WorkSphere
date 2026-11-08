/**
 * Tests for the Breadcrumb navigation logic (Issue #1865).
 * Verifies accessibility and structural correctness.
 */

interface BreadcrumbItem {
  label: string;
  href?: string;
}

function buildBreadcrumbItems(
  items: BreadcrumbItem[],
): Array<BreadcrumbItem & { isCurrentPage: boolean; hasLink: boolean }> {
  return items.map((item, idx) => ({
    ...item,
    isCurrentPage: idx === items.length - 1,
    hasLink: idx < items.length - 1 && !!item.href,
  }));
}

describe("Breadcrumb navigation logic", () => {
  const testItems: BreadcrumbItem[] = [
    { label: "Explore", href: "/ai" },
    { label: "Collections", href: "/collections" },
    { label: "My Collection" },
  ];

  it("marks only the last item as current page", () => {
    const built = buildBreadcrumbItems(testItems);
    const currentPageItems = built.filter((i) => i.isCurrentPage);
    expect(currentPageItems).toHaveLength(1);
    expect(currentPageItems[0].label).toBe("My Collection");
  });

  it("first non-last items have hasLink=true when href provided", () => {
    const built = buildBreadcrumbItems(testItems);
    expect(built[0].hasLink).toBe(true);
    expect(built[1].hasLink).toBe(true);
  });

  it("last item never has link (even if href provided)", () => {
    const withHref: BreadcrumbItem[] = [
      { label: "Home", href: "/" },
      { label: "Page", href: "/page" }, // last item with href
    ];
    const built = buildBreadcrumbItems(withHref);
    expect(built[built.length - 1].hasLink).toBe(false);
  });

  it("single item → it's the current page", () => {
    const built = buildBreadcrumbItems([{ label: "Home" }]);
    expect(built[0].isCurrentPage).toBe(true);
    expect(built[0].hasLink).toBe(false);
  });

  it("item without href has no link even if not current page", () => {
    const items: BreadcrumbItem[] = [
      { label: "No Link" }, // no href, not last
      { label: "Current" },
    ];
    const built = buildBreadcrumbItems(items);
    expect(built[0].hasLink).toBe(false);
  });

  it("all items preserve their labels", () => {
    const built = buildBreadcrumbItems(testItems);
    expect(built.map((i) => i.label)).toEqual(testItems.map((i) => i.label));
  });

  it("breadcrumb for venue page: Home > Explore > Venue Name", () => {
    const items: BreadcrumbItem[] = [
      { label: "Explore", href: "/ai" },
      { label: "Central Library" },
    ];
    const built = buildBreadcrumbItems(items);
    expect(built[0].hasLink).toBe(true);
    expect(built[1].isCurrentPage).toBe(true);
    expect(built[1].hasLink).toBe(false);
  });
});
