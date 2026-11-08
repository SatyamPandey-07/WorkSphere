export type HighContrastShape = "circle" | "square" | "diamond";

/**
 * Maps venue category to a distinct geometric shape glyph according to
 * WCAG 2.1 AA accessibility guidelines for non-color dependent differentiation:
 * - Circle for Cafe / Coffee shops
 * - Square for Coworking spaces / Workspaces
 * - Diamond for Libraries / Study zones
 */
export function getVenueShape(category?: string): HighContrastShape {
  if (!category) return "circle";
  const cat = category.toLowerCase().trim();

  // Coworking: square
  if (
    cat.includes("cowork") ||
    cat.includes("workspace") ||
    cat.includes("office") ||
    cat.includes("desk")
  ) {
    return "square";
  }

  // Library: diamond
  if (
    cat.includes("library") ||
    cat.includes("book") ||
    cat.includes("study") ||
    cat.includes("reading")
  ) {
    return "diamond";
  }

  // Cafe: circle (also default)
  return "circle";
}

/**
 * Returns a screen-reader friendly description of the geometric shape glyph.
 */
export function getShapeAriaDescription(shape: HighContrastShape): string {
  switch (shape) {
    case "square":
      return "Square glyph (Coworking/Workspace)";
    case "diamond":
      return "Diamond glyph (Library/Study zone)";
    case "circle":
    default:
      return "Circle glyph (Cafe/Coffee)";
  }
}

/**
 * Returns the CSS class for the high-contrast shape pin styling.
 */
export function getHighContrastIconClass(category?: string): string {
  const shape = getVenueShape(category);
  return `hc-shape-${shape}`;
}
