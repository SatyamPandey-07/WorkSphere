/**
 * Cross-Region State Synchronization
 *
 * Manages durable state that needs to be consistent across all edge regions.
 * Uses a CRDT-inspired merge strategy for conflict-free state updates.
 */

import type { Region } from "./geoRouter";

export interface PresenceState {
  userId: string;
  venueId: string;
  cursor: { x: number; y: number } | null;
  lastUpdate: number;
  region: Region;
}

export interface VenuePresence {
  venueId: string;
  users: Map<string, PresenceState>;
  lastSync: number;
}

export interface CrossRegionState {
  venues: Map<string, VenuePresence>;
  regionId: Region;
  lastBroadcast: number;
}

const PRESENCE_TTL_MS = 30_000;
const SYNC_INTERVAL_MS = 5_000;

export class DurableStateSync {
  private state: CrossRegionState;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private broadcastFn: ((message: string) => void) | null = null;

  constructor(regionId: Region) {
    this.state = {
      venues: new Map(),
      regionId,
      lastBroadcast: Date.now(),
    };
  }

  updatePresence(
    userId: string,
    venueId: string,
    cursor: { x: number; y: number } | null,
  ): void {
    let venue = this.state.venues.get(venueId);
    if (!venue) {
      venue = { venueId, users: new Map(), lastSync: Date.now() };
      this.state.venues.set(venueId, venue);
    }

    venue.users.set(userId, {
      userId,
      venueId,
      cursor,
      lastUpdate: Date.now(),
      region: this.state.regionId,
    });

    venue.lastSync = Date.now();
  }

  removePresence(userId: string, venueId?: string): void {
    if (venueId) {
      const venue = this.state.venues.get(venueId);
      if (venue) {
        venue.users.delete(userId);
        if (venue.users.size === 0) {
          this.state.venues.delete(venueId);
        }
      }
      return;
    }

    for (const venue of this.state.venues.values()) {
      venue.users.delete(userId);
      if (venue.users.size === 0) {
        this.state.venues.delete(venue.venueId);
      }
    }
  }

  getVenuePresence(venueId: string): Map<string, PresenceState> {
    return this.state.venues.get(venueId)?.users ?? new Map();
  }

  getAllPresence(): Map<string, VenuePresence> {
    return this.state.venues;
  }

  mergeRemoteState(remoteState: CrossRegionState): void {
    for (const [venueId, remoteVenue] of remoteState.venues) {
      const localVenue = this.state.venues.get(venueId);
      if (!localVenue) {
        this.state.venues.set(venueId, remoteVenue);
        continue;
      }

      for (const [userId, remoteUser] of remoteVenue.users) {
        const localUser = localVenue.users.get(userId);
        if (!localUser || remoteUser.lastUpdate > localUser.lastUpdate) {
          localVenue.users.set(userId, remoteUser);
        }
      }

      localVenue.lastSync = Math.max(localVenue.lastSync, remoteVenue.lastSync);
    }
  }

  serializeState(): string {
    const venuesObj: Record<
      string,
      {
        venueId: string;
        users: Record<string, PresenceState>;
        lastSync: number;
      }
    > = {};

    for (const [venueId, venue] of this.state.venues) {
      const usersObj: Record<string, PresenceState> = {};
      for (const [userId, user] of venue.users) {
        usersObj[userId] = user;
      }
      venuesObj[venueId] = {
        venueId,
        users: usersObj,
        lastSync: venue.lastSync,
      };
    }

    return JSON.stringify({
      venues: venuesObj,
      regionId: this.state.regionId,
      lastBroadcast: Date.now(),
    });
  }

  deserializeState(data: string): CrossRegionState | null {
    try {
      const parsed = JSON.parse(data);
      const venues = new Map<string, VenuePresence>();

      for (const [venueId, venueData] of Object.entries(parsed.venues)) {
        const usersMap = new Map<string, PresenceState>();
        const venueObj = venueData as {
          venueId: string;
          users: Record<string, PresenceState>;
          lastSync: number;
        };
        for (const [userId, userData] of Object.entries(venueObj.users)) {
          usersMap.set(userId, userData as PresenceState);
        }
        venues.set(venueId, {
          venueId,
          users: usersMap,
          lastSync: venueObj.lastSync,
        });
      }

      return {
        venues,
        regionId: parsed.regionId as Region,
        lastBroadcast: parsed.lastBroadcast as number,
      };
    } catch {
      return null;
    }
  }

  cleanupStale(): void {
    const now = Date.now();
    for (const venue of this.state.venues.values()) {
      for (const [userId, presence] of venue.users) {
        if (now - presence.lastUpdate > PRESENCE_TTL_MS) {
          venue.users.delete(userId);
        }
      }
      if (venue.users.size === 0) {
        this.state.venues.delete(venue.venueId);
      }
    }
  }

  setBroadcastFn(fn: (message: string) => void): void {
    this.broadcastFn = fn;
  }

  startSync(): void {
    this.syncInterval = setInterval(() => {
      this.cleanupStale();

      if (this.broadcastFn) {
        const message = JSON.stringify({
          type: "cross_region_sync",
          state: this.serializeState(),
          sourceRegion: this.state.regionId,
        });
        this.broadcastFn(message);
        this.state.lastBroadcast = Date.now();
      }
    }, SYNC_INTERVAL_MS);
  }

  stopSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  getUserCountForVenue(venueId: string): number {
    return this.state.venues.get(venueId)?.users.size ?? 0;
  }

  getTotalUserCount(): number {
    let total = 0;
    for (const venue of this.state.venues.values()) {
      total += venue.users.size;
    }
    return total;
  }
}
