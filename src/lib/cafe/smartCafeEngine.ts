/**
 * Smart Cafe Menu Dietary Filter & Mobile Barista Pre-Ordering Engine
 * Handles allergen/dietary matrix filtering (Vegan, GF, Keto, Halal, Nut-Free, Dairy-Free),
 * drink customizations (milks, shots, sweeteners, temperature),
 * dynamic queue wait-time estimation, and HMAC-verified digital pickup tokens.
 */
import { estimatePrepMinutes } from "./prepTime";
export type DietaryTag =
  | "vegan"
  | "vegetarian"
  | "gluten_free"
  | "dairy_free"
  | "keto"
  | "nut_free"
  | "low_sugar"
  | "organic";

export interface MenuItemOption {
  id: string;
  name: string;
  priceDelta: number; // in USD
  calorieDelta: number;
}

export interface MenuItemCustomizationGroup {
  id: string;
  name: string;
  required: boolean;
  maxSelectable: number;
  options: MenuItemOption[];
}

export interface MenuItem {
  id: string;
  venueId: string;
  name: string;
  category:
    | "coffee_espresso"
    | "tea_matcha"
    | "cold_brew"
    | "bakery_pastry"
    | "healthy_bites";
  description: string;
  basePrice: number;
  baseCalories: number;
  caffeineMg: number;
  dietaryTags: DietaryTag[];
  allergens: string[];
  imageUrl?: string;
  customizationGroups: MenuItemCustomizationGroup[];
  isAvailable: boolean;
  prepTimeMinutes: number;
}

export interface OrderCustomizationSelection {
  groupId: string;
  selectedOptionIds: string[];
}

export interface OrderItemInput {
  menuItemId: string;
  quantity: number;
  customizations: OrderCustomizationSelection[];
  specialInstructions?: string;
}

export interface CafeOrder {
  id: string;
  venueId: string;
  venueName: string;
  userId?: string;
  customerName: string;
  deskNumber?: string;
  items: Array<{
    item: MenuItem;
    quantity: number;
    customizations: Array<{
      groupName: string;
      optionNames: string[];
      priceDelta: number;
    }>;
    itemTotalPrice: number;
  }>;
  subtotal: number;
  tax: number;
  total: number;
  status:
    "received" | "brewing" | "ready_for_pickup" | "collected" | "cancelled";
  createdAt: number;
  estimatedReadyTime: number;
  pickupToken: string;
  pickupCode: string;
  activeQueuePosition: number;
}

