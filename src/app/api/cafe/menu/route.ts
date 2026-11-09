/**
 * route.ts
 * /api/cafe/menu
 * Returns venue cafe menus with dietary tag filters, allergen exclusions, and customization groups.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  SmartCafeEngine,
  SAMPLE_CAFE_MENU,
  DietaryTag,
  MenuItem,
} from "@/lib/cafe/smartCafeEngine";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const venueId = searchParams.get("venueId") || "venue-sf-01";
    const category = searchParams.get("category") as MenuItem["category"] | undefined;
    const dietaryQuery = searchParams.get("dietary"); // e.g. "vegan,gluten_free"
    const allergenExclusionsQuery = searchParams.get("excludeAllergens"); // e.g. "nuts,dairy"

    const requiredTags: DietaryTag[] = dietaryQuery
      ? (dietaryQuery.split(",").map((s) => s.trim()) as DietaryTag[])
      : [];

    const excludedAllergens: string[] = allergenExclusionsQuery
      ? allergenExclusionsQuery.split(",").map((s) => s.trim())
      : [];

    const filteredItems = SmartCafeEngine.filterMenu(
      SAMPLE_CAFE_MENU,
      requiredTags,
      excludedAllergens,
      category
    );

    return NextResponse.json({
      success: true,
      venueId,
      totalCount: filteredItems.length,
      items: filteredItems,
      activeDietaryFilters: requiredTags,
      excludedAllergens,
    });
  } catch (error: any) {
    console.error("[GET /api/cafe/menu] Error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve cafe menu", details: error.message },
      { status: 500 }
    );
  }
}
