/**
 * Tests for venue category taxonomy and hierarchy.
 */

interface CategoryNode {
  id: string;
  name: string;
  parentId: string | null;
}

const TAXONOMY: CategoryNode[] = [
  { id: "workspace",   name: "Workspace",          parentId: null        },
  { id: "cafe",        name: "Café",                parentId: "workspace" },
  { id: "coworking",   name: "Co-working Space",    parentId: "workspace" },
  { id: "library",     name: "Library",             parentId: "workspace" },
  { id: "specialty-cafe", name: "Specialty Café",   parentId: "cafe"      },
  { id: "outdoor",     name: "Outdoor Space",       parentId: null        },
];

function getChildren(taxonomy: CategoryNode[], parentId: string): CategoryNode[] {
  return taxonomy.filter((n) => n.parentId === parentId);
}

function getParent(taxonomy: CategoryNode[], id: string): CategoryNode | null {
  const node = taxonomy.find((n) => n.id === id);
  if (!node || !node.parentId) return null;
  return taxonomy.find((n) => n.id === node.parentId) ?? null;
}

function isDescendant(taxonomy: CategoryNode[], id: string, ancestorId: string): boolean {
  let current = taxonomy.find((n) => n.id === id);
  while (current && current.parentId) {
    if (current.parentId === ancestorId) return true;
    current = taxonomy.find((n) => n.id === current!.parentId);
  }
  return false;
}

function getRootCategories(taxonomy: CategoryNode[]): CategoryNode[] {
  return taxonomy.filter((n) => n.parentId === null);
}

describe("Venue category taxonomy", () => {
  it("getChildren: workspace has 3 children", () => {
    expect(getChildren(TAXONOMY, "workspace")).toHaveLength(3);
  });

  it("getChildren: specialty-cafe has 0 children", () => {
    expect(getChildren(TAXONOMY, "specialty-cafe")).toHaveLength(0);
  });

  it("getParent: cafe parent is workspace", () => {
    expect(getParent(TAXONOMY, "cafe")?.id).toBe("workspace");
  });

  it("getParent: workspace has no parent → null", () => {
    expect(getParent(TAXONOMY, "workspace")).toBeNull();
  });

  it("isDescendant: specialty-cafe is descendant of workspace", () => {
    expect(isDescendant(TAXONOMY, "specialty-cafe", "workspace")).toBe(true);
  });

  it("isDescendant: coworking is not a descendant of cafe", () => {
    expect(isDescendant(TAXONOMY, "coworking", "cafe")).toBe(false);
  });

  it("getRootCategories: workspace and outdoor", () => {
    const roots = getRootCategories(TAXONOMY);
    expect(roots.map((r) => r.id)).toContain("workspace");
    expect(roots.map((r) => r.id)).toContain("outdoor");
    expect(roots).toHaveLength(2);
  });
});