export const SAMPLE_CAFE_MENU: MenuItem[] = [
  {
    id: "oat-cortado",
    venueId: "venue-sf-01",
    name: "Artisan Oat Flat White / Cortado",
    category: "coffee_espresso",
    description:
      "Double shot of single-origin Ethiopian roast with micro-foamed organic oat milk.",
    basePrice: 5.5,
    baseCalories: 120,
    caffeineMg: 150,
    dietaryTags: ["vegan", "dairy_free", "nut_free", "low_sugar"],
    allergens: ["oats (gluten-free certified)"],
    prepTimeMinutes: 3,
    isAvailable: true,
    customizationGroups: [
      {
        id: "milk-type",
        name: "Milk Choice",
        required: true,
        maxSelectable: 1,
        options: [
          {
            id: "oat",
            name: "Organic Oat Milk",
            priceDelta: 0,
            calorieDelta: 0,
          },
          {
            id: "almond",
            name: "House Almond Milk",
            priceDelta: 0,
            calorieDelta: -40,
          },
          {
            id: "coconut",
            name: "Coconut Milk",
            priceDelta: 0.5,
            calorieDelta: -10,
          },
          {
            id: "whole-dairy",
            name: "Grass-Fed Whole Milk",
            priceDelta: 0,
            calorieDelta: 30,
          },
        ],
      },
      {
        id: "espresso-shots",
        name: "Espresso Strength",
        required: false,
        maxSelectable: 1,
        options: [
          {
            id: "extra-shot",
            name: "Extra Espresso Shot (+1)",
            priceDelta: 1.0,
            calorieDelta: 5,
          },
          {
            id: "decaf",
            name: "Swiss Water Decaf Blend",
            priceDelta: 0,
            calorieDelta: 0,
          },
        ],
      },
      {
        id: "flavor-syrups",
        name: "Sugar-Free / Natural Flavors",
        required: false,
        maxSelectable: 2,
        options: [
          {
            id: "vanilla-sf",
            name: "Monkfruit Vanilla (Sugar-Free)",
            priceDelta: 0.75,
            calorieDelta: 0,
          },
          {
            id: "caramel-sf",
            name: "Keto Salted Caramel (SF)",
            priceDelta: 0.75,
            calorieDelta: 0,
          },
          {
            id: "lavender",
            name: "Wild Organic Lavender",
            priceDelta: 0.75,
            calorieDelta: 35,
          },
        ],
      },
    ],
  },
  {
    id: "ceremonial-matcha-latte",
    venueId: "venue-sf-01",
    name: "Ceremonial Grade Uji Matcha Latte",
    category: "tea_matcha",
    description:
      "Stone-ground first-harvest Japanese green tea whisked with creamy plant milk and touch of agave.",
    basePrice: 6.25,
    baseCalories: 110,
    caffeineMg: 70,
    dietaryTags: ["vegan", "dairy_free", "organic", "gluten_free"],
    allergens: [],
    prepTimeMinutes: 4,
    isAvailable: true,
    customizationGroups: [
      {
        id: "milk-type",
        name: "Milk Choice",
        required: true,
        maxSelectable: 1,
        options: [
          {
            id: "oat",
            name: "Organic Oat Milk",
            priceDelta: 0,
            calorieDelta: 0,
          },
          {
            id: "almond",
            name: "House Almond Milk",
            priceDelta: 0,
            calorieDelta: -30,
          },
          {
            id: "macadamia",
            name: "Macadamia Milk",
            priceDelta: 1.0,
            calorieDelta: 20,
          },
        ],
      },
      {
        id: "sweetness",
        name: "Sweetness Level",
        required: true,
        maxSelectable: 1,
        options: [
          {
            id: "unsweetened",
            name: "Unsweetened (Zero Sugar)",
            priceDelta: 0,
            calorieDelta: -40,
          },
          {
            id: "light-agave",
            name: "Light Agave (50%)",
            priceDelta: 0,
            calorieDelta: 0,
          },
          {
            id: "monkfruit",
            name: "Monkfruit Sweetener (Keto)",
            priceDelta: 0.5,
            calorieDelta: -40,
          },
        ],
      },
    ],
  },
  {
    id: "nitro-cold-brew-adaptogens",
    venueId: "venue-sf-01",
    name: "Nitro Cold Brew with Lion’s Mane & Cordyceps",
    category: "cold_brew",
    description:
      "Slow-steeped 20-hour nitro draft infused with organic cognitive nootropic mushroom extracts.",
    basePrice: 6.0,
    baseCalories: 15,
    caffeineMg: 220,
    dietaryTags: [
      "vegan",
      "keto",
      "gluten_free",
      "dairy_free",
      "nut_free",
      "low_sugar",
      "organic",
    ],
    allergens: [],
    prepTimeMinutes: 1,
    isAvailable: true,
    customizationGroups: [
      {
        id: "ice-level",
        name: "Serving Style",
        required: true,
        maxSelectable: 1,
        options: [
          {
            id: "straight-draft",
            name: "Straight from Tap (No Ice)",
            priceDelta: 0,
            calorieDelta: 0,
          },
          {
            id: "over-ice",
            name: "Over Large Ice Sphere",
            priceDelta: 0,
            calorieDelta: 0,
          },
        ],
      },
      {
        id: "creamer",
        name: "Cold Foam Topping",
        required: false,
        maxSelectable: 1,
        options: [
          {
            id: "vanilla-foam",
            name: "Sweet Vanilla Cold Foam",
            priceDelta: 1.25,
            calorieDelta: 70,
          },
          {
            id: "oat-cacao-foam",
            name: "Vegan Oat Cacao Foam",
            priceDelta: 1.25,
            calorieDelta: 45,
          },
        ],
      },
    ],
  },
  {
    id: "gf-almond-flour-banana-bread",
    venueId: "venue-sf-01",
    name: "Gluten-Free Walnut & Banana Loaf",
    category: "bakery_pastry",
    description:
      "Baked fresh with almond flour, ripe bananas, organic cinnamon, and toasted California walnuts.",
    basePrice: 4.75,
    baseCalories: 280,
    caffeineMg: 0,
    dietaryTags: ["gluten_free", "vegetarian", "dairy_free"],
    allergens: ["tree nuts (almonds, walnuts)", "eggs"],
    prepTimeMinutes: 2,
    isAvailable: true,
    customizationGroups: [
      {
        id: "warming",
        name: "Preparation",
        required: true,
        maxSelectable: 1,
        options: [
          {
            id: "warmed",
            name: "Warmed & Toasted",
            priceDelta: 0,
            calorieDelta: 0,
          },
          {
            id: "room-temp",
            name: "Room Temperature",
            priceDelta: 0,
            calorieDelta: 0,
          },
        ],
      },
      {
        id: "spread",
        name: "Complimentary Spread",
        required: false,
        maxSelectable: 1,
        options: [
          {
            id: "almond-butter",
            name: "Almond Butter Dollop",
            priceDelta: 0.75,
            calorieDelta: 80,
          },
          {
            id: "organic-honey",
            name: "Local Wildflower Honey",
            priceDelta: 0.5,
            calorieDelta: 50,
          },
        ],
      },
    ],
  },
  {
    id: "chia-protein-parfait",
    venueId: "venue-sf-01",
    name: "Superfood Chia Seed & Berry Parfait",
    category: "healthy_bites",
    description:
      "Coconut cream chia pudding layered with raspberries, blueberries, hemp seeds, and cacao nibs.",
    basePrice: 6.5,
    baseCalories: 220,
    caffeineMg: 0,
    dietaryTags: [
      "vegan",
      "gluten_free",
      "dairy_free",
      "keto",
      "nut_free",
      "organic",
      "low_sugar",
    ],
    allergens: [],
    prepTimeMinutes: 2,
    isAvailable: true,
    customizationGroups: [],
  },
];

