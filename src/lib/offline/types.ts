/**
 * Offline Storage & Synchronisation Engine Type Definitions.
 */

export const MAX_RECENTLY_VIEWED_IDB = 20;

export interface RecentlyViewedVenuePayload {
  id: string;
  name: string;
  address?: string | null;
  category?: string | null;
  imageUrl?: string | null;
  rating?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  amenities?: string[] | null;
  floorplan?: unknown | null;
  viewedAt?: number;
  lastAccessedAt?: number;
  isPinned?: boolean;
  isFavorite?: boolean;
  [key: string]: unknown;
}

export interface OfflineVenue {
  id: string;
  name: string;
  location?: string;
  latitude: number;
  longitude: number;
  type?: string;
  category?: string;
  address?: string;
  rating?: number;
  amenities?: string[];
  floorplan?: unknown;
  hasAncHeadsetRental?: boolean;
  savedAt?: number;
  lastAccessedAt?: number;
  isPinned?: boolean;
  isFavorite?: boolean;
}

export interface OfflineSearch {
  query: string;
  results: OfflineVenue[];
  timestamp: number;
}

export interface PreferenceWeights {
  serverWeight: number;
  clientWeight: number;
}

export interface CachedPreferenceRanking {
  id?: string;
  venueIds: string[];
  scores: number[];
  weights: PreferenceWeights;
  updatedAt: number;
}

export interface OfflinePendingAction {
  id?: number;
  type: string;
  payload: unknown;
  timestamp: number;
}

export interface ReceiptExportItem {
  bookingId: string;
  status: "PENDING" | "SYNCED" | "FAILED";
  createdAt: number;
  data?: unknown;
}

export type QueuedReviewStatus =
  | "PENDING"
  | "SYNCING"
  | "FAILED"
  | "CONFLICT"
  | "AUTH_REQUIRED";

export interface QueuedVenueReview {
  id: string; // Client-generated UUID (idempotency key)
  venueId: string;
  venueName?: string;
  reviewId?: string; // Existing review ID if updating
  baseVenueUpdatedAt?: string;
  baseReviewUpdatedAt?: string;
  data: {
    wifiQuality: number;
    hasOutlets: boolean;
    noiseLevel: "quiet" | "moderate" | "loud";
    avgDecibels?: number;
    peakDecibels?: number;
    comment?: string;
    hasErgonomic?: boolean;
    outletDensity?: string;
    wifiSpeed?: number;
    downloadSpeed?: number;
    uploadSpeed?: number;
    latency?: number;
    crowdLevel?: string;
    lighting?: string;
    musicStyle?: string;
    powerTypes?: string[];
    outletLocations?: string[];
    petsAllowedIndoors?: boolean;
    patioOnly?: boolean;
    waterBowlsProvided?: boolean;
    dogFriendly?: boolean;
    catsAllowed?: boolean;
    speedtestPhoto?: string;
    telemetry?: {
      download: number;
      upload: number;
      latency: number;
      crowdLevel: string;
      timestamp: string;
    };
  };
  createdAt: number;
  retryCount: number;
  status: QueuedReviewStatus;
  conflictDetails?: {
    conflictType?: string;
    serverState?: Record<string, unknown>;
  };
}

export interface PendingNoteEdit {
  id?: number;
  folderId: string;
  text: string;
  timestamp: number; // LWW timestamp
}

export interface CachedNote {
  folderId: string;
  text: string;
  updatedAt: number;
}

export type FavoriteTagBulkUpdate = {
  id: string;
  name?: string;
  color?: string;
};

export interface OfflineTagItem {
  id: string;
  name: string;
  color?: string;
  venueId?: string;
  updatedAt: number;
  pendingSync?: boolean;
}

// ─── Repository Interface ─────────────────────────────────────────────────────

export interface IRepository<T, ID = string> {
  get(id: ID): Promise<T | undefined>;
  getAll(): Promise<T[]>;
  save(item: T): Promise<void>;
  saveMany(items: T[]): Promise<void>;
  delete(id: ID): Promise<void>;
  clear(): Promise<void>;
}

// ─── Generic Sync Engine Interface ────────────────────────────────────────────

export type SyncItemStatus =
  | "PENDING"
  | "SYNCING"
  | "SYNCED"
  | "FAILED"
  | "CONFLICT"
  | "AUTH_REQUIRED";

export interface SyncItem<T = unknown> {
  id: string;
  domain: string;
  payload: T;
  timestamp: number;
  retryCount: number;
  status: SyncItemStatus;
  conflictDetails?: {
    conflictType?: string;
    serverState?: Record<string, unknown>;
  };
}

export interface SyncResult {
  success: boolean;
  syncedIds: string[];
  failedIds?: string[];
  conflicts?: Array<{ id: string; serverState: unknown }>;
  error?: string;
}

export interface ISyncPlugin<T = unknown> {
  readonly domain: string;
  sync(items: SyncItem<T>[]): Promise<SyncResult>;
  resolveConflict?(item: SyncItem<T>, serverState: unknown): Promise<T | null>;
  onSuccess?(items: SyncItem<T>[]): Promise<void> | void;
  onFailure?(error: Error, items: SyncItem<T>[]): Promise<void> | void;
}
