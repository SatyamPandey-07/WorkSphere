/**
 * Centralized Domain Types for Venues
 *
 * Unified type definitions for venues across client and server components.
 */

export type NoiseLevel = "quiet" | "moderate" | "loud" | string | null;

export interface VenueCoordinates {
  lat: number;
  lng: number;
  latitude?: number;
  longitude?: number;
}

export interface VenueAmenities {
  wifi?: boolean;
  wifiQuality?: number | null;
  wifiSpeed?: number | null;
  hasOutlets?: boolean;
  outletDensity?: string | null;
  outletLocations?: string[];
  powerTypes?: string[];
  hasErgonomic?: boolean;
  hasPhoneBooths?: boolean;
  hasNoMusic?: boolean;
  hasQuietZone?: boolean;
  hasAncHeadsetRental?: boolean;
  petsAllowedIndoors?: boolean;
  largeDogsAllowed?: boolean;
  smallDogsOnly?: boolean;
  servicePetsOnly?: boolean;
  outdoorPetsOnly?: boolean;
  patioOnly?: boolean;
  waterBowlsProvided?: boolean;
  dogFriendly?: boolean;
  catsAllowed?: boolean;
  singleOriginBeans?: boolean;
  specialtyEspresso?: boolean;
  oatAlmondMilk?: boolean;
  pourOverAvailable?: boolean;
  seating?: number;
  coffee?: number;
  lighting?: string;
  musicStyle?: string;
  isWellLit?: boolean;
  hasCCTV?: boolean;
  safetyScore?: number | null;
  tableSize?: string | null;
  equipmentLoadout?: string | null;
  amenities?: Record<string, unknown>;
}

export interface VenuePricing {
  mealPrice?: string | null;
  lunchDealSchedule?: string | null;
  foodTags?: string[];
  priceLevel?: number | string | null;
  hourlyRate?: number | null;
}

export interface Venue extends VenueCoordinates, VenueAmenities, VenuePricing {
  id: string;
  name: string;
  category: string;
  address?: string;
  description?: string;
  rating?: number | null;
  score?: number;
  reviewCount?: number;
  placeId?: string;
  noiseLevel?: NoiseLevel;
  openingHours?: string;
  isClaimed?: boolean;
  ownerId?: string | null;
  hostMessage?: string | null;
  imageUrl?: string | null;
  photos?: string[];
  photoUrl?: string | null;
  currentOccupancy?: number;
  maxCapacity?: number;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface ClientVenue extends Venue {
  distance?: number | string;
  isFavorited?: boolean;
  clusterScore?: number;
  cluster?: number;
}
