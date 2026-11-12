import {
  SmartCafeEngine,
  SAMPLE_CAFE_MENU,
  type MenuItem,
  type OrderItemInput,
} from "@/lib/cafe/smartCafeEngine";

describe("SmartCafeEngine (#6794)", () => {
  describe("filterMenu", () => {
    it("handles null or undefined menu safely", () => {
      expect(SmartCafeEngine.filterMenu(null)).toEqual([]);
      expect(SmartCafeEngine.filterMenu(undefined)).toEqual([]);
    });

    it("handles null or empty tags and allergens safely", () => {
      const items = SmartCafeEngine.filterMenu(SAMPLE_CAFE_MENU, null, null);
      expect(items.length).toBe(SAMPLE_CAFE_MENU.length);
    });

    it("filters menu by required dietary tags", () => {
      const veganItems = SmartCafeEngine.filterMenu(
        SAMPLE_CAFE_MENU,
        ["vegan"],
        [],
      );
      expect(veganItems.length).toBeGreaterThan(0);
      veganItems.forEach((item) => {
        expect(item.dietaryTags).toContain("vegan");
      });
    });

    it("excludes items matching excluded allergens", () => {
      const nutFreeItems = SmartCafeEngine.filterMenu(
        SAMPLE_CAFE_MENU,
        [],
        ["nuts"],
      );
      nutFreeItems.forEach((item) => {
        const containsNuts = item.allergens.some((a) =>
          a.toLowerCase().includes("nuts"),
        );
        expect(containsNuts).toBe(false);
      });
    });

    it("filters items by category", () => {
      const coldBrews = SmartCafeEngine.filterMenu(
        SAMPLE_CAFE_MENU,
        [],
        [],
        "cold_brew",
      );
      expect(coldBrews.length).toBeGreaterThan(0);
      coldBrews.forEach((item) => {
        expect(item.category).toBe("cold_brew");
      });
    });
  });

  describe("calculateOrderDetails", () => {
    it("returns zeros when itemsInput is null or empty", () => {
      const resNull = SmartCafeEngine.calculateOrderDetails(null, SAMPLE_CAFE_MENU);
      expect(resNull).toEqual({
        calculatedItems: [],
        subtotal: 0,
        tax: 0,
        total: 0,
        estimatedPrepMinutes: 0,
      });

      const resEmpty = SmartCafeEngine.calculateOrderDetails([], SAMPLE_CAFE_MENU);
      expect(resEmpty).toEqual({
        calculatedItems: [],
        subtotal: 0,
        tax: 0,
        total: 0,
        estimatedPrepMinutes: 0,
      });
    });

    it("throws an error when menuItemId is not found", () => {
      const input: OrderItemInput[] = [
        { menuItemId: "non-existent-id", quantity: 1, customizations: [] },
      ];
      expect(() =>
        SmartCafeEngine.calculateOrderDetails(input, SAMPLE_CAFE_MENU),
      ).toThrow("Menu item with ID non-existent-id not found.");
    });

    it("sanitizes non-positive or non-finite quantities to 1", () => {
      const item = SAMPLE_CAFE_MENU[0];
      const input: OrderItemInput[] = [
        { menuItemId: item.id, quantity: -5, customizations: [] },
      ];
      const res = SmartCafeEngine.calculateOrderDetails(input, SAMPLE_CAFE_MENU);
      expect(res.calculatedItems[0].quantity).toBe(1);
      expect(res.subtotal).toBe(item.basePrice);
    });

    it("applies customization options and updates total price", () => {
      const item = SAMPLE_CAFE_MENU[0]; // basePrice: 5.5
      const input: OrderItemInput[] = [
        {
          menuItemId: item.id,
          quantity: 2,
          customizations: [
            {
              groupId: "milk-type",
              selectedOptionIds: ["coconut"], // +0.50
            },
            {
              groupId: "espresso-shots",
              selectedOptionIds: ["extra-shot"], // +1.00
            },
          ],
        },
      ];

      const res = SmartCafeEngine.calculateOrderDetails(input, SAMPLE_CAFE_MENU, 1);
      const expectedUnit = 5.5 + 0.5 + 1.0; // 7.00
      const expectedSubtotal = Number((expectedUnit * 2).toFixed(2)); // 14.00
      expect(res.subtotal).toBe(expectedSubtotal);
      expect(res.tax).toBe(Number((expectedSubtotal * 0.0875).toFixed(2)));
      expect(res.total).toBe(Number((expectedSubtotal + res.tax).toFixed(2)));
    });

    it("handles null customizations array and null customization options safely", () => {
      const item = SAMPLE_CAFE_MENU[0];
      const input: OrderItemInput[] = [
        {
          menuItemId: item.id,
          quantity: 1,
          customizations: null as any,
        },
      ];
      expect(() =>
        SmartCafeEngine.calculateOrderDetails(input, SAMPLE_CAFE_MENU),
      ).not.toThrow();
    });

    it("safely handles non-finite queue length", () => {
      const item = SAMPLE_CAFE_MENU[0];
      const input: OrderItemInput[] = [
        { menuItemId: item.id, quantity: 1, customizations: [] },
      ];
      const resNaN = SmartCafeEngine.calculateOrderDetails(
        input,
        SAMPLE_CAFE_MENU,
        NaN,
      );
      expect(resNaN.estimatedPrepMinutes).toBeGreaterThanOrEqual(3);

      const resNeg = SmartCafeEngine.calculateOrderDetails(
        input,
        SAMPLE_CAFE_MENU,
        -10,
      );
      expect(resNeg.estimatedPrepMinutes).toBeGreaterThanOrEqual(3);
    });
  });

  describe("generatePickupTokens", () => {
    it("generates a 4-char code and valid token with string orderId", () => {
      const { pickupCode, pickupToken } =
        SmartCafeEngine.generatePickupTokens("ord-12345678");
      expect(pickupCode).toHaveLength(4);
      expect(pickupToken).toMatch(/^WS-BARISTA-345678-[A-Z0-9]{4}$/);
    });

    it("handles null, undefined, or numeric orderIds without throwing", () => {
      expect(() => SmartCafeEngine.generatePickupTokens(null)).not.toThrow();
      expect(() => SmartCafeEngine.generatePickupTokens(undefined)).not.toThrow();
      expect(() => SmartCafeEngine.generatePickupTokens(987654)).not.toThrow();

      const nullRes = SmartCafeEngine.generatePickupTokens(null);
      expect(nullRes.pickupToken).toMatch(/^WS-BARISTA-000000-[A-Z0-9]{4}$/);

      const numRes = SmartCafeEngine.generatePickupTokens(987654);
      expect(numRes.pickupToken).toMatch(/^WS-BARISTA-987654-[A-Z0-9]{4}$/);
    });
  });
});
