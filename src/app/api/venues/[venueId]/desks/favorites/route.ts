import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import {
  deskFavoritesService,
  AlertMethod,
} from "@/lib/venues/deskFavoritesService";

type RouteContext = {
  params: Promise<{
    venueId: string;
  }>;
};

/**
 * GET /api/venues/[venueId]/desks/favorites
 * Fetches user's favorited desks with live availability status.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { venueId } = await context.params;

    if (!venueId) {
      return NextResponse.json(
        { success: false, error: "Venue ID is required." },
        { status: 400 },
      );
    }

    const { userId } = await auth();
    const effectiveUserId = userId || "anon-guest";

    const favorites = deskFavoritesService.getUserFavorites(effectiveUserId, venueId);
    
    // Attach live availability to each favorite
    const withAvailability = favorites.map((fav) => {
      const availability = deskFavoritesService.getDeskAvailability(venueId, fav.deskId);
      return {
        ...fav,
        availability,
      };
    });

    return NextResponse.json({
      success: true,
      favorites: withAvailability,
    });
  } catch (error) {
    console.error("[GET /api/venues/[venueId]/desks/favorites] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load favorite desks." },
      { status: 500 },
    );
  }
}

/**
 * POST /api/venues/[venueId]/desks/favorites
 * Toggles a desk favorite or configures instant "Notify When Free" vacancy alert.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { venueId } = await context.params;

    if (!venueId) {
      return NextResponse.json(
        { success: false, error: "Venue ID is required." },
        { status: 400 },
      );
    }

    const { userId } = await auth();
    const effectiveUserId = userId || "anon-guest";

    const body = await request.json().catch(() => ({}));
    const { action, deskId, deskLabel, deskType, price, tags, active, alertMethods, venueName } = body;

    if (!deskId) {
      return NextResponse.json(
        { success: false, error: "Desk ID is required." },
        { status: 400 },
      );
    }

    if (action === "alert") {
      // Toggle or configure vacancy alert
      const updated = deskFavoritesService.setFreeAlert(
        effectiveUserId,
        venueId,
        deskId,
        Boolean(active),
        (alertMethods as AlertMethod[]) || ["in_app", "push"],
        { deskLabel, deskType, price, tags, venueName },
      );
      const availability = deskFavoritesService.getDeskAvailability(venueId, deskId);

      return NextResponse.json({
        success: true,
        message: active ? "Vacancy alert enabled! You will be notified instantly when free." : "Alert disabled.",
        favorite: { ...updated, availability },
      });
    }

    // Default action: toggle favorite
    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
      select: { id: true, name: true },
    });

    const vName = venue?.name || venueName || "Venue";

    const result = deskFavoritesService.toggleFavorite(effectiveUserId, {
      venueId,
      venueName: vName,
      deskId,
      deskLabel: deskLabel || deskId,
      deskType,
      price,
      tags,
    });

    const availability = deskFavoritesService.getDeskAvailability(venueId, deskId);

    return NextResponse.json({
      success: true,
      isFavorited: result.isFavorited,
      favorite: result.favorite ? { ...result.favorite, availability } : null,
      message: result.isFavorited ? `Desk ${deskLabel || deskId} added to favorites!` : "Removed from favorites.",
    });
  } catch (error) {
    console.error("[POST /api/venues/[venueId]/desks/favorites] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update desk favorite." },
      { status: 500 },
    );
  }
}
