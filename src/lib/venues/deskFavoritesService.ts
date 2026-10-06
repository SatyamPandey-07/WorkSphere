/**
 * Desk Favoriting & Instant "Notify When Desk Is Free" Alert Service
 * 
 * Allows remote workers to bookmark their favorite workspace desks (e.g. window seats,
 * quiet booths, ergonomic standing desks) and receive instant vacancy push/in-app notifications
 * the moment an occupied desk becomes free.
 */

export type AlertMethod = "in_app" | "push" | "email";

export interface DeskFavorite {
  id: string;
  userId: string;
  venueId: string;
  venueName: string;
  deskId: string;
  deskLabel: string;
  deskType?: "standard" | "standing" | "booth" | "quiet";
  price?: number;
  tags?: string[];
  isFreeAlertActive: boolean;
  alertMethods: AlertMethod[];
  createdAt: string;
  lastNotifiedAt?: string;
}

export interface DeskAvailabilityStatus {
  deskId: string;
  isFree: boolean;
  status: "available" | "reserved" | "held";
  currentReservationEndsAt?: string;
  nextAvailableTime?: string;
}

// In-memory persistent store for user desk favorites and vacancy watchers
const deskFavoritesStore = new Map<string, DeskFavorite[]>();
const deskAvailabilityStore = new Map<string, DeskAvailabilityStatus>();

export class DeskFavoritesService {
  /**
   * Retrieves all favorited desks for a given user, optionally filtered by venue.
   */
  public getUserFavorites(userId: string, venueId?: string): DeskFavorite[] {
    const list = deskFavoritesStore.get(userId) || [];
    if (venueId) {
      return list.filter((f) => f.venueId === venueId);
    }
    return list;
  }

  /**
   * Toggles a desk favorite on or off for a user.
   */
  public toggleFavorite(
    userId: string,
    data: {
      venueId: string;
      venueName: string;
      deskId: string;
      deskLabel: string;
      deskType?: DeskFavorite["deskType"];
      price?: number;
      tags?: string[];
    },
  ): { isFavorited: boolean; favorite?: DeskFavorite } {
    let list = deskFavoritesStore.get(userId) || [];
    const existingIndex = list.findIndex(
      (f) => f.venueId === data.venueId && f.deskId === data.deskId,
    );

    if (existingIndex >= 0) {
      // Remove favorite
      list.splice(existingIndex, 1);
      deskFavoritesStore.set(userId, list);
      return { isFavorited: false };
    }

    // Add favorite
    const newFavorite: DeskFavorite = {
      id: `fav-desk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId,
      venueId: data.venueId,
      venueName: data.venueName,
      deskId: data.deskId,
      deskLabel: data.deskLabel,
      deskType: data.deskType || "standard",
      price: data.price || 15,
      tags: data.tags || ["High-Speed Wi-Fi", "Power Outlets"],
      isFreeAlertActive: false,
      alertMethods: ["in_app", "push"],
      createdAt: new Date().toISOString(),
    };

    list.unshift(newFavorite);
    deskFavoritesStore.set(userId, list);
    return { isFavorited: true, favorite: newFavorite };
  }

  /**
   * Enables or disables instant "Notify When Desk Is Free" alert for a desk.
   */
  public setFreeAlert(
    userId: string,
    venueId: string,
    deskId: string,
    active: boolean,
    alertMethods: AlertMethod[] = ["in_app", "push"],
    deskDetails?: Partial<DeskFavorite>,
  ): DeskFavorite {
    let list = deskFavoritesStore.get(userId) || [];
    let favorite = list.find((f) => f.venueId === venueId && f.deskId === deskId);

    if (!favorite) {
      favorite = {
        id: `fav-desk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        userId,
        venueId,
        venueName: deskDetails?.venueName || "WorkSphere Venue",
        deskId,
        deskLabel: deskDetails?.deskLabel || deskId,
        deskType: deskDetails?.deskType || "standard",
        price: deskDetails?.price || 15,
        tags: deskDetails?.tags || [],
        isFreeAlertActive: active,
        alertMethods,
        createdAt: new Date().toISOString(),
      };
      list.unshift(favorite);
    } else {
      favorite.isFreeAlertActive = active;
      favorite.alertMethods = alertMethods;
    }

    deskFavoritesStore.set(userId, list);
    return favorite;
  }

  /**
   * Retrieves live availability status for a desk.
   */
  public getDeskAvailability(venueId: string, deskId: string): DeskAvailabilityStatus {
    const key = `${venueId}:${deskId}`;
    const cached = deskAvailabilityStore.get(key);
    if (cached) return cached;

    // Default simulation based on desk ID
    const isReserved = deskId.includes("3") || deskId.includes("7") || deskId.includes("b2");
    const status: DeskAvailabilityStatus = {
      deskId,
      isFree: !isReserved,
      status: isReserved ? "reserved" : "available",
      currentReservationEndsAt: isReserved
        ? new Date(Date.now() + 45 * 60 * 1000).toISOString()
        : undefined,
      nextAvailableTime: isReserved ? "In 45 minutes" : "Now",
    };

    deskAvailabilityStore.set(key, status);
    return status;
  }

  /**
   * Triggers a vacancy alert to all users watching this desk.
   */
  public triggerVacancyNotification(venueId: string, deskId: string, deskLabel: string, venueName: string): {
    notifiedUsersCount: number;
  } {
    let notifiedUsersCount = 0;
    const now = new Date().toISOString();

    for (const [userId, favList] of deskFavoritesStore.entries()) {
      const match = favList.find(
        (f) => f.venueId === venueId && f.deskId === deskId && f.isFreeAlertActive,
      );
      if (match) {
        match.lastNotifiedAt = now;
        notifiedUsersCount++;
      }
    }

    // Update availability store
    const key = `${venueId}:${deskId}`;
    deskAvailabilityStore.set(key, {
      deskId,
      isFree: true,
      status: "available",
      nextAvailableTime: "Now",
    });

    return { notifiedUsersCount };
  }
}

export const deskFavoritesService = new DeskFavoritesService();
