
export interface MapPosition {
  lat: number;
  lng: number;
}

export interface MapMarkerAmenities {
  wifi?: boolean;
  outlets?: boolean;
  quiet?: boolean;
  hasErgonomic?: boolean;
  hasAncHeadsetRental?: boolean;
  outletDensity?: string;
  powerTypes?: string[];
  wifiSpeed?: number | null;

  singleOriginBeans?: boolean;
  specialtyEspresso?: boolean;
  oatAlmondMilk?: boolean;
  pourOverAvailable?: boolean;

  circadianLighting?: boolean;
  lighting?: string;
}

export interface MapMarker {
  id: string;
  position: MapPosition;
  name: string;

  category?: string;
  rating?: number;
  score?: number;
  wifiQuality?: number;

  openingHours?: string;
  hasOutlets?: boolean;
  petsAllowedIndoors?: boolean;
  patioOnly?: boolean;
  waterBowlsProvided?: boolean;

  noiseLevel?: string;
  distance?: string;
  address?: string;
  musicStyle?: string;

  hasPhoneBooths?: boolean;
  outletLocations?: string[];
  hasNoMusic?: boolean;
  hasQuietZone?: boolean;

  isClaimed?: boolean;
  ownerId?: string | null;
  hostMessage?: string | null;
  photos?: string[];

  amenities?: MapMarkerAmenities;
}

export interface MapRoutePoint extends MapPosition {
  elevationMeters?: number;
}

export interface ElevationProfilePoint {
  distanceKm: number;
  elevationMeters: number;
  gradePercent?: number;
}

export interface MapRoute {
  id: string;
  name?: string;
  path: MapRoutePoint[];

  distance?: number;
  duration?: number;
  isHighlighted?: boolean;

  elevationGainMeters?: number;
  elevationLossMeters?: number;
  elevationProfile?: ElevationProfilePoint[];
}

export interface MapView {
  center: MapPosition;
  zoom: number;
  animate?: boolean;
}

