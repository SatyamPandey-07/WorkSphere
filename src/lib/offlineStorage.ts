/**
 * Compatibility bridge: Re-export unified offline storage and IndexedDB repositories from @/lib/offline.
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

export async function saveVenueOffline(venue: OfflineVenue): Promise<void> {
  await venuesRepository.save(venue);
}

export async function getVenueOffline(id: string): Promise<OfflineVenue | null> {
  const venue = await venuesRepository.get(id);
  return venue || null;
}

export async function getAllVenuesOffline(): Promise<OfflineVenue[]> {
  return venuesRepository.getAll();
}

export async function deleteVenueOffline(id: string): Promise<void> {
  await venuesRepository.delete(id);
}

export async function isVenueSavedOffline(id: string): Promise<boolean> {
  const venue = await venuesRepository.get(id);
  return !!venue;
}

export async function getFavoriteVenuesOffline(): Promise<OfflineVenue[]> {
  return venuesRepository.getFavorites();
}

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

export async function saveSearchHistoryOffline(
  query: string,
  results: OfflineVenue[],
): Promise<void> {
  await searchesRepository.save({ query, results, timestamp: Date.now() });
}

export async function getSearchHistoryOffline(): Promise<OfflineSearch[]> {
  return searchesRepository.getAll();
}

export async function clearSearchHistoryOffline(): Promise<void> {
  await searchesRepository.clear();
}

export async function trimSearchHistoryOffline(maxEntries = 20): Promise<number> {
  return searchesRepository.trimSearchHistory(maxEntries);
}

export async function trimSearchHistory(maxEntries = 20): Promise<number> {
  return searchesRepository.trimSearchHistory(maxEntries);
}

export async function saveReceiptExportOffline(receipt: ReceiptExportItem): Promise<void> {
  await receiptsRepository.save(receipt);
}

export async function getReceiptExportsOffline(): Promise<ReceiptExportItem[]> {
  return receiptsRepository.getAll();
}

export async function deleteReceiptExportOffline(bookingId: string): Promise<void> {
  await receiptsRepository.delete(bookingId);
}

export async function savePreferenceRankingOffline(
  ranking: CachedPreferenceRanking,
): Promise<void> {
  await venuesRepository.savePreferenceRanking(ranking);
}

export async function getPreferenceRankingOffline(
  id = "default_ranking",
): Promise<CachedPreferenceRanking | null> {
  const res = await venuesRepository.getPreferenceRanking(id);
  return res || null;
}

export async function pruneLruVenuesOffline(
  database?: IDBDatabase,
  maxVenues = MAX_OFFLINE_VENUES,
): Promise<number> {
  return venuesRepository.pruneLru(maxVenues);
}

export async function pruneRecentlyViewedVenuesOffline(
  maxItems?: number,
): Promise<number> {
  const { pruneRecentlyViewedVenuesLru } = await import("./offline/venueCache");
  return pruneRecentlyViewedVenuesLru(maxItems);
}

