export interface MapMarker {
  id: string;
  position: {
    lat: number;
    lng: number;
  };
  name: string;
  category?: string;
  rating?: number;
  score?: number;
  wifiQuality?: number;
  hasOutlets?: boolean;
  petsAllowedIndoors?: boolean;
  patioOnly?: boolean;
  waterBowlsProvided?: boolean;
  singleOriginBeans?: boolean;
  specialtyEspresso?: boolean;
  oatAlmondMilk?: boolean;
  pourOverAvailable?: boolean;
  noiseLevel?: string;
  lighting?: string;
  hasErgonomic?: boolean;
  distance?: string;
  address?: string;
  amenities?: {
    wifi?: boolean;
    outlets?: boolean;
    quiet?: boolean;
    hasErgonomic?: boolean;
    outletDensity?: string;
    wifiSpeed?: number | null;

    singleOriginBeans?: boolean;
    specialtyEspresso?: boolean;
    oatAlmondMilk?: boolean;
    pourOverAvailable?: boolean;
  };
}

export interface MapRoute {
  id: string;
  path: Array<{ lat: number; lng: number }>;
  distance?: number;
  duration?: number;
  isHighlighted?: boolean;
}

export interface MapView {
  center: {
    lat: number;
    lng: number;
  };
  zoom: number;
  animate?: boolean;
}