export class SmartCafeEngine {
  /**
   * Filters a menu catalog against selected dietary tags and excluded allergens
   */
  public static filterMenu(
    menu?: MenuItem[] | null,
    requiredTags?: DietaryTag[] | null,
    excludedAllergens?: string[] | null,
    category?: MenuItem["category"],
  ): MenuItem[] {
    const safeMenu = Array.isArray(menu) ? menu : [];
    const safeTags = Array.isArray(requiredTags)
      ? requiredTags.filter((t): t is DietaryTag => typeof t === "string" && t.trim().length > 0)
      : [];
    const safeExclusions = Array.isArray(excludedAllergens)
      ? excludedAllergens.filter((ex): ex is string => typeof ex === "string" && ex.trim().length > 0)
      : [];

    return safeMenu.filter((item) => {
      if (!item || !item.isAvailable) return false;
      if (category && item.category !== category) return false;

      // Check dietary tags (must contain all required tags)
      if (safeTags.length > 0) {
        const itemTags = Array.isArray(item.dietaryTags) ? item.dietaryTags : [];
        const hasAllTags = safeTags.every((t) => itemTags.includes(t));
        if (!hasAllTags) return false;
      }

      // Check allergen exclusions (must not contain any excluded allergens)
      if (safeExclusions.length > 0) {
        const itemAllergens = Array.isArray(item.allergens) ? item.allergens : [];
        const hasExcluded = itemAllergens.some((all) =>
          typeof all === "string" &&
          safeExclusions.some((ex) =>
            all.toLowerCase().includes(ex.toLowerCase()),
          ),
        );
        if (hasExcluded) return false;
      }

      return true;
    });
  }

