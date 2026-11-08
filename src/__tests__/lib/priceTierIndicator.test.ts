/**
 * Tests for the price tier indicator logic (Issue #2084).
 * priceTier 1-4 maps to $, $$, $$$, $$$$.
 */

function getPriceTierSymbol(tier: number | undefined | null): string {
  if (!tier || tier < 1 || tier > 4) return "";
  return "$".repeat(tier);
}

function getPriceTierLabel(tier: number | undefined | null): string {
  const labels = ["", "Budget-friendly", "Moderate", "Premium", "Luxury"];
  if (!tier || tier < 1 || tier > 4) return "";
  return labels[tier];
}

describe("Price tier indicator", () => {
  describe("getPriceTierSymbol", () => {
    it("returns '$' for tier 1", () => {
      expect(getPriceTierSymbol(1)).toBe("$");
    });

    it("returns '$$' for tier 2", () => {
      expect(getPriceTierSymbol(2)).toBe("$$");
    });

    it("returns '$$$' for tier 3", () => {
      expect(getPriceTierSymbol(3)).toBe("$$$");
    });

    it("returns '$$$$' for tier 4", () => {
      expect(getPriceTierSymbol(4)).toBe("$$$$");
    });

    it("returns '' for undefined", () => {
      expect(getPriceTierSymbol(undefined)).toBe("");
    });

    it("returns '' for null", () => {
      expect(getPriceTierSymbol(null)).toBe("");
    });

    it("returns '' for out-of-range values", () => {
      expect(getPriceTierSymbol(0)).toBe("");
      expect(getPriceTierSymbol(5)).toBe("");
      expect(getPriceTierSymbol(-1)).toBe("");
    });
  });

  describe("getPriceTierLabel", () => {
    it("labels are correctly assigned", () => {
      expect(getPriceTierLabel(1)).toBe("Budget-friendly");
      expect(getPriceTierLabel(2)).toBe("Moderate");
      expect(getPriceTierLabel(3)).toBe("Premium");
      expect(getPriceTierLabel(4)).toBe("Luxury");
    });

    it("returns empty string for undefined/null/out-of-range", () => {
      expect(getPriceTierLabel(undefined)).toBe("");
      expect(getPriceTierLabel(0)).toBe("");
      expect(getPriceTierLabel(5)).toBe("");
    });
  });

  describe("tier ordering", () => {
    it("higher tier has longer symbol", () => {
      expect(getPriceTierSymbol(4).length).toBeGreaterThan(getPriceTierSymbol(1).length);
    });

    it("symbols are monotonically longer", () => {
      const symbols = [1, 2, 3, 4].map((t) => getPriceTierSymbol(t));
      for (let i = 1; i < symbols.length; i++) {
        expect(symbols[i].length).toBe(symbols[i - 1].length + 1);
      }
    });

    it("all symbols consist only of $ characters", () => {
      [1, 2, 3, 4].forEach((t) => {
        const sym = getPriceTierSymbol(t);
        expect(sym).toMatch(/^\$+$/);
      });
    });
  });
});
