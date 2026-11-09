import {
  classifyMenuItem,
  classifyMenuItemDetailed,
  type DietaryTag,
} from "@/lib/agents/MenuClassifier";

// Ambient declarations for Jest test runner environment
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void | Promise<void>) => void;
declare const expect: (actual: any) => any;

describe("MenuClassifier Agent - Dietary & Allergen Tagger", () => {
  describe("Deterministic Dietary Keyword Matching", () => {
    it("assigns vegan tag for explicit vegan items", () => {
      const result: DietaryTag[] = classifyMenuItem(
        "100% Plant-Based Tofu Scramble"
      );
      expect(result).toContain("vegan");
      expect(classifyMenuItem("Vegan Chocolate Mousse")).toContain("vegan");
      expect(classifyMenuItem("Acai Berry Bowl 🌱")).toContain("vegan");
    });

    it("assigns gluten-free tag for explicit gluten-free items", () => {
      expect(classifyMenuItem("Gluten-Free Almond Flour Pancake")).toContain(
        "gluten-free"
      );
      expect(classifyMenuItem("Certified Gluten Free Granola")).toContain(
        "gluten-free"
      );
    });

    it("assigns dairy-free tag for explicit dairy-free items and plant milks", () => {
      expect(classifyMenuItem("Dairy-Free Coconut Yogurt Parfait")).toContain(
        "dairy-free"
      );
      expect(classifyMenuItem("Oat Milk Flat White")).toContain("dairy-free");
      expect(classifyMenuItem("Almond Milk Cappuccino")).toContain("dairy-free");
    });

    it("assigns nut-free tag for explicit nut-free items", () => {
      expect(classifyMenuItem("Nut-Free Sunflower Seed Butter Toast")).toContain(
        "nut-free"
      );
      expect(classifyMenuItem("Peanut-Free Oatmeal Cookie")).toContain("nut-free");
      expect(classifyMenuItem("Tree Nut Free Granola Bar")).toContain("nut-free");
    });

    it("assigns keto tag for low-carb and ketogenic items", () => {
      expect(classifyMenuItem("Keto Bulletproof Coffee with MCT Oil")).toContain(
        "keto"
      );
      expect(classifyMenuItem("Ultra Low-Carb Cauliflower Mash Bowl")).toContain(
        "keto"
      );
      expect(classifyMenuItem("Zero-Carb Avocado & Egg Platter")).toContain(
        "keto"
      );
    });
  });

  describe("OCR Extracted Menu Strings & Badges", () => {
    it("extracts bracketed and parenthesized acronyms (V, GF, DF, NF)", () => {
      const tags = classifyMenuItem("Avocado Toast (V, GF, DF, NF)");
      expect(tags).toContain("vegan");
      expect(tags).toContain("gluten-free");
      expect(tags).toContain("dairy-free");
      expect(tags).toContain("nut-free");
    });

    it("handles slash-delimited acronyms [V/GF/DF]", () => {
      const tags = classifyMenuItem("Green Superfood Smoothie [V/GF/DF]");
      expect(tags).toContain("vegan");
      expect(tags).toContain("gluten-free");
      expect(tags).toContain("dairy-free");
    });

    it("handles uppercase standalone tokens in OCR headers", () => {
      const tags = classifyMenuItem("CHIA SEED PARFAIT - GF DF KETO");
      expect(tags).toContain("gluten-free");
      expect(tags).toContain("dairy-free");
      expect(tags).toContain("keto");
    });

    it("handles OCR noise with unicode dashes and spaced hyphens", () => {
      const tags = classifyMenuItem(
        "Gluten — Free Pancakes with Oat — Milk"
      );
      expect(tags).toContain("gluten-free");
      expect(tags).toContain("dairy-free");
    });

    it("correctly identifies [KETO] with [DF] tags", () => {
      const tags = classifyMenuItem(
        "Smoked Salmon Scramble [KETO] [DF]",
        "Cage-free eggs scrambled in avocado oil"
      );
      expect(tags).toContain("keto");
      expect(tags).toContain("dairy-free");
      expect(tags).not.toContain("vegan");
    });
  });

  describe("Negation Handling & Contradiction Resolution", () => {
    it("rejects vegan tag when direct negation is present", () => {
      expect(classifyMenuItem("Not vegan: contains bacon and eggs")).toEqual([]);
      expect(classifyMenuItem("Non-vegan cheese pizza")).toEqual([]);
      expect(classifyMenuItem("Standard dish is not suitable for vegans")).toEqual(
        []
      );
    });

    it("rejects vegan tag when animal meats or poultry are present", () => {
      expect(classifyMenuItem("Chicken Salad with Avocado")).not.toContain("vegan");
      expect(classifyMenuItem("Beef Burger on Brioche")).not.toContain("vegan");
      expect(classifyMenuItem("Bacon, Egg, and Cheddar Croissant")).toEqual([]);
    });

    it("rejects gluten-free tag when direct negation or gluten ingredients are present", () => {
      expect(
        classifyMenuItem("Sourdough Toast (Contains Wheat, not gluten-free)")
      ).toEqual([]);
      expect(
        classifyMenuItem(
          "GF Chocolate Cookie",
          "Warning: Contains wheat, not suitable for celiacs"
        )
      ).toEqual([]);
      expect(
        classifyMenuItem("Whole Wheat Bagel - Not Gluten-Free")
      ).not.toContain("gluten-free");
    });

    it("rejects dairy-free tag when dairy ingredients or direct negation are present", () => {
      expect(
        classifyMenuItem("Oat Milk Latte with Real Whipped Cream (Contains dairy)")
      ).not.toContain("dairy-free");
      expect(
        classifyMenuItem("Pastry [DF] - Not dairy-free, made with real butter")
      ).not.toContain("dairy-free");
      expect(
        classifyMenuItem("Cheddar & Mozzarella Melt")
      ).not.toContain("dairy-free");
    });

    it("rejects nut-free tag when tree nuts or allergen warnings are present", () => {
      expect(
        classifyMenuItem("Almond Biscotti [NF] - Contains tree nuts")
      ).not.toContain("nut-free");
      expect(
        classifyMenuItem("Energy Bar", "Nut-free recipe but may contain trace nuts")
      ).not.toContain("nut-free");
      expect(
        classifyMenuItem("Granola Bowl", "Facility also handles peanuts and tree nuts")
      ).not.toContain("nut-free");
      expect(classifyMenuItem("Peanut Butter Toast")).not.toContain("nut-free");
      expect(classifyMenuItem("Walnut Carrot Cake")).not.toContain("nut-free");
    });

    it("rejects keto tag when high-carb or high-sugar ingredients are flagged", () => {
      expect(
        classifyMenuItem("Keto Brownie", "High sugar caramel syrup - not keto")
      ).not.toContain("keto");
    });

    it("preserves unaffected tags across clause boundaries in complex items", () => {
      const tags = classifyMenuItem(
        "Gluten-Free Walnut Banana Bread [GF]",
        "Baked with certified GF flour. Note: Contains walnuts (not nut-free)."
      );
      expect(tags).toContain("gluten-free");
      expect(tags).not.toContain("nut-free");
    });

    it("preserves nut-free tag while negating gluten-free when only wheat is present", () => {
      const tags = classifyMenuItem(
        "Nut-Free Blueberry Muffin [NF]",
        "Nut-free facility. Contains wheat flour and cow milk."
      );
      expect(tags).toContain("nut-free");
      expect(tags).not.toContain("gluten-free");
      expect(tags).not.toContain("dairy-free");
    });
  });

  describe("Absence Clauses ('No [X]', 'Without [X]')", () => {
    it("interprets 'no dairy', 'no gluten', 'without nuts' as positive tags", () => {
      const tags = classifyMenuItem(
        "Garden Fresh Green Salad",
        "No dairy, no gluten, without nuts."
      );
      expect(tags).toContain("gluten-free");
      expect(tags).toContain("dairy-free");
      expect(tags).toContain("nut-free");
    });

    it("interprets 'zero carbs, no sugar' as keto", () => {
      const tags = classifyMenuItem(
        "Herbal Sparkling Refresher",
        "Zero carbs, no sugar, ultra low-carb."
      );
      expect(tags).toContain("keto");
    });
  });

  describe("Safe Modifiers (Vegan substitutes do not trigger allergen negations)", () => {
    it("recognizes vegan cheese and vegan bacon without triggering meat or dairy disqualification", () => {
      const tags = classifyMenuItem(
        "Vegan Bacon & Cheddar Panini (GF, DF)",
        "Made with plant-based vegan bacon, dairy-free vegan cheddar, and gluten-free bread."
      );
      expect(tags).toContain("vegan");
      expect(tags).toContain("gluten-free");
      expect(tags).toContain("dairy-free");
    });

    it("recognizes Beyond Meat and Impossible Foods as vegan-safe", () => {
      const tags = classifyMenuItem(
        "Beyond Meat Artisan Burger (Vegan, DF)",
        "100% plant-based patty on vegan brioche."
      );
      expect(tags).toContain("vegan");
      expect(tags).toContain("dairy-free");
    });

    it("recognizes GF oat flour as safe without triggering wheat/gluten allergen", () => {
      const tags = classifyMenuItem(
        "GF Oatmeal Pancake",
        "Made with certified gf oat flour and coconut oil."
      );
      expect(tags).toContain("gluten-free");
    });
  });

  describe("Options and Output Formatting", () => {
    it("returns hyphenated tags by default", () => {
      const tags = classifyMenuItem("Acai Bowl (GF, DF, NF)");
      expect(tags).toEqual(["gluten-free", "dairy-free", "nut-free"]);
    });

    it("returns underscore tags when format is set to 'underscore'", () => {
      const tags = classifyMenuItem("Acai Bowl (GF, DF, NF)", undefined, {
        format: "underscore",
      });
      expect(tags).toEqual(["gluten_free", "dairy_free", "nut_free"]);
    });

    it("handles includeImplicit option", () => {
      const tagsExplicit = classifyMenuItem("Vegan Tofu Bowl", undefined, {
        includeImplicit: true,
      });
      expect(tagsExplicit).toContain("dairy-free");

      const tagsExplicitFalse = classifyMenuItem("Vegan Tofu Bowl", undefined, {
        includeImplicit: false,
      });
      expect(tagsExplicitFalse).toContain("vegan");
      expect(tagsExplicitFalse).not.toContain("dairy-free");
    });
  });

  describe("classifyMenuItemDetailed Rich Metadata", () => {
    it("returns rich metadata and explanation in classifyMenuItemDetailed", () => {
      const detailed = classifyMenuItemDetailed(
        "Gluten-Free Oats (contains almonds, not nut-free)"
      );

      expect(detailed.tags).toContain("gluten-free");
      expect(detailed.tags).not.toContain("nut-free");
      expect(detailed.negatedRules).toContain("nut_free_negated");
      expect(detailed.allergensDetected).toContain("nuts");
      expect(detailed.confidence["gluten-free"]).toBeGreaterThanOrEqual(0.9);
      expect(detailed.rawCombinedText).toContain("Gluten-Free Oats");
    });
  });

  describe("Edge Cases and Robustness", () => {
    it("returns empty array for non-dietary standard items", () => {
      expect(classifyMenuItem("House Black Coffee")).toEqual([]);
      expect(classifyMenuItem("Iced Espresso")).toEqual([]);
      expect(classifyMenuItem("Mineral Water")).toEqual([]);
    });

    it("returns empty array for empty strings or whitespace", () => {
      expect(classifyMenuItem("")).toEqual([]);
      expect(classifyMenuItem("    ")).toEqual([]);
      expect(classifyMenuItem(" \t\n ")).toEqual([]);
    });

    it("does not false-positive on words containing 'nut' like 'donut' or 'nutmeg'", () => {
      const tags = classifyMenuItem(
        "Gluten-Free Cinnamon Nutmeg Cookie [GF] [NF]"
      );
      expect(tags).toContain("gluten-free");
      expect(tags).toContain("nut-free");
    });
  });
});