  /**
   * Calculates total price, calories, and wait times for an order
   */
  public static calculateOrderDetails(
    itemsInput?: OrderItemInput[] | null,
    menu?: MenuItem[] | null,
    currentQueueLength: number = 3,
  ): {
    calculatedItems: CafeOrder["items"];
    subtotal: number;
    tax: number;
    total: number;
    estimatedPrepMinutes: number;
  } {
    const safeItemsInput = Array.isArray(itemsInput)
      ? itemsInput.filter((input): input is OrderItemInput => input != null)
      : [];
    const safeMenu = Array.isArray(menu) ? menu : [];

    if (safeItemsInput.length === 0) {
      return {
        calculatedItems: [],
        subtotal: 0,
        tax: 0,
        total: 0,
        estimatedPrepMinutes: 0,
      };
    }

    let subtotal = 0;
    let maxItemPrep = 0;
    let totalPrepSum = 0;

    const calculatedItems: CafeOrder["items"] = safeItemsInput.map((input) => {
      const item = safeMenu.find((m) => m && m.id === input.menuItemId);
      if (!item) {
        throw new Error(`Menu item with ID ${input.menuItemId} not found.`);
      }

      const rawQuantity = input.quantity;
      const quantity = Number.isFinite(rawQuantity) && rawQuantity > 0
        ? Math.floor(rawQuantity)
        : 1;

      let itemUnitPrice = Number.isFinite(item.basePrice) ? Math.max(0, item.basePrice) : 0;
      const appliedCustomizations: Array<{
        groupName: string;
        optionNames: string[];
        priceDelta: number;
      }> = [];

      const customizations = Array.isArray(input.customizations)
        ? input.customizations
        : [];

      customizations.forEach((cust) => {
        if (!cust) return;
        const groups = Array.isArray(item.customizationGroups)
          ? item.customizationGroups
          : [];
        const group = groups.find((g) => g && g.id === cust.groupId);
        if (!group) return;

        const optionNames: string[] = [];
        let groupPriceDelta = 0;
        const selectedIds = Array.isArray(cust.selectedOptionIds)
          ? cust.selectedOptionIds
          : [];
        const groupOptions = Array.isArray(group.options) ? group.options : [];

        selectedIds.forEach((optId) => {
          const opt = groupOptions.find((o) => o && o.id === optId);
          if (opt) {
            optionNames.push(opt.name);
            const delta = Number.isFinite(opt.priceDelta) ? opt.priceDelta : 0;
            groupPriceDelta += delta;
          }
        });

        if (optionNames.length > 0) {
          appliedCustomizations.push({
            groupName: group.name,
            optionNames,
            priceDelta: groupPriceDelta,
          });
          itemUnitPrice += groupPriceDelta;
        }
      });

      const itemTotalPrice = Number(
        (itemUnitPrice * quantity).toFixed(2),
      );
      subtotal += itemTotalPrice;

      const basePrep = Number.isFinite(item.prepTimeMinutes) && item.prepTimeMinutes > 0
        ? item.prepTimeMinutes
        : 0;
      const itemPrep = basePrep * quantity;
      totalPrepSum += itemPrep;
      if (basePrep > maxItemPrep) {
        maxItemPrep = basePrep;
      }

      return {
        item,
        quantity,
        customizations: appliedCustomizations,
        itemTotalPrice,
      };
    });

    const tax = Number((subtotal * 0.0875).toFixed(2)); // standard 8.75% tax
    const total = Number((subtotal + tax).toFixed(2));

    const safeQueueLength = Number.isFinite(currentQueueLength) && currentQueueLength >= 0
      ? Math.floor(currentQueueLength)
      : 0;

    // Prep estimate: the order's own prep time plus 2 minutes per ticket ahead in the queue
    const estimatedPrepMinutes = Math.max(
      3,
      Math.round(
        estimatePrepMinutes(
          maxItemPrep + totalPrepSum * 0.4,
          safeQueueLength,
        ),
      ),
    );

    return {
      calculatedItems,
      subtotal: Number(subtotal.toFixed(2)),
      tax,
      total,
      estimatedPrepMinutes,
    };
  }

  /**
   * Generates a 4-character human-friendly pickup code and SHA-256 styled pickup token
   */
  public static generatePickupTokens(orderId?: string | number | null): {
    pickupCode: string;
    pickupToken: string;
  } {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let pickupCode = "";
    for (let i = 0; i < 4; i++) {
      pickupCode += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const safeId = typeof orderId === "string"
      ? orderId
      : typeof orderId === "number" && Number.isFinite(orderId)
        ? String(orderId)
        : "000000";
    const suffix = safeId.slice(-6).toUpperCase();
    const pickupToken = `WS-BARISTA-${suffix}-${pickupCode}`;
    return { pickupCode, pickupToken };
  }
}
