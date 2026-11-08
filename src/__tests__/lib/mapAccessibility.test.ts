import {
  getVenueShape,
  getShapeAriaDescription,
  getHighContrastIconClass,
} from "@/lib/mapAccessibility";

describe("mapAccessibility helpers", () => {
  describe("getVenueShape", () => {
    it("returns 'square' for coworking, workspace, office, and desk categories", () => {
      expect(getVenueShape("coworking")).toBe("square");
      expect(getVenueShape("Shared Workspace")).toBe("square");
      expect(getVenueShape("Private Office")).toBe("square");
      expect(getVenueShape("Hot Desk")).toBe("square");
    });

    it("returns 'diamond' for library, book, study, and reading categories", () => {
      expect(getVenueShape("Public Library")).toBe("diamond");
      expect(getVenueShape("Book Cafe")).toBe("diamond");
      expect(getVenueShape("Quiet Study Zone")).toBe("diamond");
      expect(getVenueShape("Reading Room")).toBe("diamond");
    });

    it("returns 'circle' for cafe, coffee, and other categories", () => {
      expect(getVenueShape("Coffee Shop")).toBe("circle");
      expect(getVenueShape("Artisan Cafe")).toBe("circle");
      expect(getVenueShape("Bakery")).toBe("circle");
    });

    it("defaults to 'circle' when category is null, undefined, or empty", () => {
      expect(getVenueShape(undefined)).toBe("circle");
      expect(getVenueShape("")).toBe("circle");
    });
  });

  describe("getShapeAriaDescription", () => {
    it("returns descriptive string for square", () => {
      expect(getShapeAriaDescription("square")).toBe(
        "Square glyph (Coworking/Workspace)",
      );
    });

    it("returns descriptive string for diamond", () => {
      expect(getShapeAriaDescription("diamond")).toBe(
        "Diamond glyph (Library/Study zone)",
      );
    });

    it("returns descriptive string for circle", () => {
      expect(getShapeAriaDescription("circle")).toBe(
        "Circle glyph (Cafe/Coffee)",
      );
    });
  });

  describe("getHighContrastIconClass", () => {
    it("returns hc-shape-square for coworking categories", () => {
      expect(getHighContrastIconClass("Coworking Space")).toBe(
        "hc-shape-square",
      );
    });

    it("returns hc-shape-diamond for study and library categories", () => {
      expect(getHighContrastIconClass("Library")).toBe("hc-shape-diamond");
    });

    it("returns hc-shape-circle for cafe and unknown categories", () => {
      expect(getHighContrastIconClass("Cafe")).toBe("hc-shape-circle");
      expect(getHighContrastIconClass(undefined)).toBe("hc-shape-circle");
    });
  });
});
