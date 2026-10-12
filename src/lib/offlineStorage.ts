/**
 * @deprecated Standalone offlineStorage.ts is deprecated in favor of unified offline storage in @/lib/offline.
 * Import directly from `@/lib/offline` instead.
 */

import {
  venuesRepository,
  searchesRepository,
  receiptsRepository,
  type OfflineVenue,
  type OfflineSearch,
  type CachedPreferenceRanking,
  type ReceiptExportItem,
  MAX_OFFLINE_VENUES,
} from "./offline";

export * from "./offline";

/** @deprecated Use venuesRepository.save from @/lib/offline instead. */
export async function saveVenueOffline(venue: OfflineVenue): Promise<void> {
  await venuesRepository.save(venue);
}

/** @deprecated Use venuesRepository.get from @/lib/offline instead. */
export async function getVenueOffline(id: string): Promise<OfflineVenue | null> {
  const venue = await venuesRepository.get(id);
  return venue || null;
}

/** @deprecated Use venuesRepository.getAll from @/lib/offline instead. */
export async function getAllVenuesOffline(): Promise<OfflineVenue[]> {
  return venuesRepository.getAll();
}

/** @deprecated Use venuesRepository.delete from @/lib/offline instead. */
export async function deleteVenueOffline(id: string): Promise<void> {
  await venuesRepository.delete(id);
}

/** @deprecated Use venuesRepository.get from @/lib/offline instead. */
export async function isVenueSavedOffline(id: string): Promise<boolean> {
  const venue = await venuesRepository.get(id);
  return !!venue;
}

/** @deprecated Use venuesRepository.getFavorites from @/lib/offline instead. */
export async function getFavoriteVenuesOffline(): Promise<OfflineVenue[]> {
  return venuesRepository.getFavorites();
}

/** @deprecated Use venuesRepository from @/lib/offline instead. */
export async function toggleFavoriteOffline(venue: OfflineVenue): Promise<boolean> {
  const existing = await venuesRepository.get(venue.id);
  if (existing?.isFavorite) {
    await venuesRepository.removeFavorite(venue.id);
    return false;
  } else {
    await venuesRepository.saveFavorite(venue);
    return true;
  }
}

/** @deprecated Use searchesRepository.save from @/lib/offline instead. */
export async function saveSearchHistoryOffline(
  query: string,
  results: OfflineVenue[],
): Promise<void> {
  await searchesRepository.save({ query, results, timestamp: Date.now() });
}

/** @deprecated Use searchesRepository.getAll from @/lib/offline instead. */
export async function getSearchHistoryOffline(): Promise<OfflineSearch[]> {
  return searchesRepository.getAll();
}

/** @deprecated Use searchesRepository.clear from @/lib/offline instead. */
export async function clearSearchHistoryOffline(): Promise<void> {
  await searchesRepository.clear();
}

/** @deprecated Use searchesRepository.trimSearchHistory from @/lib/offline instead. */
export async function trimSearchHistoryOffline(maxEntries = 20): Promise<number> {
  return searchesRepository.trimSearchHistory(maxEntries);
}

/** @deprecated Use searchesRepository.trimSearchHistory from @/lib/offline instead. */
export async function trimSearchHistory(maxEntries = 20): Promise<number> {
  return searchesRepository.trimSearchHistory(maxEntries);
}

/** @deprecated Use receiptsRepository.save from @/lib/offline instead. */
export async function saveReceiptExportOffline(receipt: ReceiptExportItem): Promise<void> {
  await receiptsRepository.save(receipt);
}

/** @deprecated Use receiptsRepository.getAll from @/lib/offline instead. */
export async function getReceiptExportsOffline(): Promise<ReceiptExportItem[]> {
  return receiptsRepository.getAll();
}

/** @deprecated Use receiptsRepository.delete from @/lib/offline instead. */
export async function deleteReceiptExportOffline(bookingId: string): Promise<void> {
  await receiptsRepository.delete(bookingId);
}

/** @deprecated Use venuesRepository.savePreferenceRanking from @/lib/offline instead. */
export async function savePreferenceRankingOffline(
  ranking: CachedPreferenceRanking,
): Promise<void> {
  await venuesRepository.savePreferenceRanking(ranking);
}

/** @deprecated Use venuesRepository.getPreferenceRanking from @/lib/offline instead. */
export async function getPreferenceRankingOffline(
  id = "default_ranking",
): Promise<CachedPreferenceRanking | null> {
  const res = await venuesRepository.getPreferenceRanking(id);
  return res || null;
}

/** @deprecated Use venuesRepository.pruneLru from @/lib/offline instead. */
export async function pruneLruVenuesOffline(
  database?: IDBDatabase,
  maxVenues = MAX_OFFLINE_VENUES,
): Promise<number> {
  return venuesRepository.pruneLru(maxVenues);
}

/** @deprecated Use pruneRecentlyViewedVenuesLru from @/lib/offline instead. */
export async function pruneRecentlyViewedVenuesOffline(
  maxItems?: number,
): Promise<number> {
  const { pruneRecentlyViewedVenuesLru } = await import("./offline/venueCache");
  return pruneRecentlyViewedVenuesLru(maxItems);
}

